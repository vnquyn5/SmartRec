"""Verify Celery's environment before any job is accepted or processed."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


APP_DIR = Path(__file__).resolve().parents[1] / "app"
PROBE = """
import importlib
import json
import os

if os.environ["IMPORT_ORDER"] == "worker_first":
    from app.workers import redis_job_worker as worker
    from app.celery_app import celery_app
else:
    from app.celery_app import celery_app
    from app.workers import redis_job_worker as worker

from app.tasks import audio_job_task
from app.core.config import settings

callback_urls = []
worker.callback_client.send_callback = lambda url, *args, **kwargs: callback_urls.append(url) or True
worker.send_stage_callback("test-job", "OUTPUT", "FAILED")

print("SMARTREC_CONFIG_PROBE=" + json.dumps({
    "backend": worker.BACKEND_BASE_URL,
    "env_backend": os.environ.get("BACKEND_BASE_URL"),
    "broker": settings.celery_broker_url,
    "llm_endpoint": settings.local_llm_endpoint,
    "diarization_device": os.environ.get("DIARIZATION_DEVICE"),
    "callback_url": callback_urls[0],
    "task_registered": "smartrec.process_audio_job" in celery_app.tasks,
    "same_celery_app": audio_job_task.celery_app is celery_app,
    "same_worker_module": importlib.import_module(
        "app.workers.redis_job_worker") is worker,
    "worker_module_count": sum(
        name == "app.workers.redis_job_worker" for name in __import__("sys").modules),
}))
"""
NATIVE_ENV = """\
BACKEND_BASE_URL=http://127.0.0.1:8082/api/v1
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/1
DIARIZATION_DEVICE=mps
LOCAL_LLM_ENDPOINT=http://host.docker.internal:11434/api/generate
"""


def _probe(tmp_path, *, cwd, env_file=NATIVE_ENV, overrides=None, import_order="celery_first"):
    ai_root = tmp_path / "ai-engine"
    shutil.copytree(APP_DIR, ai_root / "app", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    if env_file is not None:
        (ai_root / ".env").write_text(env_file, encoding="utf-8")

    env = os.environ.copy()
    for key in (
        "BACKEND_BASE_URL", "CELERY_BROKER_URL", "CELERY_RESULT_BACKEND",
        "DIARIZATION_DEVICE", "LOCAL_LLM_ENDPOINT", "PYTHON_DOTENV_DISABLED",
    ):
        env.pop(key, None)
    env.update(overrides or {})
    env["IMPORT_ORDER"] = import_order
    env["PYTHONPATH"] = str(ai_root)
    result = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=ai_root if cwd == "ai-engine" else tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    line = next(line for line in result.stdout.splitlines() if line.startswith("SMARTREC_CONFIG_PROBE="))
    return json.loads(line.partition("=")[2])


@pytest.mark.parametrize("cwd", ["ai-engine", "repository-root"])
@pytest.mark.parametrize("import_order", ["celery_first", "worker_first"])
def test_native_env_is_loaded_before_worker_import(tmp_path, cwd, import_order):
    result = _probe(tmp_path, cwd=cwd, import_order=import_order)

    assert result["backend"] == "http://127.0.0.1:8082/api/v1"
    assert result["env_backend"] == result["backend"]
    assert result["broker"] == "redis://localhost:6379/0"
    assert result["diarization_device"] == "mps"
    assert result["callback_url"] == "http://127.0.0.1:8082/api/v1/jobs/test-job/callback"
    assert result["task_registered"] is True
    assert result["same_celery_app"] is True
    assert result["same_worker_module"] is True
    assert result["worker_module_count"] == 1


def test_explicit_environment_takes_precedence(tmp_path):
    override = "http://127.0.0.1:9099/api/v1"
    result = _probe(
        tmp_path, cwd="repository-root",
        overrides={"BACKEND_BASE_URL": override, "CELERY_BROKER_URL": "redis://127.0.0.1:6380/0"},
    )

    assert result["backend"] == override
    assert result["env_backend"] == override
    assert result["broker"] == "redis://127.0.0.1:6380/0"
    assert result["callback_url"] == "http://127.0.0.1:9099/api/v1/jobs/test-job/callback"


def test_docker_env_does_not_depend_on_native_dotenv(tmp_path):
    result = _probe(
        tmp_path,
        cwd="ai-engine",
        env_file=None,
        overrides={
            "BACKEND_BASE_URL": "http://host.docker.internal:8082/api/v1",
            "CELERY_BROKER_URL": "redis://redis:6379/0",
            "CELERY_RESULT_BACKEND": "redis://redis:6379/1",
            "LOCAL_LLM_ENDPOINT": "http://host.docker.internal:11434/api/generate",
            "DIARIZATION_DEVICE": "cpu",
        },
    )

    assert result["backend"] == "http://host.docker.internal:8082/api/v1"
    assert result["broker"] == "redis://redis:6379/0"
    assert result["llm_endpoint"] == "http://host.docker.internal:11434/api/generate"
    assert result["diarization_device"] == "cpu"
    assert result["callback_url"] == "http://host.docker.internal:8082/api/v1/jobs/test-job/callback"
    assert result["task_registered"] is True
