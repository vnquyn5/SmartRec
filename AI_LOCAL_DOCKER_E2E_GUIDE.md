# SmartRec AI Pipeline: Docker Services + Native Worker

This runbook starts the infrastructure and FastAPI AI Engine in Docker, then runs the entire job pipeline through **one native macOS Celery worker**. The worker uses `solo` with concurrency 1, so FFmpeg, WebRTC, Pyannote, STT, PaddleOCR, OUTPUT, and callbacks are handled serially by the same worker process. Ollama remains a separate native service.

## Runtime layout

**Docker:** PostgreSQL, Redis, MinIO, ChromaDB, FastAPI AI Engine.

**Native macOS:** Spring Boot, React, the single Celery worker, FFmpeg, WebRTC processing, Pyannote, STT, PaddleOCR, and Ollama.

**STT backend:** the native adapter now supports `whisper.cpp` Large-v3-Turbo
Q5 and Faster-Whisper/CTranslate2. The local native configuration selects the
existing `models/whisper/ggml-large-v3-turbo-q5_0.bin`; it is not passed to
CTranslate2. CTranslate2 remains selectable and is CPU inference on macOS,
including when `WHISPER_DEVICE=mps` is requested.

The `ai-worker` Compose service is retained only for compatibility under the `docker-worker-compat` profile. Do not start it in this setup. Regular `docker compose up` does not start the profiled worker.

The job flow is:

```text
React → Spring Boot → MinIO / Redis → native Celery worker
  → FFmpeg → WebRTC → Pyannote → STT → PaddleOCR → OUTPUT
  → Spring callback → PostgreSQL → React
                         └─ optional LLM enrichment → Ollama
```

## 1. Configure environment files

Copy `.env.example` to the repository root `.env` and `ai-engine/.env.example` to `ai-engine/.env` for a new setup. Keep both private and do not paste their contents into logs. Configure secrets and local model/cache paths in those files.

The worker startup command below sources root `.env` first and `ai-engine/.env` second. Both are exported to the Python process; values in `ai-engine/.env` override matching root values. Set the following native endpoints in `ai-engine/.env`:

```dotenv
REDIS_HOST=localhost
REDIS_PORT=6379
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/1
MINIO_ENDPOINT=http://localhost:9000
BACKEND_BASE_URL=http://127.0.0.1:8082/api/v1
CHROMA_HOST=localhost
CHROMA_PORT=8001
LOCAL_LLM_ENDPOINT=http://localhost:11434/api/generate
```

Set `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `SMARTREC_INTERNAL_TOKEN`, `HF_TOKEN`, model/cache paths, and OCR model paths to match the local installation. The internal token must match Spring Boot. Never hardcode credentials in source or this guide.

`ai-engine/.env.example` selects the local whisper.cpp Q5 Large-v3-Turbo model.
The native worker uses it from `../models/whisper/ggml-large-v3-turbo-q5_0.bin`;
keep that existing model in place. `STT_BACKEND=faster-whisper` remains an
explicit alternative and requires a CTranslate2 model directory with `model.bin`.

Set `SMARTREC_LLM_ENABLED=false` or `true` in root `.env` to choose core-only or LLM-enriched processing. Since the startup command exports root `.env`, the flag is available to the native worker. If also set in `ai-engine/.env`, that value takes precedence. Keep Spring Boot and the Docker FastAPI AI Engine on the same flag value and restart them after changing it. `false` skips LLM enrichment; it does not block the media pipeline.

### Optional Gemini fallback in native Spring Boot

Spring Boot reads `src/main/resources/application.yml`, which imports
`config/application-local-secrets.properties` when present, and receives exported
shell environment variables. Spring Boot does not load root `.env`,
`ai-engine/.env`, or `.env.spring.local` by itself. The Spring startup command
below exports root `.env`; a separate local startup may also export
`.env.spring.local`. The presence of a variable in a file does not prove it was
present in the Spring process that returned `GEMINI_OUTPUT_TRUNCATED`.

The checked-in configuration uses `GEMINI_MAX_OUTPUT_TOKENS=2048` as its default
and has no default Gemini model. The current `.env.spring.local` contains a
disabled, unapproved example with a model placeholder; it is not a confirmed
runtime configuration. Set the actual model and approved output limit explicitly
in the Spring process, after checking that model's supported limit and the
per-job cost budget. Gemini `MAX_TOKENS` is rejected as
`GEMINI_OUTPUT_TRUNCATED`; the partial candidate is never parsed or persisted.
The current implementation does not raise the token limit automatically or
retry a truncation, because it has no verified model-specific ceiling or token
price estimate with which to enforce the configured cost cap. Transient provider
retries remain bounded by `GEMINI_MAX_ATTEMPTS` (at most two) and
`GEMINI_MAX_REQUESTS_PER_JOB`. The existing positive
`GEMINI_MAX_COST_PER_JOB_USD` setting is an authorization gate, not a measured
dollar-spend limiter: this code does not know the model's live token prices.
Keep the request count at one unless an external billing check confirms the
budget; do not assume that a positive amount guarantees a hard cost ceiling.

To opt in after obtaining approval, put the real API key and settings in a
private file outside version control, then export that file in the **Spring
Boot terminal only** before `./mvnw spring-boot:run`. Required settings are
`GEMINI_FALLBACK_ENABLED=true`, `GEMINI_DATA_SHARING_APPROVED=true`,
`GEMINI_REDACTION_POLICY_VERSION=contact-details-v1`, `GEMINI_API_KEY`,
`GEMINI_MODEL`, a positive `GEMINI_MAX_REQUESTS_PER_JOB`, and a positive
`GEMINI_MAX_COST_PER_JOB_USD`. Set `GEMINI_MAX_OUTPUT_TOKENS` to an approved
model-supported value; leave `GEMINI_MAX_ATTEMPTS=1` unless a second request is
explicitly budgeted. The contact-details policy redacts email addresses, URLs,
and phone numbers only; review whether that scope is adequate before approving
sharing. Never copy a Gemini key into Docker or the worker environment merely
to make fallback work.

The results endpoint reports `jobStatus` for Core processing and `llmStatus`
(`SUCCESS`, `FAILED`, `DISABLED`, `PENDING`, or `UNAVAILABLE`) independently.
It also reports `llmFailureCode` when available and, for persisted success,
`llmProvider` and `llmFallbackUsed`. On a failed Gemini provider attempt,
`llmFallbackUsed=true` identifies that the provider was called; a policy denial
reports `false`. A completed Core job with `FAILED` LLM
status has no validated summary. The existing `/jobs/{jobId}/retry` restarts
the entire media pipeline and is not an LLM-only retry; this architecture's
inference lease requires an active processing job. Reuse the persisted
transcript/OCR evidence to create a separate enrichment attempt only after a
dedicated lease and result-persistence workflow is implemented.

Root `.env` may contain Docker-facing values such as `host.docker.internal` or Compose service names for containers. Keep native callback, Redis, MinIO, ChromaDB, and Ollama endpoints in `ai-engine/.env`; the second source step overrides those root values. A native worker must not use Docker-only DNS names such as `redis` or `minio`.

## 2. Start Docker infrastructure and FastAPI

From the repository root, start only the required Docker services:

```bash
docker compose up -d --build postgres redis minio minio-init chromadb ai-engine
docker compose ps
```

The default Compose file does not bind-mount `ai-engine/app`. Rebuild and
recreate `ai-engine` after changing its routes or schemas; otherwise the
container can return HTTP 200 from an older `/prepare` contract. In particular,
Spring requires the `fallbackSystemPrompt` field. To update only FastAPI after
a code change, run `docker compose up -d --build --no-deps ai-engine`. Rebuilding
does not restart the native worker or Spring Boot.

Do not include `ai-worker`. If a compatibility worker was previously started, stop it before proceeding:

```bash
docker compose stop ai-worker
```

Do not run the compatibility Docker worker and native worker at the same time; both would consume the same Redis queue.

Check the services without printing environment values:

```bash
curl -fsS http://localhost:8000/health
docker compose exec redis redis-cli ping
curl -fsS http://localhost:9000/minio/health/live
```

FastAPI remains available in Docker for its existing API contract and health/internal endpoints. The native worker performs the media and OCR stages locally; those inference stages are not delegated to a Docker task service.

## 3. Start Spring Boot and React

In its Terminal, export the root environment so Spring receives the same
`SMARTREC_LLM_ENABLED` flag and internal token as the worker. Start Spring Boot
from the repository root:

```bash
set -a
source .env
set +a
./mvnw spring-boot:run
```

In another terminal:

```bash
cd Frontend/smartrec-frontend
npm install
npm run dev -- --host 0.0.0.0
```

Ollama runs natively as an independent service when LLM enrichment is enabled.
Make sure Ollama is already serving and the configured model is available
locally; the Celery worker does not start or embed Ollama. The local client
requests immediate model release after generation to limit overlap with the
next Pyannote/STT job.

## 4. Start the one native Celery worker

Provision `ai-engine/.venv` with Python 3.11 and the AI Engine dependencies, and ensure FFmpeg is installed on macOS. Open one Terminal and run this single worker command:

```bash
cd /Users/Vq.05/NCKH/SmartRec/SmartRec/ai-engine
source .venv/bin/activate
set -a
source ../.env
source .env
set +a
python -m celery -A app.celery_app:celery_app worker --loglevel=INFO --pool=solo --concurrency=1
```

Leave that worker running while jobs are processed. This is the only AI Worker Terminal needed. No per-task AI server or additional Celery worker is required. `--pool=solo --concurrency=1` serializes jobs and limits concurrent model memory use.

### Verify the selected inference devices

The worker is a single orchestrator; device support still varies by model. Check
PyTorch's actual MPS availability in the same virtual environment:

```bash
python -c 'import torch; print("MPS built:", torch.backends.mps.is_built()); print("MPS available:", torch.backends.mps.is_available())'
```

In the Coding Agent's Python 3.11.18 environment, PyTorch 2.15.0 reports
`MPS built: True`, `MPS available: False` on macOS ARM64. This does not establish
that the user's interactive Terminal has the same availability; run the check
there as well. With the configured `DIARIZATION_DEVICE=mps`, an actual cached
Pyannote run on the 50-second project WAV logged the unsupported MPS device,
fell back to CPU, completed successfully with 10 segments in 45.83 seconds,
and released its pipeline. Pyannote auto-selects CPU when MPS is unavailable.

The native `whisper-cli` 1.9.5 binary has the Metal backend. A real 50-second
project WAV using the cached Q5 model completed with `--no-gpu` in 38.15 seconds
(37.90 seconds measured inference, 0.76 seconds model load), yielding two
timestamped segments spanning 0–50 seconds. An automatic Metal attempt in this
runtime aborted during allocation of a 7.33 MiB Metal buffer with an out-of-
memory assertion (exit signal 6); the SmartRec adapter then explicitly retried
on CPU and returned two timestamped segments in 27.1 seconds in a separate run.
The adapter logs that CPU fallback; it does not claim Metal inference. Peak RAM
was not measured, and these are single-run timings without a reference
transcript/WER.

PaddleOCR also loaded the configured PP-OCRv6 detector/recognizer from local
model directories and ran on CPU against a blank local JPEG in 6.58 seconds,
returning zero detections. `NO_SLIDES_DETECTED` therefore remains a valid
completed OCR outcome. This smoke check does not replace OCR on real slides.

The worker releases Pyannote immediately after diarization. whisper.cpp owns the
STT model in a child process and releases it when inference exits; on Metal OOM,
the child is restarted once with `--no-gpu` only when device mode is `auto` and
the error is explicitly classified as Metal memory pressure. `metal` mode fails
without CPU fallback. Ollama requests use `keep_alive=0` so the LLM model is
released after enrichment. Monitor macOS Activity Monitor while processing;
`solo` and concurrency one prevent overlapping Celery jobs but do not by
themselves prove peak memory safety.

## 5. Run and inspect an E2E job

1. Open `http://localhost:5173`, sign in, upload a supported video, and start processing.
2. Wait for the Job to reach `COMPLETED`; inspect the native worker output for stage progress and errors.
3. In the Meeting page, inspect Transcript and OCR. Transcript rows include speaker/timestamp data and should seek the video; OCR may validly report no slides after a successful pass.
4. With `SMARTREC_LLM_ENABLED=false`, Summary and Tasks remain unprocessed and no placeholder result is written. With it enabled, inspect LLM status and only trust validated persisted results.

FastAPI rebuilds action items from explicit, evidence-backed assignment facts,
normalizes supported names/deadlines and then runs the unchanged strict schema,
source-reference, and evidence checks. If a Qwen response still fails parsing,
schema, source-reference, or evidence validation, FastAPI allows one additional
Qwen call using the same token limit and verified evidence, with only safe
diagnostic field/type hints. It never feeds the failed raw JSON back to the
model. If the repair output also fails, Spring may use Gemini only when the
existing enablement, data-sharing approval, redaction, request, and cost gates
allow it; Gemini output goes through the same normalization and validation
before persistence. Otherwise the results endpoint keeps Core `jobStatus`
separate from `llmStatus=FAILED` and the LLM failure code. No partial or
unvalidated summary is saved.

For a manual LLM check after rebuilding FastAPI, submit a real job only when
authorized, then inspect `GET /api/v1/meetings/{meetingId}/jobs/{jobId}/results`.
Confirm `llmStatus=SUCCESS`, a non-null summary, and the expected
`llmProvider`/`llmFallbackUsed`; if it fails, check `llmFailureCode` and safe
field/type diagnostics. Verify the native Ollama service received one or two
sequential `/api/generate` calls for a local-only attempt. A Gemini request
requires a separately approved configuration and is never made by automated
tests. To check only the deterministic repair against existing evidence, use
the offline replay in section 8; it calls neither provider.

Authenticated backend endpoints:

```text
GET /api/v1/jobs/{jobId}
GET /api/v1/meetings/{meetingId}/jobs/{jobId}/results
```

PostgreSQL can be inspected through the configured local `psql` connection. Avoid selecting transcript content for routine checks. Table names may depend on the active schema/migrations; check the entity mappings first.

## 6. Troubleshooting

- **Job stays queued:** check Redis, verify exactly one native Celery worker is consuming the queue, and confirm the Docker compatibility worker is stopped.
- **Worker cannot connect to Redis or MinIO:** check `ai-engine/.env` for host-published endpoints (`localhost:6379` and `localhost:9000`), not Compose DNS names.
- **Callback fails:** verify Spring is reachable at the configured `BACKEND_BASE_URL`, and its internal token matches `SMARTREC_INTERNAL_TOKEN`. Do not print tokens while debugging.
- **Pyannote authentication fails:** verify `HF_TOKEN` is set in the worker environment and model access has been granted. Keep the token out of logs.
- **Model path errors:** check that the native paths in `ai-engine/.env` point to readable local model/cache directories.
- **LLM is unexpectedly invoked or skipped:** check `SMARTREC_LLM_ENABLED` in root and `ai-engine/.env`, remembering the latter wins, and make sure Spring and FastAPI have the same setting. Restart the affected processes after changes.
- **Memory pressure:** the worker is intentionally serial. Check macOS Activity Monitor and worker stage logs; avoid starting another worker or loading additional model services concurrently.

## 7. Acceptance record

For an actual E2E run, record Meeting ID, Job ID, stage statuses, transcript segment and speaker counts, OCR status/record count, LLM status, and whether the frontend displayed the persisted results. Do not report E2E success from unit tests or mocks alone. Do not include transcript text, secrets, or private meeting content in the report.

## 8. Opt-in local LLM failure capture and offline replay

FastAPI does not persist prompts, transcripts, or model output by default. To
capture only a failed **local Ollama** output for a development investigation,
start/recreate FastAPI with both explicit gates enabled:

```bash
SMARTREC_ENVIRONMENT=development SMARTREC_LLM_DEBUG_CAPTURE_ENABLED=true \
  docker compose up -d --build --no-deps ai-engine
```

Captures are stored in the private Docker volume at
`/var/lib/smartrec/llm-debug`, outside the repository and outside public
application routes. Each file includes raw local model output, verified
evidence, source refs, job ID, and failure code; it excludes prompts and
credentials. The default retention is 24 hours, with 512 KiB per capture and
16 MiB total storage caps. Oversized captures are skipped whole, never
truncated. Gemini `/validate` responses are never captured.

After an authorized development job, list and replay a capture without calling
Ollama or Gemini:

```bash
docker compose exec ai-engine python -m app.services.local_llm_debug list
docker compose exec ai-engine python -m app.services.local_llm_debug replay capture-<timestamp>-<uuid>.json
```

Replay reports only the validation result and safe diagnostic paths by default.
Use `--show-result` only when you need the normalized summary printed to the
private development terminal. Expired captures are also removed by an hourly
background cleanup. Remove a capture or all captures when finished:

```bash
docker compose exec ai-engine python -m app.services.local_llm_debug delete --file capture-<timestamp>-<uuid>.json
docker compose exec ai-engine python -m app.services.local_llm_debug delete --all
```

Turn capture off again by recreating FastAPI with
`SMARTREC_ENVIRONMENT=production SMARTREC_LLM_DEBUG_CAPTURE_ENABLED=false`.
Expired files are also removed during capture/list operations and by `prune`.
