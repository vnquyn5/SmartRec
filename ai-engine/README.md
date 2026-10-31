# SmartRec – AI Engine

AI Engine là dịch vụ xử lý AI của SmartRec, sử dụng
**Python 3.11, FastAPI, Celery và Redis**.

Các chức năng chính bao gồm xử lý âm thanh, phân tách
người nói (Diarization), nhận dạng giọng nói (STT),
OCR và các bước xử lý AI liên quan.

## 1. Kiến trúc vận hành

### Môi trường phát triển local

- Docker: PostgreSQL, Redis, MinIO và ChromaDB.
- Native Python: FastAPI, Celery và các model AI.
- Pyannote chạy MPS hoặc CPU trên macOS.
- Faster-Whisper chạy CPU trên macOS.

Không khởi động thêm container `ai-engine` và
`ai-worker` khi đang chạy AI Engine native.

Không cần triển khai Pyannote HTTP Server riêng.

### Môi trường Docker / Cloud GPU

Repository có Dockerfile CPU và Dockerfile GPU.

Docker GPU phục vụ tích hợp NVIDIA trên Linux.
Cấu hình này **chưa được kiểm thử inference thực tế**.
Thành viên có GPU cần xác minh trước khi triển khai.

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

Trong thư mục `ai-engine`:

```bash
cp .env.example .env
```

Chỉnh file `.env` theo môi trường thực tế.

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

## 7. Khởi động Docker Infrastructure

Tại thư mục gốc SmartRec:

```bash
set -a
source ai-engine/.env
set +a

# Chỉ sử dụng trên môi trường local đã thống nhất
# MinIO credentials với nhóm phụ trách hạ tầng.
export MINIO_USER="${MINIO_USER:-$MINIO_ACCESS_KEY}"
export MINIO_PASSWORD="${MINIO_PASSWORD:-$MINIO_SECRET_KEY}"

export SMARTREC_MODELS_DIR="${SMARTREC_MODELS_DIR:-$HOME/smartrec-models}"
export SMARTREC_HF_CACHE_DIR="${SMARTREC_HF_CACHE_DIR:-$HOME/.cache/huggingface}"

mkdir -p "$SMARTREC_MODELS_DIR" "$SMARTREC_HF_CACHE_DIR"

docker compose up -d postgres redis minio minio-init chromadb
```

Lưu ý: Docker Compose vẫn nội suy các biến bắt buộc
trong toàn bộ file Compose ngay cả khi chỉ chạy hạ tầng.

Không dùng `docker compose up -d` toàn bộ khi
FastAPI và Celery đang chạy native.

Nếu hạ tầng đang có dữ liệu và credentials riêng,
cần giữ nguyên các giá trị thực tế đã thống nhất
với Backend; không tự thay đổi mật khẩu MinIO.

## 8. Chạy FastAPI native

Mở Terminal thứ nhất:

```bash
cd ai-engine
source .venv/bin/activate

set -a
source .env
set +a

python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Nạp `.env` trước khi import source để các module
đọc `os.getenv()` nhận đúng giá trị.

Chỉ chạy `source` với file `.env` đáng tin cậy
do chính bạn quản lý.

## 9. Chạy Celery native

Mở Terminal thứ hai:

```bash
cd ai-engine
source .venv/bin/activate

set -a
source .env
set +a

python -m celery -A app.celery_app:celery_app worker \
  --loglevel=INFO --pool=solo --concurrency=1
```

Giới hạn một worker để giảm tải RAM trên máy local.

## 10. Kiểm tra hoạt động

Kiểm tra dependency:

```bash
python -m pip check
```

Kiểm tra Redis:

```bash
docker exec smartrec-redis redis-cli ping
```

Kết quả mong đợi là `PONG`.

Kiểm tra FastAPI:

```bash
curl http://127.0.0.1:8000/health
```

Để kiểm tra E2E, cần một job hợp lệ từ Backend,
có đầy đủ thông tin MinIO object key.

Ở lần kiểm thử trước, Celery đã nhận job nhưng
job bị dừng do Backend không cung cấp `objectKey`
hợp lệ. Đây là vấn đề tích hợp đã ghi nhận,
không phải lỗi inference Pyannote native.

## 11. Dừng hệ thống

Nhấn `Ctrl+C` ở terminal FastAPI và Celery.

Tại thư mục gốc SmartRec:

```bash
docker compose stop postgres redis minio minio-init chromadb
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
| Thiếu `objectKey` | Hợp đồng dữ liệu Backend – AI |
| Docker Compose thiếu biến | Token và đường dẫn model/cache |
| Worker quá tải RAM | Dùng một worker, không chạy AI Docker song song |

## 13. Phạm vi kiểm thử và bàn giao

Đã kiểm thử:
- Pyannote native trên Apple MPS.
- FastAPI và Celery native kết nối hạ tầng.
- Xác thực Internal Token và nhận job.

Chưa xác nhận:
- E2E xử lý hoàn chỉnh với Backend hiện tại.
- Docker CPU sau khi cập nhật dependencies.
- NVIDIA GPU inference.
- Toàn bộ pipeline PaddleOCR trong native `.venv`.


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
