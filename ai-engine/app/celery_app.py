from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "smartrec_ai",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.tasks.audio_job_task"],
)
celery_app.conf.update(
    task_track_started=True,
    task_acks_late=True,
    task_acks_on_failure_or_timeout=True,
    worker_prefetch_multiplier=1,
    # A lost child (for example SIGKILL after OOM) must not requeue the same
    # memory-heavy task indefinitely. The backend watchdog terminalizes it.
    task_reject_on_worker_lost=False,
)
