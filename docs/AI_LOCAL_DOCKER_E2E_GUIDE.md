# Runbook AI Pipeline Local + Docker

>Tài liệu phản ánh repository tại 30/10/2026. Có nhiều thay đổi chưa commit; đối chiếu working tree trước khi dùng trên revision khác. Lệnh chỉ đọc/khởi động dịch vụ, không sửa trạng thái DB hoặc migration thủ công.

## Mục lục

1. [Mô hình chạy](#1-mô-hình-chạy-local--docker)
2. [Chuẩn bị môi trường](#2-chuẩn-bị-môi-trường)
3. [Biến môi trường và bảo mật](#3-biến-môi-trường-và-bảo-mật)
4. [Khởi động Docker](#4-khởi-động-docker-services)
5. [Whisper.cpp](#5-whispercpp-native-trên-macos)
6. [Pyannote Native](#6-pyannote-native-service)
7. [Ollama](#7-ollama-native-trên-macos)
8. [Spring Boot và Frontend](#8-spring-boot-và-frontend)
9. [E2E MP3](#9-quy-trình-e2e-file-mp3)
10. [E2E MP4](#10-quy-trình-e2e-file-mp4)
11. [Job và PostgreSQL](#11-kiểm-tra-job-và-postgresql)
12. [Retry và recovery](#12-retry-và-recovery)
13. [Troubleshooting](#13-troubleshooting)
14. [Giới hạn chất lượng](#14-giới-hạn-chất-lượng-ai)
15. [Checklist nghiệm thu](#15-e2e-acceptance-checklist)

## 1. Mô hình chạy Local + Docker

Compose định nghĩa PostgreSQL, Redis, MinIO, FastAPI ai-engine và Celery ai-worker. Whisper.cpp, Ollama, Spring Boot và Vite chạy native. Pyannote có thể chạy local trong Worker hoặc qua HTTP adapter tới native service bên ngoài repository.

| Thành phần | Môi trường | Cổng / địa chỉ |
|---|---|---|
| Spring Boot | Native macOS | 8082, context /api/v1 |
| Whisper.cpp | Native macOS | Compose mặc định 8081, endpoint /inference |
| Pyannote HTTP adapter target | Native service ngoài repo | Mặc định 8086; /diarize, /embeddings |
| Ollama | Native macOS | 11434 |
| FastAPI AI Engine | Docker | 8000 |
| Celery Worker | Docker | Không publish port |
| Redis | Docker | 6379 |
| PostgreSQL | Docker | 5432 |
| MinIO | Docker | 9000 API, 9001 console |
| Frontend Vite | Native macOS | 5173 |

Có khác biệt với cổng 8085 trong mô tả đợt kiểm thử: cấu hình hiện tại docker-compose.yml và ai-engine/app/core/config.py mặc định WHISPER_CPP_URL là http://host.docker.internal:8081/inference. Dùng port thực tế hoặc cấu hình biến nhất quán; không mặc định 8085.

Trong container, localhost/127.0.0.1 là chính container. Docker service names như redis, minio phân giải trong network smartrec-net. host.docker.internal cho container gọi tiến trình trên macOS. Vì vậy Worker gọi Redis/MinIO bằng service name, còn Whisper/Ollama/Spring Boot bằng hostname host. Tiến trình native dùng localhost tới các cổng publish trên Mac.

Tách AI services native vì Docker Desktop Linux containers trên Apple Silicon không nhận Metal như tiến trình macOS. Compose build PyTorch CPU; Worker vẫn có thể dùng nhiều RAM/CPU. Đây là cấu hình, không phải cam kết hiệu năng.

## 2. Chuẩn bị môi trường

Đã xác minh từ repo: Java 17, Maven Wrapper; image AI dùng Python 3.11, PyTorch/torchaudio 2.2.2 CPU, pyannote.audio 3.1.1 và faster-whisper 1.1.1; Frontend dùng React 18/Vite 5. Phiên bản Node/npm, Docker Compose tối thiểu, whisper.cpp binary/model và Ollama chưa được pin. Dependency Python không có lock file. Dockerfile cài FFmpeg và Tesseract vie+eng. Repository có mẫu [.env.example](../.env.example); hãy sao chép thành .env và thay các placeholder/secret trước khi chạy Compose.

Tại thư mục gốc, kiểm tra công cụ:

~~~bash
java -version
./mvnw -version
docker compose version
~~~

Mong đợi Java 17 và các công cụ trả về phiên bản hợp lệ. Đây là kiểm tra read-only. Maven Wrapper version cần xác minh trong .mvn/wrapper.

Pyannote model là pyannote/speaker-diarization-3.1, gated trên Hugging Face; cần token có quyền truy cập/đã chấp thuận điều khoản. Không có server native Pyannote hoặc script cài đặt/chạy server trong repository. whisper.cpp và Ollama cài ngoài repo; model không được commit.

Frontend dependencies khai báo trong Frontend/smartrec-frontend/package.json. Xác minh lockfile trước npm install vì cài đặt có thể tạo/cập nhật lockfile. Python host không cần cho Worker Docker; nếu chạy Python native, requirements files không khóa đầy đủ phiên bản.

## 3. Biến môi trường và bảo mật

Compose nội suy biến từ shell/.env ở root và truyền biến khai báo vào containers. Spring Boot native **không tự nhận** biến chỉ có trong Compose .env; cần export riêng trước Maven. Python native tương tự. AI Engine Settings có khai báo env_file .env, nhưng Compose không mount/copy file đó vào container hiện tại.

| Biến | Cấu hình/thành phần | Ý nghĩa |
|---|---|---|
| SMARTREC_INTERNAL_TOKEN | Bắt buộc cho ai-engine/ai-worker; Spring Boot smartrec.internal-token | Phải cùng giá trị; header X-Internal-Token. Secret. |
| DIARIZATION_BACKEND | Worker, mặc định local | Chọn http khi native adapter sẵn sàng. |
| PYANNOTE_NATIVE_URL | Mặc định http://host.docker.internal:8086 | Base URL native Pyannote. |
| PYANNOTE_NATIVE_TOKEN | Mặc định rỗng | Adapter HTTP yêu cầu; header X-SmartRec-Token. |
| HF_TOKEN, HUGGING_FACE_HUB_TOKEN | Pyannote local | Token truy cập model gated. |
| STT_PROVIDER | Compose mặc định whisper_cpp | Hỗ trợ whisper_cpp, faster_whisper_cpu, faster_whisper. |
| WHISPER_CPP_URL | Mặc định http://host.docker.internal:8081/inference | Endpoint HTTP adapter Whisper. |
| STT_MODEL_PATH, WHISPER_MODEL_PATH | Faster-whisper fallback | Thư mục model trong Worker có model.bin; khác model whisper.cpp. |
| STT_TIMEOUT_SECONDS, STT_CPU_THREADS | Mặc định 3600, 4 | Timeout và CPU threads STT. |
| OLLAMA_BASE_URL, OLLAMA_MODEL | host.docker.internal:11434; qwen2.5:1.5b | URL/model LLM. |
| OLLAMA_NUM_CTX, OLLAMA_TIMEOUT_SECONDS | Mặc định 3072, 900 | Context size/timeout. |
| BACKEND_BASE_URL | Mặc định http://host.docker.internal:8082/api/v1 | Worker gọi job/heartbeat/callback. |
| POSTGRES_DB/USER/PASSWORD | Compose defaults smartrec_db/postgres/123456 | Chỉ dùng mặc định cho local. |
| SPRING_DATASOURCE_URL/USERNAME/PASSWORD | Spring native | Mặc định localhost:5432/smartrec_db và postgres credentials. |
| REDIS_HOST/PORT, CELERY_BROKER_URL, CELERY_RESULT_BACKEND | Container dùng redis:6379; backend native localhost:6379 | Broker DB 0, result DB 1. |
| MINIO_USER/PASSWORD/BUCKET | Defaults minioadmin/minioadmin/smartrec-media | Backend cần credentials tương ứng. |
| MINIO_ENDPOINT, MINIO_PUBLIC_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY | Backend/AI | Endpoint nội bộ và public presigned; cần nhất quán. |
| SMARTREC_WORKSPACE_ROOT | /tmp/smartrec_workspace | Workspace job tạm. |
| SMARTREC_HEARTBEAT_INTERVAL_SECONDS | Mặc định 12 | Chu kỳ heartbeat. |
| CELERY_WORKER_CONCURRENCY | Mặc định 1 | Worker concurrency. |
| DIARIZATION_DEVICE, PYTORCH_NUM_THREADS, PYTORCH_INTEROP_THREADS | auto, 2, 2 trong Compose | Runtime PyTorch. |

Tạo token trong terminal zsh mà không echo:

~~~bash
read -s 'SMARTREC_INTERNAL_TOKEN?Nhap token noi bo: '; export SMARTREC_INTERNAL_TOKEN; echo
~~~

Biến chỉ có hiệu lực terminal hiện tại; dùng terminal đó cho Compose và Maven. Không đặt token vào command arguments, history, log, tài liệu hay Git. Nếu dùng .env local, file đã nằm trong .gitignore; kiểm tra git status. Các biến native khác cũng cần export riêng, không được nạp tự động từ .env Compose vào Maven.

## 4. Khởi động Docker services

Tại thư mục gốc, khi SMARTREC_INTERNAL_TOKEN đã có trong environment:

~~~bash
docker compose up -d postgres redis minio minio-init ai-engine ai-worker
docker compose ps
~~~

Lệnh không khởi động Ollama/Whisper/Pyannote native. Mong đợi DB, Redis, MinIO, ai-engine và ai-worker chạy; minio-init có thể exit 0 sau khởi tạo bucket/CORS.

Xem log và kiểm tra Redis/FastAPI:

~~~bash
docker compose logs --tail=100 ai-engine
docker compose logs --tail=150 ai-worker
docker compose exec redis redis-cli ping
curl -fsS http://127.0.0.1:8000/health
~~~

Mong đợi Celery kết nối broker, Redis trả PONG, FastAPI trả JSON status HEALTHY. Compose không khai báo healthcheck container.

Sau khi sửa Python worker, tại thư mục gốc:

~~~bash
docker compose build ai-worker
docker compose up -d --no-deps --force-recreate ai-worker
docker compose ps ai-worker
~~~

Build tạo image mới; recreate áp dụng image. Các service names đã đối chiếu Compose. Rebuild ai-engine nếu code API service này đổi.

## 5. Whisper.cpp native trên macOS

Cấu hình hiện tại dùng port 8081, không phải 8085. WhisperCppHttpAdapter gửi WAV multipart tới /inference với language vi, verbose_json, temperature 0 và đọc timestamps. Repo không pin binary/model/version. ggml-small-q5_1.bin là ví dụ từng dùng; đường dẫn cần xác minh.

Kiểm tra binary/options (thư mục bất kỳ):

~~~bash
command -v whisper-server
whisper-server --help
~~~

Mong đợi binary tồn tại và trợ giúp xác nhận flags. Nếu model đặt ví dụ tại $HOME/.local/share/smartrec/models/ggml-small-q5_1.bin, chạy:

~~~bash
whisper-server -m "$HOME/.local/share/smartrec/models/ggml-small-q5_1.bin" --host 0.0.0.0 --port 8081 -l vi -t 4
~~~

-m chọn model; host/port cho Docker truy cập; -l ngôn ngữ; -t threads. Xác minh flags theo binary cài đặt; mong đợi log lắng nghe. Bind 127.0.0.1 thường không cho container kết nối.

Kiểm tra TCP từ Worker:

~~~bash
docker compose exec ai-worker python -c 'import socket; s=socket.create_connection(("host.docker.internal", 8081), timeout=5); print("connected"); s.close()'
~~~

Mong đợi connected. Health endpoint riêng chưa được xác nhận; xem startup log/TCP. Connection refused: kiểm tra process, bind host, port và URL trong container. API inference là POST multipart /inference. Chất lượng tiếng Việt còn cần cải thiện; model small Q5_1 không được khẳng định tối ưu.

## 6. Pyannote Native Service

Repository chỉ có HTTP adapter, không có server, script chạy, virtualenv instructions hoặc health endpoint. Không thể đưa lệnh server/dependency đã kiểm chứng. Contract adapter:

- POST /diarize: multipart audio, response {status:"SUCCESS", segments:[{start,end,speaker}]}.
- POST /embeddings: multipart audio và speaker_segments JSON form; response embeddings vector 256 chiều.
- Header X-SmartRec-Token, worker config PYANNOTE_NATIVE_TOKEN.
- Base URL mặc định http://host.docker.internal:8086; bật DIARIZATION_BACKEND=http.

Cần xác minh với chủ sở hữu service native: source/version, lệnh chạy, dependencies, token provisioning, bind/healthcheck. Không dựng endpoint giả định. Nếu server chưa chuẩn bị, để backend local: Pyannote chạy trong Worker container với model pyannote/speaker-diarization-3.1, cần HF_TOKEN có quyền. Torch image CPU; dự trù tài nguyên.

## 7. Ollama native trên macOS

Terminal riêng trên Mac:

~~~bash
ollama serve
~~~

Mong đợi server nghe cổng 11434. Terminal khác kiểm tra model:

~~~bash
ollama list
ollama show qwen2.5:1.5b
~~~

Nếu chưa có, ollama pull qwen2.5:1.5b tải model và dùng dung lượng local. Gọi thử inference:

~~~bash
curl -fsS http://127.0.0.1:11434/api/chat -H 'Content-Type: application/json' -d '{"model":"qwen2.5:1.5b","stream":false,"messages":[{"role":"user","content":"Trả lời ngắn: xin chào"}]}'
~~~

Mong đợi JSON có message.content. Kiểm tra TCP từ Worker:

~~~bash
docker compose exec ai-worker python -c 'import socket; s=socket.create_connection(("host.docker.internal", 11434), timeout=5); print("connected"); s.close()'
~~~

Connection refused: kiểm tra Ollama server/bind/firewall và OLLAMA_BASE_URL; không dùng localhost trong container. Model từng inference thành công theo thông tin đợt thử, nhưng Summary/Action Items cần kiểm tra thêm.

## 8. Spring Boot và Frontend

Thứ tự: Docker services, Whisper/Ollama và Pyannote runtime đã chọn, Spring Boot, Frontend. Giữ mỗi nhóm ở terminal riêng.

Ở terminal có SMARTREC_INTERNAL_TOKEN, tại root:

~~~bash
./mvnw spring-boot:run
~~~

Mong đợi Spring Boot nghe cổng 8082, context /api/v1 và kết nối DB/Redis/MinIO. application.yml đặt ddl-auto update và sql.init.mode always; startup có thể cập nhật schema/chạy schema.sql. Không chạy migration thủ công theo runbook; bảo toàn/backup dữ liệu cần thiết trước khi khởi động DB hiện hữu.

Kiểm tra HTTP (không phải health assertion):

~~~bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8082/api/v1/
~~~

HTTP 404 vẫn chứng tỏ server trả lời. Health endpoint riêng chưa được xác định. Swagger route cần xác minh theo cấu hình springdoc.

Tại Frontend/smartrec-frontend:

~~~bash
npm install
npm run dev
~~~

Mong đợi Vite tại http://localhost:5173. npm install có thể cập nhật lockfile, kiểm tra Git status. Nếu API không kết nối, kiểm tra base URL/proxy và CORS.

## 9. Quy trình E2E file MP3

1. Xác nhận Compose services, AI Engine health, Redis PONG, Whisper endpoint, Ollama inference và Pyannote backend (local hoặc HTTP) sẵn sàng.
2. Mở http://localhost:5173, đăng nhập bằng tài khoản môi trường.
3. Upload MP3 ngắn qua UI. SmartRec_E2E_M2_30s.mp3 chỉ là tên ví dụ, không xác nhận file tồn tại trong repo.
4. Tạo/chọn meeting theo UI hiện tại.
5. Chọn Process AI. Backend endpoint POST /api/v1/meetings/{id}/process; thao tác này tạo job thực.
6. Theo dõi Job. Backend stages: FFMPEG, WEBRTC, PYANNOTE, OUTPUT.
7. Theo dõi docker compose logs -f ai-worker và ai-engine; mong đợi task nhận và callbacks stage.
8. Xác nhận callback OUTPUT thành công, Job COMPLETED.
9. Mở Transcript, Speakers, Summary/Tasks và đối chiếu nội dung. AI results endpoint GET /api/v1/meetings/{meetingId}/ai-results.
10. Dùng SELECT ở mục 11 để kiểm tra job/stages/results PostgreSQL.

Job completion xác nhận trạng thái kỹ thuật/callback, không chứng minh độ chính xác AI.

## 10. Quy trình E2E file MP4

Lặp lại MP3 với MP4 có audio/slide rõ. Worker dùng FFmpeg trích/chuẩn hóa audio rồi chạy WebRTC, Pyannote và STT. Trong OUTPUT, OCR lấy một frame mỗi 5 giây, tối đa 80 frame; Tesseract chạy vie+eng, văn bản gần trùng bị loại. OCR lỗi được lưu trong artifact nhưng pipeline tiếp tục transcript/context/LLM.

Kiểm tra tab Slide Keyframes & OCR nếu UI có, hoặc ai-results JSON ocr.frames. Đánh giá timestamp, frame trùng, OCR nhiễu, frame vô ích. OCR có thể rỗng/FAILED; khả năng chạy không có nghĩa chất lượng đạt yêu cầu.

## 11. Kiểm tra Job và PostgreSQL

Entity xác nhận các bảng/cột dưới đây. Tại root, kết nối bằng cấu hình mặc định (đổi credentials nếu cấu hình khác):

~~~bash
docker compose exec postgres psql -U postgres -d smartrec_db
~~~

Các câu tiếp theo chỉ đọc; thay placeholder bằng UUID thật, bỏ dấu ngoặc nhọn. Không chạy UPDATE/DELETE/DDL.

~~~sql
SELECT id, meeting_id, media_file_id, status, current_stage, retry_count,
       error_code, error_message, execution_id, lease_expires_at, created_at, updated_at
FROM processing_jobs WHERE id = '<JOB_UUID>';

SELECT id, job_id, stage, status, retry_count, error_code, error_message,
       started_at, completed_at, created_at, updated_at
FROM job_stages WHERE job_id = '<JOB_UUID>' ORDER BY created_at, stage;

SELECT id, job_id, attempt_count, available_at, dispatched_at, last_error, created_at
FROM job_dispatch_outbox WHERE job_id = '<JOB_UUID>' ORDER BY created_at;

SELECT id, meeting_id, speaker_label, start_time, end_time
FROM speaker_segments WHERE meeting_id = '<MEETING_UUID>' ORDER BY start_time;

SELECT id, meeting_id, processing_job_id, created_at, updated_at,
       jsonb_typeof(results_json::jsonb) AS json_type,
       results_json::jsonb -> 'transcript' AS transcript,
       results_json::jsonb -> 'meetingAnalysis' AS meeting_analysis,
       results_json::jsonb -> 'ocr' AS ocr
FROM meeting_ai_results WHERE meeting_id = '<MEETING_UUID>';

SELECT jsonb_array_length(
         COALESCE(results_json::jsonb #> '{transcript,segments}', '[]'::jsonb)
       ) AS transcript_segment_count
FROM meeting_ai_results WHERE meeting_id = '<MEETING_UUID>';
~~~

Entity lưu JSON trong meeting_ai_results.results_json kiểu text; callback payload được lưu ở root với các khóa transcript/OCR/context/meetingAnalysis. API GET ai-results bọc payload này trong thuộc tính results. Không thấy entity/table transcripts xác nhận nguồn chính; worker lưu transcript trong JSON, không mặc định query bảng transcripts. Nếu cast JSONB lỗi, điều tra dữ liệu/schema trước.

Entity hiện khai báo processing_jobs.error_message, job_stages.error_message là TEXT; job_dispatch_outbox.last_error dài tối đa 1000. Lỗi VARCHAR(255) có thể do schema DB cũ; cần xác minh, không sửa thủ công trong runbook.

## 12. Retry và recovery

Worker tạo execution_id; heartbeat gửi X-Internal-Token và X-Execution-Id. Backend xác minh execution lease; callback cũng yêu cầu hai header. Lease chặn stale/duplicate worker tiếp tục ghi kết quả.

Lỗi retryable được tự retry theo stage, giới hạn mặc định job.max-retry=5; một số lỗi validation/format không retry. Outbox lưu dispatch để dispatcher gửi lại entry chưa dispatch. Worker giữ workspace artifact để resume khi có thể; nếu stage SUCCESS nhưng artifact thiếu, worker báo WORKSPACE_LOST.

Manual retry API POST /api/v1/jobs/{jobId}/retry yêu cầu user auth/ownership. Backend cho retry FAILED, DLQ hoặc CANCELLED; điều tra và sửa lỗi trước, sau đó dùng UI/API xác thực. Không retry PROCESSING/COMPLETED, không gọi internal enqueue tùy tiện, không sửa trạng thái SQL.

DLQ cần điều tra trước retry; FAILED có stage/error; PROCESSING có thể vẫn chạy hoặc heartbeat/lease cần kiểm tra; COMPLETED là terminal kỹ thuật. Outbox dispatched_at NULL là chưa đánh dấu dispatch; đọc attempt_count, last_error, log dispatcher/AI Engine. Enqueue trùng có thể tạo duplicate task, backend terminal status/lease ngăn stale execution.

## 13. Troubleshooting

| Lỗi/triệu chứng | Bằng chứng | Kiểm tra/xử lý |
|---|---|---|
| SMARTREC_INTERNAL_TOKEN must be configured | Compose bắt buộc biến; backend enqueue cũng yêu cầu | Export cùng token cho Maven/Compose, không echo/ghi log. |
| Whisper refused ở 8085 hoặc 8081 | Code hiện mặc định 8081; 8085 là thông tin cũ | Kiểm tra URL/port/bind; container gọi host.docker.internal. |
| Pyannote native không kết nối | Adapter URL mặc định 8086; server không có trong repo | Kiểm tra service ngoài repo, token, endpoint và backend=http; nếu không có dùng local + HF_TOKEN. |
| Ollama refused :11434 | Compose dùng host.docker.internal:11434 | Chạy Ollama, kiểm tra bind/firewall/socket container; không dùng localhost trong container. |
| Callback Spring HTTP 500 | Cần điều tra log/payload | So log backend/worker, token, execution ID/lease, schema. |
| DB error_message vượt VARCHAR(255) | Entity hiện khai báo TEXT; DB có thể schema cũ | Xác minh schema/revision với nhóm; không sửa thủ công. |
| require_stage_callback() got an unexpected keyword argument 'ai_results' | Source hiện tại nhận ai_results | Nếu runtime còn lỗi, nghi container code/image cũ; build/recreate worker. |
| WORKER_LOST | Cần xác minh error code/log cụ thể | Kiểm tra worker crash/restart, tài nguyên, heartbeat timeout mặc định 90s, Docker logs. |
| EXECUTION_LEASE_LOST | Worker bỏ task khi lease không thuộc execution hiện tại | Kiểm tra duplicate task, worker cũ, job terminal, execution ID. |
| Job sang DLQ | Backend hỗ trợ trạng thái DLQ | Xem error_code/message, retry count, stage; sửa nguyên nhân rồi mới manual retry. |
| Outbox chưa dispatch/trùng | Có dispatcher/outbox backend | SELECT outbox, log dispatcher, AI Engine enqueue/Redis; đừng enqueue thủ công. |
| Image build mới nhưng container code cũ | Build không thay container đang chạy | Build rồi force-recreate ai-worker. |
| COMPLETED nhưng Summary/Tasks trống | Cần xem kết quả cụ thể | Kiểm tra results_json, transcript/context, log Ollama/model; COMPLETED không đảm bảo nội dung. |

## 14. Giới hạn chất lượng AI

Repository không có benchmark đủ để lượng hóa các vấn đề được ghi nhận trong đợt thử:

- Pyannote có thể tách một người thành nhiều speaker hoặc chia một lượt nói thành nhiều đoạn.
- Speaker labels và transcript có thể chưa nhất quán sau căn chỉnh timestamp.
- Whisper tiếng Việt còn nhận sai từ; cần đo WER.
- OCR có thể nhiễu/lặp hoặc lấy keyframe không hữu ích; cần đo độ chính xác.
- Summary có thể rỗng; Action Items chưa kiểm chứng đầy đủ trên meeting có nhiệm vụ rõ ràng.
- Cần đánh giá DER, WER, OCR accuracy, summary/task quality trên dữ liệu chuẩn có nhãn và ngưỡng nghiệm thu.

Các hạng mục này chưa nghiệm thu. Job COMPLETED/callback 2xx chỉ phản ánh trạng thái kỹ thuật.

## 15. E2E Acceptance Checklist

### Tích hợp kỹ thuật

- [ ] Docker services sẵn sàng.
- [ ] Spring Boot sẵn sàng và dùng đúng internal token.
- [ ] Whisper native sẵn sàng, port khớp URL.
- [ ] Pyannote backend đã chọn và model/token hợp lệ.
- [ ] Ollama inference thành công.
- [ ] Celery nhận Job.
- [ ] FFMPEG SUCCESS.
- [ ] WEBRTC SUCCESS.
- [ ] PYANNOTE SUCCESS.
- [ ] STT có kết quả.
- [ ] OCR có kết quả nếu là video (hoặc FAILED/SKIPPED được giải thích).
- [ ] AI inference chạy.
- [ ] OUTPUT callback thành công.
- [ ] Job COMPLETED.
- [ ] Kết quả lưu PostgreSQL.
- [ ] Frontend hiển thị kết quả.

### Chất lượng — đánh giá riêng

- [ ] Speaker accuracy/DER đo và đạt ngưỡng nhóm.
- [ ] STT accuracy/WER đo và đạt ngưỡng.
- [ ] OCR accuracy đo và đạt ngưỡng.
- [ ] AI Summary đạt tiêu chí.
- [ ] Action Items đạt tiêu chí.

Không đánh dấu tiêu chí chất lượng hoàn thành chỉ vì Job COMPLETED.

