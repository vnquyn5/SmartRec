# SmartRec Core Pipeline: Hybrid E2E Guide

This runbook covers the current repository setup for Mốc 1. It does not assume the
Celery worker is native: the checked-in `docker-compose.yml` runs both FastAPI and
the Celery worker in Docker. Spring Boot and the React development server run on
macOS. A native worker option is included below for local development.

## 1. Current data flow

```text
React upload → Spring upload API → MinIO
                         ↓
              Meeting + Processing Job + outbox
                         ↓
           Redis → Celery worker → FFmpeg → WebRTC
                         → Pyannote → Faster-Whisper
                         → PaddleOCR for supported videos
                         ↓
        STT/OCR callbacks and artifacts → Spring/PostgreSQL/MinIO
                         ↓
      Meeting results API → React Transcript/Speaker/OCR tabs
```

The Core Pipeline ends successfully at OUTPUT when its STT/OCR work and Backend
callbacks succeed. With `SMARTREC_LLM_ENABLED=false`, OUTPUT does not call
AIModelRouter and sends no `aiResult`. Summary and Tasks stay unprocessed. No
placeholder summary or task is created. The current OCR worker runs for `.mp4`
and `.mkv` inputs; those are also the video extensions currently accepted.

## 2. Prepare environment

1. Copy `.env.example` to `.env` if this is a new local setup. Keep `.env` out of
   Git and restrict its permissions (`chmod 600 .env`). Do not paste its contents
   into logs or support messages.
2. Set local paths for `SMARTREC_MODELS_DIR` and `SMARTREC_HF_CACHE_DIR`. They
   must be absolute host paths readable by Docker.
3. Set a private `SMARTREC_INTERNAL_TOKEN` and the Hugging Face token required
   by the gated Pyannote model. Do not put either value in source code or this
   guide. Accept the model's Hugging Face terms for the account before running
   diarization.
4. Configure the database, MinIO, STT model cache, and backend URL values for the
   local machine. The compose defaults expect the backend at
   `http://host.docker.internal:8082/api/v1`.
5. For Mốc 1 set:

   ```dotenv
   SMARTREC_LLM_ENABLED=false
   ```

   The app defaults this flag to `true` when it is absent, preserving the current
   LLM behavior for existing deployments. `.env.example` opts into `false` for
   this milestone. Docker Compose reads the root `.env`; Spring Boot and native
   worker processes need the same variable in their process environment or IDE
   run configuration. Spring Boot imports the root `.env` as an optional
   properties file; process environment variables take precedence.

## 3. Start dependencies

From the repository root, start only the required services. These commands do
not remove containers or data volumes:

```bash
docker compose up -d postgres redis minio minio-init chromadb ai-engine ai-worker
docker compose ps
```

The compose worker has concurrency one and uses the `solo` pool to avoid an
extra worker process on an 8 GB machine. Keep only one worker consuming the
SmartRec queue.

Check services without dumping environment values:

```bash
curl -fsS http://localhost:8000/health
docker compose exec redis redis-cli ping
curl -fsS http://localhost:9000/minio/health/live
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:8082/api/v1/meetings
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:5173
```

For the Spring API, an HTTP `401`/`403` still confirms the server responded; use
an authenticated request for a functional check. Ollama is not required when
the flag is false. If LLM is enabled later, check Ollama separately at
`http://localhost:11434`.

## 4. Start Spring Boot and React

Provide Spring's environment values through the IDE run configuration or the
trusted local shell environment, including `SMARTREC_LLM_ENABLED=false` and the
same internal token used by the worker. Then run:

```bash
./mvnw spring-boot:run
```

In another terminal:

```bash
cd Frontend/smartrec-frontend
npm install
npm run dev -- --host 0.0.0.0
```

Open `http://localhost:5173`, sign in, upload a video, open its Meeting page,
and start processing if the upload flow has not already created a Job. The API
stores the upload in MinIO; processing begins from the Meeting Job endpoint.

## 5. Optional native Celery worker

The checked-in compose stack currently runs Celery in Docker. If running the
worker natively for a local experiment, first ensure the Docker worker is not
also consuming the queue. Install the `ai-engine` requirements in Python 3.11,
make the Hugging Face/model cache paths available, and set the worker's
environment in the terminal/IDE. Native mode must use host addresses:

```bash
cd ai-engine
export REDIS_HOST=localhost
export REDIS_PORT=6379
export CELERY_BROKER_URL=redis://localhost:6379/0
export CELERY_RESULT_BACKEND=redis://localhost:6379/1
export MINIO_ENDPOINT=http://localhost:9000
export BACKEND_BASE_URL=http://localhost:8082/api/v1
export SMARTREC_LLM_ENABLED=false
export CELERY_WORKER_CONCURRENCY=1
python -m celery -A app.celery_app.celery_app worker --pool=solo --concurrency=1 --loglevel=INFO
```

Also provide `SMARTREC_INTERNAL_TOKEN`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
`MINIO_BUCKET`, `HF_TOKEN`, model directory variables, and the Redis/MinIO
settings expected by the local `.env`. Avoid running the container and native
workers at the same time.

## 6. Run and inspect E2E

Use a real short video that you are authorized to process. In the frontend:

1. Upload the video and confirm its Meeting is created.
2. Start processing and wait for the Job status to become `COMPLETED`.
3. Open Transcript and OCR tabs. Transcript rows include speaker label and
   timestamp; selecting a row seeks the video. OCR shows stored slide text and
   timestamp, or `No slides detected` after a successfully completed video OCR
   pass. The Summary and Tasks tabs show `Chưa xử lý AI` when no LLM result was
   stored.

The result API is:

```text
GET /api/v1/meetings/{meetingId}/jobs/{jobId}/results
```

It returns persisted transcript segments, slide/OCR metadata, `ocrStatus`, and
`llmStatus`. Use the user's normal authenticated session; do not use or expose
the internal worker token in browser requests.

Inspect Job and stage state through the authenticated API:

```text
GET /api/v1/jobs/{jobId}
GET /api/v1/meetings/{meetingId}/jobs/{jobId}/results
```

For PostgreSQL, use a local `psql` session with the database/user configured in
`.env`. Check counts and identifiers without selecting private transcript text:

```sql
SELECT id, status, current_stage FROM processing_jobs WHERE id = '<job-id>';
SELECT count(*) FROM transcripts WHERE processing_job_id = '<job-id>';
SELECT count(*) FROM speaker_segments WHERE meeting_id = '<meeting-id>';
SELECT count(*) FROM meeting_slides WHERE meeting_id = '<meeting-id>' AND job_id = '<job-id>';
```

Table or column names can differ in an existing local database migration; use
the checked-in entity mappings before adapting a query. MinIO stores the source
video and per-job OCR artifacts under `meetings/{meetingId}/jobs/{jobId}/ocr/`.
Inspect object names in the MinIO console without printing OCR text or private
meeting data into logs.

## 7. Feature flag and Mốc 2

`SMARTREC_LLM_ENABLED` is passed to the AI Engine and Celery worker by Compose
and read by Spring's `AIModelRouter` and Job callback validation. With `false`,
FastAPI `/internal/llm/prepare`, `/generate`, and `/validate` reject requests;
the worker skips AIModelRouter; Spring refuses direct router inference and
allows OUTPUT success without an AI record. The default is `true` if unset.

To resume the existing LLM path for Mốc 2, set `SMARTREC_LLM_ENABLED=true` in
the environment of Docker Compose, Spring Boot, and any native worker, then
restart those processes. The existing prompts, schemas, strict validation,
source allowlist, and Gemini fallback code remain in place.

## 8. Common failures

- **Job stays queued:** check Redis and the single Celery worker, then inspect
  the Job status and dispatch outbox without deleting data.
- **FFmpeg/WebRTC fails:** confirm the video object exists in MinIO, is readable,
  and has a supported media extension. Current video support is `.mp4`/`.mkv`.
  Check the stage error code; OUTPUT must
  not mask an earlier audio failure.
- **Diarization cannot authenticate:** verify `HF_TOKEN` is present in the
  worker process and that the model access terms were accepted. Never echo the
  token to confirm it.
- **STT is empty or rejected:** inspect stage status and timestamps/counts; do
  not fabricate transcript segments.
- **OCR reports `FAILED`:** inspect OUTPUT's safe error code and OCR artifact
  manifest. A real keyframe OCR failure must not be relabeled
  `NO_SLIDES_DETECTED`.
- **Results API returns unauthorized:** use the signed-in user's session. The
  worker internal token is for internal callbacks only.
- **LLM is still invoked:** confirm `SMARTREC_LLM_ENABLED=false` reaches the
  Spring process and both Compose services, then restart them. Do not infer
  runtime values by dumping `.env` or process environments.

## 9. Acceptance evidence

Record Meeting ID and Job ID, terminal Job/stage statuses, transcript/speaker/
slide record counts, the API result statuses, and the observed frontend tabs.
Keep transcript text, video content, Hugging Face tokens, and internal tokens
out of the report. Unit tests and mocks are not evidence of a real E2E run.
