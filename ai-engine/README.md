# SmartRec – AI Engine

AI Engine là dịch vụ xử lý AI của SmartRec, sử dụng
**Python 3.11, FastAPI, Celery và Redis**.

Các chức năng chính bao gồm xử lý âm thanh, phân tách
người nói (Diarization), nhận dạng giọng nói (STT),
OCR và các bước xử lý AI liên quan.

## 1. Kiến trúc vận hành

```text
Client
  └─ Spring Boot Backend
       ├─ PostgreSQL (Meetings, Jobs, transcript, summary, AI usage)
       ├─ MinIO (media and OCR artifacts)
       └─ AIModelRouter ── HTTP/internal token ──> FastAPI
                                                    ├─ prepare/validate contract
                                                    └─ Ollama / Qwen2.5-3B

FastAPI ── enqueue/process request ──> Redis/Celery
                                           └─ Celery Worker
                                                ├─ FFmpeg / WebRTC
                                                ├─ Pyannote diarization
                                                ├─ Faster-Whisper STT
                                                └─ Video keyframes / PaddleOCR
                                                     └─ artifacts to MinIO
```

Backend owns job lifecycle and persists transcript and AI results. FastAPI
provides the internal LLM contract; the Celery worker processes queued media
and calls the Backend callbacks. Both FastAPI and the worker use Redis, MinIO
and the configured model files. Ollama serves the local
`qwen2.5:3b-instruct-q4_K_M` model; Gemini fallback is disabled for this
local validation flow.

### Hybrid local development (recommended on memory-constrained machines)

- Docker: PostgreSQL, Redis, MinIO và ChromaDB.
- FastAPI: Docker container `ai-engine`.
- Celery Worker: một tiến trình Python native trong `ai-engine/.venv`.
- Pyannote có thể chạy MPS trên macOS; Faster-Whisper dùng CPU vì
  CTranslate2 không hỗ trợ Apple MPS.
- Ollama có thể chạy native trên host; FastAPI container truy cập host qua
  `host.docker.internal`.

Worker là một Celery task pipeline đơn khối; không có Pyannote-only worker
service. Không chạy Docker `ai-worker` và worker local đồng thời trên cùng
Redis queue.

### Chạy toàn bộ AI Engine trong Docker

Khi máy có đủ RAM, có thể chạy FastAPI và Celery Worker bằng Docker Compose.
Compose mặc định dùng CPU cho Pyannote/Whisper; Ollama vẫn là service riêng
được cấu hình bằng endpoint. Spring Boot Backend hiện chạy ngoài Compose.

### Môi trường Docker / Cloud GPU

Repository có Dockerfile CPU và Dockerfile GPU. Override
`docker-compose.gpu.yml` chỉ cấu hình `ai-worker` cho Whisper CUDA; Pyannote
được đặt CPU. Cấu hình GPU **chưa được kiểm thử inference thực tế**.
FastAPI, Backend, PostgreSQL, Redis, MinIO và Ollama không tự chuyển sang GPU
chỉ bằng override này.

## 2. Phiên bản Pyannote

Cần phân biệt model và thư viện:

| Thành phần | Phiên bản |
| --- | --- |
| Model | `pyannote/speaker-diarization-3.1` |
| Thư viện | `pyannote.audio==4.0.7` |

Model 3.1 đã được kiểm thử với thư viện 4.0.7
trên macOS sử dụng Apple MPS.

Source sử dụng `Pipeline.from_pretrained(..., token=...)`.

## 3. Yêu cầu hệ thống

- Python 3.11.
- FFmpeg và FFprobe.
- Docker Desktop cho hạ tầng local.
- Hugging Face Token có quyền truy cập Pyannote.
- Model Faster-Whisper định dạng CTranslate2.
- Backend Spring Boot có thể truy cập qua HTTP.

Trên macOS sử dụng Homebrew:

```bash
brew install python@3.11 ffmpeg
```

## 4. Cài đặt môi trường Python

Từ thư mục gốc SmartRec:

```bash
cd ai-engine

python3.11 -m venv .venv
source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install -r requirements.txt -r requirements_ai.txt

python -m pip check
```

Các requirements chính được dùng chung cho native
và Docker. Dockerfile CPU/GPU sẽ chọn bản PyTorch
phù hợp với môi trường.

Môi trường native đã kiểm thử sử dụng:
- Python 3.11.16
- Pyannote 4.0.7
- PyTorch 2.14.0
- Torchaudio 2.11.0
- TorchCodec 0.16.0
- Faster-Whisper 1.1.1

**Lưu ý:** Bộ requirements sau khi cập nhật vẫn phải
được kiểm thử cài đặt sạch trước khi kết luận tương thích
hoàn toàn. Không cài đè vào `.venv` đang hoạt động
chỉ để kiểm thử.

### OCR

PaddleOCR đã được khai báo riêng:

Bộ OCR sử dụng PaddleOCR/PaddlePaddle và có thể yêu cầu
`opencv-contrib-python`, trong khi dependencies chung có
`opencv-python-headless`.

**Chưa nên cài trực tiếp OCR vào `.venv` native đang hoạt động.**
Hai distribution OpenCV có thể cùng cung cấp module `cv2`.
Cần xác minh bộ dependency OCR tích hợp trước khi sử dụng
chung một Celery Worker.

`requirements_ocr.txt` vẫn được giữ làm danh sách dependency
cho phần OCR, nhưng chưa được xác nhận cài đặt sạch cùng
Pyannote 4.

Chỉ cài khi cần làm việc với OCR. Môi trường native
hiện tại chưa xác minh tích hợp PaddleOCR với
toàn bộ pipeline Pyannote 4.

## 5. Cấu hình môi trường

Có hai file mẫu cho hai mục đích khác nhau. Từ repository root, copy và cấu
hình riêng từng file:

```bash
cp .env.example .env
cp ai-engine/.env.example ai-engine/.env
```

`docker compose` đọc **root `.env`** để nội suy Compose. Python native đọc
`ai-engine/.env` theo đường dẫn cố định khi import `app.core.config`, trước
khi các module đọc `os.getenv()`; biến đã export vẫn được ưu tiên. Không chép
giá trị secret vào README hoặc Git. Tạo token/password riêng trong file local và dùng cùng
`SMARTREC_INTERNAL_TOKEN` ở Backend, FastAPI và Worker. MinIO user/password
của Compose phải khớp với access/secret key mà Backend và native Worker dùng.

Trong hybrid mode, kiểm tra các endpoint theo nơi process chạy:

| Process | Redis | MinIO | Backend / FastAPI | Ollama |
| --- | --- | --- | --- | --- |
| Native Worker | `localhost:6379` | `http://localhost:9000` | Backend callback: `http://127.0.0.1:8082/api/v1` | Không gọi trực tiếp |
| Docker FastAPI | Compose service `redis:6379` | `http://minio:9000` | Không callback job trực tiếp | `http://host.docker.internal:11434/api/generate` |
| Native Spring Boot | Không cần cho AI Engine contract | Backend config: `http://localhost:9000` | FastAPI: `http://localhost:8000` | Không gọi trực tiếp |

Compose đã định nghĩa các địa chỉ Docker-side trên. Với thiết lập native,
đặt các biến trong `ai-engine/.env` theo đúng bảng. Trên Linux, xác minh
`host.docker.internal` phân giải được từ container trước khi dùng Ollama
trên host; không thay endpoint bằng `localhost` bên trong container.

Các nhóm biến quan trọng:

| Nhóm | Biến |
| --- | --- |
| Backend | `BACKEND_BASE_URL`, `SMARTREC_INTERNAL_TOKEN` |
| Redis/Celery | `REDIS_HOST`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` |
| MinIO | `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` |
| Hugging Face | `HF_TOKEN`, `PYANNOTE_MODEL_ID` |
| Pyannote | `DIARIZATION_DEVICE` |
| Whisper | `STT_MODEL_ID`, `WHISPER_MODEL_PATH`, `WHISPER_DEVICE`, `WHISPER_COMPUTE_TYPE` |
| Workspace | `SMARTREC_WORKSPACE_ROOT` |

Internal Token phải trùng với Backend.

Không commit `.env` chứa credentials thực tế.

## 6. Chuẩn bị model

### Pyannote

Trong `.env`:

```dotenv
PYANNOTE_MODEL_ID=pyannote/speaker-diarization-3.1
DIARIZATION_DEVICE=auto
```

Cấu hình `auto` cho phép chọn CUDA, MPS hoặc CPU.

Cần chấp thuận điều khoản Hugging Face cho các
model Pyannote có kiểm soát truy cập, bao gồm
speaker-diarization-3.1 và segmentation-3.0.

### Faster-Whisper

Trong `.env`:

```dotenv
STT_MODEL_ID=faster-whisper-small
WHISPER_MODEL_PATH=/duong-dan-tuyet-doi/faster-whisper-small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
```

Thư mục model phải tồn tại và chứa `model.bin`.

CTranslate2 không sử dụng Apple MPS.

## 7. Khởi động services

### Hybrid mode: Docker infrastructure + FastAPI, native Worker

Tạo hai `.env` theo mục 5. Đảm bảo root `.env` có model/cache paths tuyệt đối
được Compose yêu cầu (`SMARTREC_MODELS_DIR`, `SMARTREC_HF_CACHE_DIR`) dù
Worker sẽ chạy native. Docker Compose vẫn nội suy các biến bắt buộc trong
toàn bộ file khi chạy một nhóm service.

Chạy tại repository root:

```bash
docker compose up -d postgres redis minio minio-init chromadb ai-engine
```

Lệnh này **không** chạy `ai-worker`. Backend Spring Boot chạy native theo cấu
hình local hiện có; root `.env` không tự được Spring Boot nạp. FastAPI container
nhận Redis/MinIO endpoints nội bộ từ Compose và Ollama endpoint trong root
`.env`.

### Toàn bộ AI services bằng Docker (khi đủ RAM)

Tại repository root, tạo/cấu hình root `.env` theo `.env.example`, bảo đảm
model files đã có trong `SMARTREC_MODELS_DIR` và Hugging Face cache tại
`SMARTREC_HF_CACHE_DIR`, rồi chạy:

```bash
docker compose up -d postgres redis minio minio-init chromadb ai-engine ai-worker
```

Backend Spring Boot và Ollama không phải service trong Compose hiện tại; cần
chạy riêng và cấu hình để truy cập các port đã publish. Không dùng lệnh này
nếu một local Celery Worker đang hoạt động.

### Dùng Docker GPU override trên Linux/NVIDIA

Sau khi cấu hình root `.env`, kiểm tra và build:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.gpu.yml build ai-worker
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d postgres redis minio minio-init chromadb ai-engine ai-worker
```

Override này dùng `Dockerfile.gpu` cho Worker. GPU inference vẫn cần kiểm
thử riêng; tham khảo mục 14.

## 8. Chạy FastAPI native (khi muốn chạy cả Python native)

Mở Terminal thứ nhất:

```bash
cd ai-engine
source .venv/bin/activate

python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`app.core.config` tự nạp `ai-engine/.env` trước khi các module
đọc `os.getenv()`.

## 9. Chạy Celery Worker native

Chỉ chạy local Worker sau khi đã xác nhận Docker `ai-worker` dừng và không có
local Worker khác trên cùng Redis broker. Trước khi bắt đầu:

```bash
docker compose ps ai-worker
docker exec smartrec-redis redis-cli LLEN celery
ps -axo pid,command | grep '[c]elery.*worker'
```

Nếu `ai-worker` đang chạy, dừng **chỉ** service đó trước khi khởi động local
Worker:

```bash
docker compose stop ai-worker
```

Xác nhận container đã dừng và không còn Celery Worker khác; queue bằng
`LLEN` chỉ báo queued tasks, không chứng minh worker độc quyền. Mở Terminal
thứ hai:

```bash
cd ai-engine
source .venv/bin/activate

python -m celery -A app.celery_app:celery_app worker \
  --loglevel=INFO --pool=solo --concurrency=1
```

`--pool=solo --concurrency=1` phù hợp với local MPS và giới hạn bộ nhớ.
Nếu cần demo Whisper CPU, đặt `WHISPER_CPP_DEVICE=cpu` trong `ai-engine/.env`.
Pyannote MPS được bật bằng `DIARIZATION_DEVICE=mps`. Whisper dùng CPU:
`WHISPER_DEVICE=cpu`, `WHISPER_COMPUTE_TYPE=int8`, `WHISPER_MODEL_PATH` phải
trỏ tới thư mục có `model.bin`. Local Paddle/PaddleOCR chưa được cài đặt
trong môi trường đã kiểm thử nên local Worker đó chưa sẵn sàng cho Video OCR.

Để chuyển lại Docker Worker, dừng local Worker bằng `Ctrl+C`, xác nhận process
đã thoát, sau đó chạy `docker compose start ai-worker`. Không khởi động
Docker Worker trước khi local Worker dừng.

## 10. Kiểm tra hoạt động

Chạy kiểm tra từ vị trí tương ứng:

```bash
# Repository root: Docker service status
docker compose ps

# Local Python environment
cd ai-engine
source .venv/bin/activate
python -m pip check
```

Kiểm tra hạ tầng và API:

```bash
docker exec smartrec-postgres pg_isready -U postgres -d smartrec_db
docker exec smartrec-redis redis-cli ping
curl -fsS http://127.0.0.1:9000/minio/health/live
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:11434/api/tags
```

Redis mong đợi `PONG`; Ollama `/api/tags` cần liệt kê model đã cấu hình.
FastAPI `/health` chỉ kiểm tra health; nó **không** chứng minh Backend→FastAPI
contract hay inference hoạt động. Kiểm tra listener Backend bằng một API
hiện có trên `http://127.0.0.1:8082/api/v1`; endpoint đăng nhập cần POST body
đúng schema, nên request `{}` có thể trả validation 400 dù server sẵn sàng.

Để kiểm tra FastAPI internal routes mà không gọi inference, gửi request
contract hợp lệ với token sai: `prepare`, `generate` và `validate` cần trả
401 sau khi body được parse; payload `{}` có thể bị từ chối 422 trước bước
authentication. Không gửi token qua shell command có thể được lưu lại hoặc
hiển thị.

Sau khi có một job mới từ Backend, theo dõi worker log và Backend Job API/DB
để xác nhận từng stage, transcript, summary, action items, AI Usage và trạng
thái cuối. Không đánh dấu E2E thành công chỉ dựa trên service health hoặc
Worker nhận được Job.

## 11. Dừng hệ thống

Nhấn `Ctrl+C` trong terminal native Worker (và FastAPI native nếu đang
chạy). Với Docker Worker, dừng riêng service:

```bash
docker compose stop ai-worker
```

Tại thư mục gốc SmartRec:

```bash
docker compose stop ai-engine postgres redis minio minio-init chromadb
```

Không sử dụng `docker compose down -v` nếu không
chủ động muốn xóa dữ liệu trong Docker volumes.

## 12. Lỗi thường gặp

| Lỗi | Kiểm tra |
| --- | --- |
| HTTP 401 | Internal Token giữa Backend và AI |
| Redis connection refused | Container Redis, Celery broker |
| Hugging Face 401/403 | Token và quyền truy cập model |
| Whisper model not found | Model path và `model.bin` |
| Pyannote `use_auth_token` | Thư viện phải khớp API `token=` |
| Docker Compose thiếu biến | Token và đường dẫn model/cache |
| Worker quá tải RAM | Dùng một worker, không chạy AI Docker song song |
| Docker/local worker cùng nhận Job | Dừng một Worker; chỉ cho một Worker pool dùng cùng Redis queue |
| Backend `AI_ENGINE_CONFIGURATION_INVALID` | Kiểm tra base URL chỉ chứa scheme/host/port; API path được cấu hình riêng |
| FastAPI 502 `SCHEMA_VALIDATION_ERROR` | Qwen đã trả output nhưng output không thỏa strict summary schema/citations; cần kiểm tra JSON/schema, không bật Gemini để lách |
| Local Worker không xử lý được Video | Kiểm tra Paddle/PaddleOCR và model dirs; môi trường local đã kiểm thử hiện thiếu thư viện OCR |
| `host.docker.internal` không phân giải trên Linux | Kiểm tra host-gateway/network mapping; không dùng `localhost` từ container để trỏ tới host |

## 13. Phạm vi kiểm thử và bàn giao

Trạng thái đã kiểm chứng thực tế trong local run:

- Upload media qua Backend và MinIO: thành công.
- FFmpeg, WebRTC và Pyannote native trên Apple MPS: thành công.
- Faster-Whisper STT: đã lưu transcript không rỗng đúng Meeting/Job.
- Backend gọi FastAPI `prepare`: thành công; FastAPI được gọi để `generate`.
- Ollama/Qwen2.5-3B inference đã chạy, nhưng output hai lần không đạt
  `SCHEMA_VALIDATION_ERROR`. Một lần kiểm tra chẩn đoán riêng trả JSON hợp lệ
  nhưng không có summary hay action items; kết quả đó không được persist.
- Audio E2E **chưa PASS**: Job `68da3335-0633-4c0d-a042-3c7054f44976` thất
  bại tại OUTPUT. Summary, action items và AI Usage chưa được lưu; Job chưa
  chuyển `COMPLETED`.
- Results API read-back cho Job thất bại với HTTP 500; nguyên nhân chưa được
  xác định.
- Video/OCR **chưa E2E PASS**. Local `.venv` thiếu Paddle/PaddleOCR; sự hiện
  diện package trong FastAPI container không chứng minh OCR Worker stage chạy
  thành công hoặc OCR artifacts được lưu.

Không coi readiness, model availability, một phản hồi JSON chẩn đoán hoặc
việc một stage riêng lẻ thành công là Full E2E PASS.


## 14. Lưu ý khi triển khai Docker GPU

Cấu hình GPU được bàn giao cho thành viên có NVIDIA GPU kiểm thử.

Các bước cần thực hiện trên máy Linux hỗ trợ NVIDIA:

1. Chuẩn bị Docker, NVIDIA driver và NVIDIA Container Toolkit.
2. Thiết lập các biến bắt buộc của Docker Compose.
3. Chuẩn bị thư mục chứa model Whisper và Hugging Face cache.
4. Bảo đảm `BACKEND_BASE_URL` truy cập được **từ container**.
5. Build Docker GPU và kiểm tra thư viện trước khi chạy job.
6. Kiểm thử Pyannote, Whisper/CTranslate2 và callback Backend.

Không dùng mặc định địa chỉ `127.0.0.1` của native để
kết nối Backend từ trong container: loopback trong container
không phải loopback của máy host.

Ví dụ lệnh kiểm tra cấu hình sau khi thiết lập environment:

```bash
docker compose -f docker-compose.yml   -f docker-compose.gpu.yml config --quiet
```

Ví dụ build worker GPU:

```bash
docker compose -f docker-compose.yml   -f docker-compose.gpu.yml build ai-worker
```

Các lệnh trên dành cho người phụ trách máy GPU.
Chưa được thực hiện trên môi trường native macOS hiện tại.

### Hugging Face cache

`docker-compose.yml` đang mount Hugging Face cache của
AI Worker ở chế độ chỉ đọc (`:ro`).

Vì vậy, trên Docker deployment, thư mục cache phải chứa
đầy đủ model cần thiết trước khi chạy worker offline.
Chỉ tạo một thư mục cache rỗng là không đủ.

Nếu cache chưa có model, cần chuẩn bị model bằng một
quy trình tải riêng có quyền ghi, sau đó mới mount
read-only cho worker.

### TorchCodec trên GPU

`Dockerfile.gpu` sử dụng PyTorch CUDA 12.8 và cài
TorchCodec 0.16.0 từ nguồn wheel CPU.

Cách này cần kiểm tra khả năng import, giải mã audio và
tương thích binary với PyTorch CUDA trên server thực tế.
Không coi Docker build thành công là inference đã PASS.

## 15. Triển khai toàn bộ stack trên Cloud GPU VPS

Hiện tại repository Compose không định nghĩa Spring Boot Backend hoặc Ollama
service. Một VPS có thể host toàn stack, nhưng hai thành phần đó vẫn phải
được cài/chạy riêng trên host hoặc được triển khai bằng một cơ chế container
được quản lý độc lập:

- Spring Boot Backend: chạy trên VPS, kết nối PostgreSQL/Redis/MinIO/FastAPI.
- Docker Compose: PostgreSQL, Redis, MinIO, ChromaDB, FastAPI và một Celery
  Worker.
- Ollama: chạy trên VPS GPU; FastAPI container gọi model qua
  `LOCAL_LLM_ENDPOINT` (`host.docker.internal`/host gateway).
- Model files và Hugging Face cache: persistent local volumes/directories,
  mount đúng `SMARTREC_MODELS_DIR` và `SMARTREC_HF_CACHE_DIR`.

Quy trình triển khai dựa trên cấu hình hiện có:

1. Dùng Linux VPS có NVIDIA GPU, NVIDIA driver và NVIDIA Container Toolkit;
   đo RAM hệ thống/VRAM theo model và concurrency thực tế, không giả định
   cấu hình CPU/Docker Desktop local sẽ đủ tải.
2. Cài Docker Compose, Python/Java chỉ khi Backend hoặc Worker chạy native,
   FFmpeg và Ollama. Bảo đảm model Qwen đã có sẵn trong Ollama; không để
   FastAPI/Worker tự tải model khi xử lý request.
3. Tạo root `.env` từ `.env.example` và `ai-engine/.env` từ
   `ai-engine/.env.example`. Điền secret riêng ngoài repository, giữ internal
   token nhất quán, cấu hình đường dẫn persistent tuyệt đối và MinIO
   credentials nhất quán.
4. Đặt `LOCAL_LLM_ENDPOINT` trỏ từ FastAPI container tới Ollama host; đặt
   `BACKEND_BASE_URL` trỏ từ Worker container tới Backend trên VPS. Xác minh
   DNS/routing từ bên trong container, không dùng container `localhost` cho
   service chạy trên host.
5. Build/start stack CPU hoặc NVIDIA override bằng Compose commands ở mục 7;
   chỉ chạy một Celery Worker cho queue đó. NVIDIA override hiện chỉ bật
   CUDA cho Faster-Whisper; Pyannote vẫn CPU theo file cấu hình hiện có.
6. Chạy connectivity/auth checks, sau đó synthetic Audio E2E và kiểm tra
   transcript→Context→Qwen→persistence→Results API. Video/OCR cần nghiệm thu
   riêng với PaddleOCR/model files.
7. Trước khi nhận traffic: chỉ publish ports cần thiết, giới hạn PostgreSQL,
   Redis, MinIO console/API và Ollama bằng firewall/private network, terminate
   HTTPS tại reverse proxy, thiết lập backup/restore và giám sát disk/RAM/VRAM.
   Compose hiện publish service ports trên host và chưa phải hardening profile
   production; không mở các cổng quản trị ra Internet.

Đây là phương án triển khai, chưa phải bằng chứng cloud GPU hoặc full E2E
đã được kiểm thử. Cần xác minh driver/image/PyTorch-CUDA/TorchCodec tương thích
trên đúng VPS trước khi coi GPU inference là sẵn sàng.
