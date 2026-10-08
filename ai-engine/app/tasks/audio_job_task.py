from app.celery_app import celery_app
from app.workers.processing_errors import RetryableProcessingError


def _process_job(job_id: str):
    from app.workers.redis_job_worker import process_job

    return process_job(job_id)


@celery_app.task(
    bind=True,
    name="smartrec.process_audio_job",
    autoretry_for=(RetryableProcessingError,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=5,
)
def process_audio_job(self, job_id: str):
    return _process_job(job_id)
