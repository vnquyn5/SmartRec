from celery import Celery
from celery.signals import worker_ready
import logging
from urllib.parse import urlsplit

from app.core.config import settings

logger = logging.getLogger("smartrec.celery")

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


@worker_ready.connect
def _log_worker_runtime(sender=None, **kwargs):
    """Log non-secret runtime settings so native env loading is observable."""
    broker = urlsplit(settings.celery_broker_url)
    try:
        broker_port = broker.port or "default"
    except ValueError:
        broker_port = "invalid"
    logger.info(
        "SmartRec Celery ready: llm_enrichment_enabled=%s broker_host=%s broker_port=%s; "
        "use --pool=solo --concurrency=1 for the supported native runtime",
        settings.smartrec_llm_enabled,
        broker.hostname or "invalid",
        broker_port,
    )
