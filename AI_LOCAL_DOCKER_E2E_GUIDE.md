# SmartRec — Hướng dẫn chạy E2E local trên macOS

Tài liệu này mô tả cấu hình lai hiện có trong repository: PostgreSQL, Redis, MinIO, ChromaDB và FastAPI chạy bằng Docker Compose; Spring Boot, Celery Worker, các model media và Ollama chạy native trên macOS. Lệnh ưu tiên Apple Silicon, đặc biệt máy M2 có 8 GB RAM.

Chỉ coi E2E thành công khi một Job thực tế đã chạy, dữ liệu được lưu và kết quả được kiểm tra trên Frontend/API. Container đang chạy hoặc health endpoint trả HTTP 200 chưa chứng minh pipeline đã xử lý được media.

## 1. Tổng quan kiến trúc SmartRec

| Thành phần | Nơi chạy | Vai trò |
| --- | --- | --- |
| React Frontend (Vite) | macOS | Đăng ký/đăng nhập, upload media, theo dõi Job và hiển thị transcript, OCR, summary, action items. |
| Spring Boot Backend | macOS, cổng 8082, base path /api/v1 | Xác thực, quản lý Meeting/Job, nhận callback, gọi AI Router và lưu kết quả vào PostgreSQL. |
| FastAPI AI Engine | Docker, cổng 8000 | Cung cấp endpoint nội bộ LLM prepare/generate/validate; gọi Ollama để inference. |
| Celery Worker | Một tiến trình Python native | Nhận Job từ Redis và chạy tuần tự các stage media; callback về Spring Boot. |
| PostgreSQL | Docker, cổng 5432 | Lưu tài khoản, meeting, job, transcript, summary, action items và metadata. |
| Redis | Docker, cổng 6379 | Celery broker/result backend và trạng thái tạm. |
| MinIO | Docker, API cổng 9000; console cổng 9001 | Lưu media và artifacts. minio-init tạo bucket lúc Compose khởi động. |
| ChromaDB | Docker, cổng host 8001 | Có trong Compose và được khai báo là dependency của ai-engine; mã có client helper. Các stage media chính không phụ thuộc ChromaDB để chạy FFmpeg/STT. |
| FFmpeg / FFprobe | macOS | Trích xuất và chuẩn hóa audio thành WAV mono 16 kHz. |
| WebRTC | macOS | Khử ồn/lọc vang và kiểm tra chất lượng audio. |
| Pyannote | macOS | Phân tách speaker/VAD. Mẫu cấu hình chọn pyannote/speaker-diarization-3.1; cần quyền Hugging Face phù hợp. |
| Whisper STT | macOS | Mẫu ai-engine/.env.example chọn whisper.cpp với model Large-v3-Turbo Q5. |
| Tesseract OCR | Không thấy được gọi trong stage E2E hiện tại | OCR video hiện gọi PaddleOCR; không cài thêm Tesseract chỉ dựa vào yêu cầu chung. |
| PaddleOCR | macOS | Trong OUTPUT, xử lý video .mp4 hoặc .mkv; model PP-OCRv6 phải sẵn có tại đường dẫn native. |
| Ollama / Qwen2.5 3B | macOS, cổng 11434 | FastAPI trong Docker gọi Ollama trên host qua host.docker.internal. Model mặc định qwen2.5:3b-instruct-q4_K_M. |
| Gemini Fallback | Tùy chọn trong Spring | Mặc định tắt; chỉ được gọi khi có cấu hình, phê duyệt chia sẻ dữ liệu, redaction và giới hạn request/cost hợp lệ. |

Compose hiện cấu hình minio-init đánh dấu bucket MinIO là public. Ngoài ra, Compose có giá trị dự phòng PostgreSQL 123456 và MinIO minioadmin nếu thiếu biến cấu hình; thay các giá trị mẫu/dự phòng bằng credentials riêng trong file local trước khi chạy. Chỉ dùng stack này cho phát triển local; không đưa cổng MinIO ra mạng không tin cậy và không tải media nhạy cảm lên bucket public.

Luồng xử lý:

1. Người dùng đăng nhập trên React và tải media lên. Spring tạo Meeting/upload workflow; media được lưu ở MinIO.
2. Khi người dùng bắt đầu xử lý, Spring tạo Job và đưa task vào Redis.
3. Celery Worker native nhận task smartrec.process_audio_job, rồi chạy FFMPEG → WEBRTC → PYANNOTE → OUTPUT tuần tự.
4. Trong OUTPUT, worker chạy Whisper STT; với .mp4/.mkv worker còn chạy keyframe/OCR PaddleOCR. Transcript và OCR được callback/lưu qua Backend.
5. Nếu LLM được bật, worker yêu cầu Spring AI Router tạo enrichment. Spring gọi FastAPI /prepare, /generate rồi /validate; FastAPI gọi Ollama. Gemini chỉ là fallback có điều kiện từ Spring.
6. Spring chỉ lưu summary/action items sau khi kết quả vượt validation. Frontend tải kết quả từ API có xác thực.

jobStatus=COMPLETED mô tả Core OUTPUT. Trạng thái đó không tự chứng minh LLM thành công; cần kiểm tra riêng llmStatus.

## 2. Yêu cầu hệ thống

### Bắt buộc cho cấu hình lai

- macOS Apple Silicon và Docker Desktop đang chạy.
- Java 17; repository có Maven Wrapper nên không cần cài Maven riêng.
- Python 3.11 và virtual environment cho ai-engine.
- Node.js và npm cho Vite. package.json chưa khóa phiên bản Node bằng trường engines.
- FFmpeg, FFprobe và binary whisper-cli có trên PATH.
- Ollama đang chạy trên macOS nếu muốn LLM local.
- Model/cache local, Hugging Face token có quyền truy cập Pyannote và model PaddleOCR nếu kiểm thử video.
- Dung lượng ổ đĩa cho Docker images/volumes, Python packages và model. Không xóa Docker volumes để giải phóng dung lượng nếu cần giữ dữ liệu.

### Kiểm tra công cụ

Chạy từ Terminal:

```bash
docker --version
docker compose version
docker info
java -version
./mvnw -version
python3.11 --version
node --version
npm --version
ffmpeg -version
ffprobe -version
command -v whisper-cli
ollama --version
```

Nếu thiếu Python 3.11 hoặc FFmpeg, README của AI Engine hướng dẫn cài bằng Homebrew:

```bash
brew install python@3.11 ffmpeg
```

Nếu whisper-cli chưa có trên PATH, cài/build binary upstream whisper.cpp theo hướng dẫn tại https://github.com/ggml-org/whisper.cpp, rồi cấu hình WHISPER_CPP_BIN nếu tên binary/đường dẫn khác. Worker không tự tải binary hoặc model.

### Kiểm tra model có sẵn

Chạy từ thư mục gốc repository:

```bash
test -r models/whisper/ggml-large-v3-turbo-q5_0.bin && echo "Whisper model: co" || echo "Whisper model: thieu"
test -d models/ocr/PP-OCRv6_medium_det && echo "OCR detector: co" || echo "OCR detector: thieu"
test -d models/ocr/PP-OCRv6_medium_rec && echo "OCR recognizer: co" || echo "OCR recognizer: thieu"
ollama list
```

Mẫu native chọn tệp models/whisper/ggml-large-v3-turbo-q5_0.bin. Model registry cũng có Faster-Whisper, nhưng Docker compatibility worker không phải cấu hình được khuyến nghị ở đây. Chỉ tải model Ollama nếu ollama list xác nhận model chưa có:

```bash
ollama pull qwen2.5:3b-instruct-q4_K_M
```

Pyannote có thể yêu cầu chấp thuận điều khoản cho pyannote/speaker-diarization-3.1 và dependency model gated tương ứng trên Hugging Face. Nếu thiếu quyền/cache, worker không chạy được diarization. Không tải model lại nếu cache hiện tại đã dùng được.

### Cổng mặc định

| Thành phần | Cổng |
| --- | ---: |
| Spring Boot | 8082 |
| FastAPI | 8000 |
| Vite | 5173 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| MinIO API / Console | 9000 / 9001 |
| ChromaDB | 8001 |
| Ollama | 11434 |

Trên Mac 8 GB, giữ một worker --pool=solo --concurrency=1, không chạy thêm ai-worker trong Docker và không đồng thời nạp model AI khác. Điều này giảm cạnh tranh RAM nhưng không đảm bảo peak memory. Bắt đầu bằng clip ngắn, theo dõi Memory Pressure/Swap trong Activity Monitor.

## 3. Chuẩn bị biến môi trường và model

### Tạo file mẫu mà không ghi đè cấu hình hiện có

Từ thư mục gốc repository:

```bash
[ -f .env ] || cp .env.example .env
[ -f ai-engine/.env ] || cp ai-engine/.env.example ai-engine/.env
```

Nếu file đã tồn tại, giữ nguyên và chỉnh sửa cẩn thận bằng editor cục bộ. Không in file bằng cat, env, printenv hoặc đưa secret vào log/tài liệu. Các file .env, ai-engine/.env, config/application-local-secrets.properties và .env.spring.local được Git ignore trong repository hiện tại.

### Ai đọc file nào

| Process | Nguồn cấu hình đã xác nhận |
| --- | --- |
| Docker Compose | Root .env được Compose dùng để nội suy biến. Compose chỉ chuyển các biến được khai báo trong service ai-engine/ai-worker; ai-engine/.env không được copy vào Docker image. |
| FastAPI trong Docker | Nhận environment khai báo trong docker-compose.yml. Compose đặt Redis/MinIO/Chroma bằng DNS nội bộ redis, minio, chromadb, còn Ollama endpoint dùng LOCAL_LLM_ENDPOINT. |
| Celery Worker native | app.core.config nạp ai-engine/.env bằng load_dotenv(..., override=False). Lệnh bên dưới export root .env trước rồi ai-engine/.env; file thứ hai ghi đè biến trùng tên trong shell. |
| Spring Boot native | application.yml không tự đọc root .env. Lệnh startup phải export root .env. Spring Boot import tùy chọn config/application-local-secrets.properties từ working directory repository nếu file tồn tại. Biến môi trường được ưu tiên hơn property file. |
| React/Vite | Đọc biến public VITE_*; .env.example đặt VITE_API_BASE_URL=http://localhost:8082/api/v1. Không đưa secret backend/token vào Frontend. |

.env.spring.local không được application.yml import và Spring Boot không tự nạp file này. Không source file đó trong Quick Start. Chỉ export vào Terminal Spring khi đã kiểm tra cấu hình cục bộ và chủ động muốn dùng; việc file tồn tại không chứng minh Spring đã nhận nó.

Trong checkout hiện tại, config/application-local-secrets.properties được import nếu tồn tại; file .env.spring.local không được import tự động. Các file này có thể chứa cấu hình Gemini nhưng giá trị của chúng không được suy ra từ tên biến. Trước E2E, xem riêng các cờ bật Gemini/data-sharing trong editor cục bộ; không đưa API key hoặc giá trị cấu hình nhạy cảm vào log/tài liệu. Mặc định trong application.yml không thắng được một giá trị override trong property file hoặc environment.

### Ghép cặp biến giữa hai file .env

Các biến dưới đây dùng chung một giá trị hoặc cần cùng trạng thái. Hai endpoint Ollama và các địa chỉ service khác được đặt khác nhau theo nơi tiến trình chạy.

| Mục đích | Root .env | ai-engine/.env | Quy tắc |
| --- | --- | --- | --- |
| Xác thực nội bộ | SMARTREC_INTERNAL_TOKEN | SMARTREC_INTERNAL_TOKEN | Phải giống hệt; dùng cho Spring/Compose và native Worker. |
| Hugging Face | HF_TOKEN | HF_TOKEN | Dùng cùng token có quyền Pyannote; không in giá trị. |
| Bật enrichment | SMARTREC_LLM_ENABLED | SMARTREC_LLM_ENABLED | Đặt cùng true để có summary; cùng false nếu chỉ chạy Core. Hai file mẫu đặt true. |
| Model local | LOCAL_LLM_MODEL | LOCAL_LLM_MODEL | Cùng qwen2.5:3b-instruct-q4_K_M. |
| Ollama URL | LOCAL_LLM_ENDPOINT=http://host.docker.internal:11434/api/generate | LOCAL_LLM_ENDPOINT=http://localhost:11434/api/generate | Cố ý khác: FastAPI của E2E chạy trong Docker. Endpoint localhost chỉ dùng nếu chạy FastAPI native; worker native hiện gọi Backend. |
| MinIO user/key | MINIO_USER và MINIO_ACCESS_KEY | MINIO_ACCESS_KEY | Root MINIO_USER phải bằng access key ở Spring/native Worker. |
| MinIO password/key | MINIO_PASSWORD và MINIO_SECRET_KEY | MINIO_SECRET_KEY | Root MINIO_PASSWORD phải bằng secret key ở Spring/native Worker. |
| MinIO bucket | MINIO_BUCKET | MINIO_BUCKET | Cùng tên bucket; mẫu dùng smartrec-media. |
| Local model/cache | SMARTREC_MODELS_DIR, SMARTREC_HF_CACHE_DIR | WHISPER_MODEL_PATH, HF_HOME/HF_HUB_CACHE/PYANNOTE_CACHE và OCR model dirs | Đều trỏ tới tài nguyên trên cùng checkout/cache host; Compose dùng đường dẫn tuyệt đối host, Worker dùng đường dẫn theo vị trí native. |
| Callback về Backend | BACKEND_BASE_URL=http://host.docker.internal:8082/api/v1 | BACKEND_BASE_URL=http://127.0.0.1:8082/api/v1 | Cố ý khác theo network namespace. |
| Redis/MinIO/Chroma | Spring dùng localhost; Compose FastAPI nhận DNS nội bộ | Native Worker dùng localhost | Không chép hostname Compose như redis/minio vào ai-engine/.env native. |
| STT/OCR | STT_MODEL_ID/WHISPER_DEVICE/OCR paths là cấu hình worker tương thích Docker | STT_BACKEND=whisper.cpp và native model paths | Khác nhau có chủ đích; E2E khuyến nghị dùng cấu hình native ở ai-engine/.env. |

Root .env.example đặt SMARTREC_LLM_ENABLED=true, GEMINI_FALLBACK_ENABLED=false và GEMINI_DATA_SHARING_APPROVED=false. ai-engine/.env.example cũng đặt SMARTREC_LLM_ENABLED=true. Các placeholder token, HF token và MinIO credentials trong hai mẫu được viết thành cặp tương ứng; khi cấu hình thật, thay bằng giá trị mạnh nhưng vẫn giữ đúng các cặp trên. Không dùng placeholder để chạy ngoài máy local cô lập.

### Các giá trị cần cấu hình và đồng bộ

- Tệp .env ở thư mục gốc: SMARTREC_INTERNAL_TOKEN, SMARTREC_MODELS_DIR, SMARTREC_HF_CACHE_DIR, SMARTREC_LLM_ENABLED, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, SPRING_DATASOURCE_URL, SPRING_DATASOURCE_USERNAME, SPRING_DATASOURCE_PASSWORD, MINIO_USER, MINIO_PASSWORD, MINIO_BUCKET, LOCAL_LLM_ENDPOINT, LOCAL_LLM_MODEL, BACKEND_BASE_URL, HF_TOKEN và các biến kết nối cần thiết.
- SMARTREC_MODELS_DIR và SMARTREC_HF_CACHE_DIR phải là đường dẫn tuyệt đối trên host, tồn tại và đọc được; Compose mount chúng read-only vào /models và Hugging Face cache trong container. Compose yêu cầu cả hai biến để khởi động ai-engine, dù Celery Worker của cấu hình này chạy native. Model của workspace hiện nằm dưới models/; HF cache phải trỏ tới cache Pyannote trên host.
- Compose dùng LOCAL_LLM_ENDPOINT mặc định http://host.docker.internal:11434/api/generate và LOCAL_LLM_MODEL mặc định qwen2.5:3b-instruct-q4_K_M. FastAPI client hiện đọc LOCAL_LLM_*; chỉ đặt OLLAMA_BASE_URL/OLLAMA_MODEL không thay thế cặp biến này.
- ai-engine/.env: cấu hình native REDIS_HOST=localhost, REDIS_PORT=6379, CELERY_BROKER_URL=redis://localhost:6379/0, CELERY_RESULT_BACKEND=redis://localhost:6379/1, MINIO_ENDPOINT=http://localhost:9000, CHROMA_HOST=localhost, CHROMA_PORT=8001, BACKEND_BASE_URL=http://127.0.0.1:8082/api/v1, SMARTREC_INTERNAL_TOKEN, HF_TOKEN, SMARTREC_WORKSPACE_ROOT và đường dẫn model.
- Mẫu native chọn STT_BACKEND=whisper.cpp, WHISPER_MODEL_PATH=../models/whisper/ggml-large-v3-turbo-q5_0.bin, WHISPER_CPP_BIN=whisper-cli, WHISPER_CPP_DEVICE=auto, WHISPER_CPP_THREADS=4. Đường dẫn tương đối tính từ thư mục ai-engine nơi worker được khởi chạy.
- Trong ai-engine/.env, đặt PYANNOTE_MODEL_ID=pyannote/speaker-diarization-3.1 và DIARIZATION_DEVICE=auto theo mẫu. HF_HOME, HF_HUB_CACHE và PYANNOTE_CACHE phải trỏ tới các thư mục Hugging Face trên host có model cache; HF_TOKEN cần quyền truy cập model. Không mặc định rằng MPS sẽ khả dụng chỉ vì máy dùng Apple Silicon.
- Đặt OCR_DETECTION_MODEL_DIR và OCR_RECOGNITION_MODEL_DIR trong ai-engine/.env trỏ tới các thư mục models/ocr/PP-OCRv6_medium_det và models/ocr/PP-OCRv6_medium_rec của checkout. Dùng đường dẫn tuyệt đối nếu tiến trình chạy từ thư mục khác.
- Đặt SMARTREC_LLM_ENABLED=true nhất quán cho Spring, Docker FastAPI và worker nếu muốn summary. ai-engine/.env được source sau root .env và có thể ghi đè giá trị worker. Dùng false nhất quán nếu chủ đích chạy core-only. Khởi động lại process/container sau khi đổi.
- Địa chỉ khác nhau theo network namespace: native worker dùng localhost cho Redis/MinIO/Chroma; FastAPI Docker dùng Compose DNS cho Redis/MinIO/Chroma và host.docker.internal cho Ollama/Backend trên host. Không đổi endpoint trong container thành localhost để gọi service host.
- MINIO_USER/MINIO_PASSWORD trong Compose phải khớp MINIO_ACCESS_KEY/MINIO_SECRET_KEY mà Spring và native worker dùng. MINIO_BUCKET phải nhất quán.
- POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD khởi tạo PostgreSQL container; SPRING_DATASOURCE_URL/SPRING_DATASOURCE_USERNAME/SPRING_DATASOURCE_PASSWORD phải trỏ tới cùng database và thông tin đăng nhập. Docker volume đã được khởi tạo không tự đổi mật khẩu chỉ vì sửa .env; kiểm tra trạng thái hiện có trước khi thay credentials.

Các biến mà pipeline hiện tại đọc gồm LOCAL_LLM_ENDPOINT/LOCAL_LLM_MODEL, STT_BACKEND, WHISPER_MODEL_PATH, WHISPER_CPP_BIN, HF_TOKEN và DIARIZATION_DEVICE. Những tên như OLLAMA_BASE_URL, OLLAMA_MODEL, STT_PROVIDER, DIARIZATION_BACKEND, WHISPER_CPP_URL, PYANNOTE_NATIVE_TOKEN và PYANNOTE_NATIVE_URL không được tìm thấy trong code/Compose của pipeline đã kiểm tra; chúng không thay thế biến runtime nêu trên.

Kiểm tra tên biến (không đọc giá trị) cho thấy root .env trong checkout hiện tại không có POSTGRES_* hoặc MINIO_USER/MINIO_PASSWORD. Nếu Terminal cũng chưa export các biến đó, Compose sẽ dùng giá trị dự phòng trong YAML (mật khẩu PostgreSQL 123456 và tài khoản MinIO minioadmin). Không áp dụng thay đổi credentials lên volume đang có nếu chưa xác nhận database/object store hiện dùng credential nào.

Đảm bảo SMARTREC_INTERNAL_TOKEN khớp giữa root .env (Spring/Compose) và ai-engine/.env (worker). Có thể so sánh mà không hiển thị giá trị:

```bash
set -a
source .env
ROOT_INTERNAL_TOKEN=$SMARTREC_INTERNAL_TOKEN
source ai-engine/.env
set +a
if [ -n "$ROOT_INTERNAL_TOKEN" ] && [ "$ROOT_INTERNAL_TOKEN" = "$SMARTREC_INTERNAL_TOKEN" ]; then
  echo "SMARTREC_INTERNAL_TOKEN: khop"
else
  echo "SMARTREC_INTERNAL_TOKEN: thieu hoac khong khop"
fi
unset ROOT_INTERNAL_TOKEN SMARTREC_INTERNAL_TOKEN
```

Chỉ source file cấu hình do bạn quản lý và giữ chúng theo cú pháp shell đơn giản. Không dùng echo biến token để kiểm tra. Nếu Spring property file override token, phải đảm bảo giá trị đó vẫn khớp.

### Gemini Fallback: tùy chọn, không bật mặc định

application.yml đặt GEMINI_FALLBACK_ENABLED=false và GEMINI_DATA_SHARING_APPROVED=false làm mặc định. GEMINI_MODEL và GEMINI_API_KEY không có giá trị mặc định; GEMINI_MAX_OUTPUT_TOKENS mặc định 2048, GEMINI_MAX_ATTEMPTS là 1, GEMINI_MAX_REQUESTS_PER_JOB là 0 và GEMINI_MAX_COST_PER_JOB_USD là 0. Chỉ có API key/model hoặc chỉ bật fallback không đủ để cho phép request.

Không tự source .env.spring.local, không tự bật phê duyệt chia sẻ dữ liệu và không chép API key sang Docker/Worker. Chỉ cấu hình sau khi có phê duyệt rõ ràng, đã kiểm tra redaction policy contact-details-v1 (email, URL, số điện thoại), chọn model/token limit có hỗ trợ và xác nhận budget. GEMINI_MAX_COST_PER_JOB_USD là gate cấu hình; code không biết giá token live nên không bảo đảm đó là bộ giới hạn chi phí thực tế. Không tự tăng request/token/cost budget.

Code từ chối candidate MAX_TOKENS/GEMINI_OUTPUT_TRUNCATED; không parse hoặc lưu JSON một phần và không tự tăng output limit. Retry provider có giới hạn theo GEMINI_MAX_ATTEMPTS và GEMINI_MAX_REQUESTS_PER_JOB, chịu các policy/cost gate. Automated tests dùng mock, không gọi Gemini thật.

### Kiểm tra cấu hình mà không in giá trị

Chạy trong đúng Terminal/process context. Lệnh chỉ in trạng thái có/thiếu:

```bash
set -a
source .env
ROOT_LOCAL_LLM_ENDPOINT=$LOCAL_LLM_ENDPOINT
ROOT_INTERNAL_TOKEN=$SMARTREC_INTERNAL_TOKEN
ROOT_HF_TOKEN=$HF_TOKEN
ROOT_LLM_ENABLED=$SMARTREC_LLM_ENABLED
ROOT_LLM_MODEL=$LOCAL_LLM_MODEL
ROOT_MINIO_USER=${MINIO_USER:-minioadmin}
ROOT_MINIO_PASSWORD=${MINIO_PASSWORD:-minioadmin}
ROOT_MINIO_BUCKET=${MINIO_BUCKET:-smartrec-media}
ROOT_POSTGRES_DB=${POSTGRES_DB:-smartrec_db}
ROOT_POSTGRES_USER=${POSTGRES_USER:-postgres}
ROOT_POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-123456}
ROOT_SPRING_DB=${SPRING_DATASOURCE_URL:-jdbc:postgresql://localhost:5432/smartrec_db}
ROOT_SPRING_DB_USER=${SPRING_DATASOURCE_USERNAME:-postgres}
ROOT_SPRING_DB_PASSWORD=${SPRING_DATASOURCE_PASSWORD:-123456}
source ai-engine/.env
set +a
python3 - <<'PY'
import os
from pathlib import Path
def report(label, ok):
    print(f"{label}: {'OK' if ok else 'CAN KIEM TRA'}")

def exists_dir(name):
    value = os.getenv(name, "")
    return bool(value) and Path(value).expanduser().is_dir()

root_token = os.getenv("ROOT_INTERNAL_TOKEN", "")
root_hf_token = os.getenv("ROOT_HF_TOKEN", "")
worker_token = os.getenv("SMARTREC_INTERNAL_TOKEN", "")
worker_hf_token = os.getenv("HF_TOKEN", "")
report("SMARTREC_INTERNAL_TOKEN root/worker", bool(root_token) and root_token == worker_token and "CHANGE_ME" not in root_token and "replace-with-" not in root_token)
report("HF_TOKEN root/worker", bool(root_hf_token) and root_hf_token == worker_hf_token and "CHANGE_ME" not in root_hf_token and "replace-with-" not in root_hf_token)
report("SMARTREC_LLM_ENABLED root/worker", os.getenv("ROOT_LLM_ENABLED") == os.getenv("SMARTREC_LLM_ENABLED") and os.getenv("SMARTREC_LLM_ENABLED") in {"true", "false"})
report("LOCAL_LLM_MODEL root/worker", bool(os.getenv("ROOT_LLM_MODEL")) and os.getenv("ROOT_LLM_MODEL") == os.getenv("LOCAL_LLM_MODEL"))
report("MinIO credential/bucket pairs", os.getenv("ROOT_MINIO_USER") == os.getenv("MINIO_ACCESS_KEY") and os.getenv("ROOT_MINIO_PASSWORD") == os.getenv("MINIO_SECRET_KEY") and os.getenv("ROOT_MINIO_BUCKET") == os.getenv("MINIO_BUCKET"))
spring_db = os.getenv("ROOT_SPRING_DB", "").rsplit("/", 1)[-1]
report("PostgreSQL/Spring database credentials", os.getenv("ROOT_POSTGRES_DB") == spring_db and os.getenv("ROOT_POSTGRES_USER") == os.getenv("ROOT_SPRING_DB_USER") and os.getenv("ROOT_POSTGRES_PASSWORD") == os.getenv("ROOT_SPRING_DB_PASSWORD"))
docker_endpoint = os.getenv("ROOT_LOCAL_LLM_ENDPOINT", "")
native_endpoint = os.getenv("LOCAL_LLM_ENDPOINT", "")
report("Ollama endpoint cho FastAPI Docker", "host.docker.internal:11434/api/generate" in docker_endpoint)
report("Ollama endpoint cho Python native", "localhost:11434/api/generate" in native_endpoint)
for name in ("SMARTREC_MODELS_DIR", "SMARTREC_HF_CACHE_DIR", "HF_HOME", "HF_HUB_CACHE", "PYANNOTE_CACHE"):
    report(name, exists_dir(name))
root_models_value = os.getenv("SMARTREC_MODELS_DIR", "")
root_hf_value = os.getenv("SMARTREC_HF_CACHE_DIR", "")
root_hf = Path(root_hf_value).expanduser()
native_hf_value = os.getenv("HF_HOME", "")
native_hf = Path(native_hf_value).expanduser()
report("Compose model/cache paths are absolute", bool(root_models_value and Path(root_models_value).is_absolute() and root_hf_value and root_hf.is_absolute()))
report("HF cache root/worker path", bool(root_hf_value and native_hf_value and root_hf.resolve() == native_hf.resolve()))
worker_root = Path("ai-engine")
for name in ("WHISPER_MODEL_PATH", "OCR_DETECTION_MODEL_DIR", "OCR_RECOGNITION_MODEL_DIR"):
    value = os.getenv(name, "")
    path = (worker_root / value).resolve() if value else None
    report(name, bool(path and (path.is_file() if name == "WHISPER_MODEL_PATH" else path.is_dir())))
models_root = Path(root_models_value).expanduser().resolve()
for relative in ("whisper/ggml-large-v3-turbo-q5_0.bin", "ocr/PP-OCRv6_medium_det", "ocr/PP-OCRv6_medium_rec"):
    path = models_root / relative
    report("Docker mount model " + relative.rsplit("/", 1)[-1], path.is_file() if relative.endswith(".bin") else path.is_dir())
PY
```

Lệnh chỉ in trạng thái kiểm tra, không in token, credential hoặc đường dẫn. Biến hiện diện không xác nhận token hợp lệ, endpoint reachable hoặc model đã tải. Chỉ source file cấu hình do bạn quản lý. Nếu cố ý cấu hình khác fallback mặc định, cập nhật cặp DB/MinIO tương ứng trong root .env và ai-engine/.env rồi chạy lại bước kiểm tra.

## 4. Khởi động toàn bộ server

Mở riêng Terminal cho từng tiến trình foreground. Chạy các lệnh tại đúng thư mục. Không chạy Docker ai-worker cùng native Celery Worker.

### Terminal 1 — Docker Infrastructure và FastAPI

Khởi động Docker Desktop, rồi kiểm tra daemon:

```bash
docker info
```

Từ repository root (thư mục có docker-compose.yml), khởi động service hiện có:

```bash
docker compose up -d postgres redis minio minio-init chromadb ai-engine
docker compose ps
```

Lần đầu build image hoặc sau khi sửa mã FastAPI/schema:

```bash
docker compose up -d --build postgres redis minio minio-init chromadb ai-engine
```

Chỉ build/recreate FastAPI sau khi sửa code của nó:

```bash
docker compose up -d --build --no-deps ai-engine
```

Compose chuẩn không bind-mount ai-engine/app; container cũ có thể chạy code cũ nếu không build/recreate. docker-compose.dev.yml chỉ thêm bind mount read-only ./ai-engine/app:/app/app; file này không tự bật Uvicorn reload. Nếu dùng override dev, ghi cả hai file trong lệnh Compose:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis minio minio-init chromadb ai-engine
```

Không đưa ai-worker vào lệnh hybrid này. Nếu compatibility worker đã chạy trong Docker, dừng nó trước khi bật native worker:

```bash
docker compose stop ai-worker
```

depends_on chỉ sắp thứ tự khởi tạo, không khẳng định PostgreSQL/Redis/MinIO/Chroma đã sẵn sàng. Compose hiện không khai báo healthcheck cho toàn bộ service. minio-init chạy một lần; Exited (0) sau khi tạo bucket là bình thường.

### Terminal 2 — Ollama trên macOS

Ollama chạy trên host, không nằm trong Compose. Nếu lệnh ollama không có, cài ứng dụng macOS từ trang chính thức https://ollama.com/download/mac. Nếu Ollama server chưa chạy, khởi động bằng lệnh sau và giữ Terminal mở:

```bash
ollama serve
```

Nếu Ollama app đã mở server, không chạy server thứ hai. Trong Terminal khác kiểm tra:

```bash
curl -fsS http://localhost:11434/api/tags
ollama list
```

Nếu model thiếu, thực hiện lệnh pull ở mục 2. Smoke request local (một từ, yêu cầu unload model sau request):

```bash
curl -fsS http://localhost:11434/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen2.5:3b-instruct-q4_K_M","prompt":"Trả lời đúng một từ: OK","stream":false,"keep_alive":0}'
```

FastAPI Docker phải gọi host bằng host.docker.internal, không phải localhost. Kiểm tra từ container, chỉ in status:

```bash
docker compose exec ai-engine python -c 'import urllib.request; r=urllib.request.urlopen("http://host.docker.internal:11434/api/tags", timeout=5); print("HTTP", r.status)'
```

Kiểm tra root .env có LOCAL_LLM_ENDPOINT=http://host.docker.internal:11434/api/generate và model đúng. Smoke request chỉ kiểm tra API/model đơn giản, chưa kiểm tra prompt evidence hay validation SmartRec.

### Terminal 3 — Spring Boot Backend

Từ repository root, export root .env vào process Spring. Spring Boot không tự đọc .env:

```bash
set -a
source .env
set +a
./mvnw spring-boot:run
```

Ứng dụng khai báo cổng 8082 và context path /api/v1. Kiểm tra startup log, kết nối PostgreSQL/Redis/MinIO và listener:

```bash
lsof -nP -iTCP:8082 -sTCP:LISTEN
```

Optional config/application-local-secrets.properties được import từ repository root nếu tồn tại. Không cần source file .properties. Không source .env.spring.local trong luồng thường ngày.

### Terminal 4 — Một Celery Worker native

Thiết lập một lần từ repository root. Python 3.11 là phiên bản yêu cầu của dependency AI Engine:

```bash
cd ai-engine
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt -r requirements_ai.txt
python -m pip check
cd ..
```

Kiểm tra ffmpeg, ffprobe, whisper-cli, model Whisper và cache Pyannote. requirements_ocr.txt tách riêng vì có dependency OpenCV/PaddleOCR; xem lưu ý bên dưới trước khi cài vào cùng môi trường.

Từ repository root, khởi động worker:

```bash
cd ai-engine
source .venv/bin/activate
set -a
source ../.env
source .env
set +a
python -m celery -A app.celery_app:celery_app worker --loglevel=INFO --pool=solo --concurrency=1
```

Worker phải log trạng thái ready và broker host/port không chứa thông tin xác thực. Giữ tiến trình chạy khi xử lý Job. --pool=solo --concurrency=1 serialize task, giảm khả năng Pyannote/STT/OCR/Ollama tranh unified memory.

AI Engine README xác nhận cài native audio/diarization bằng requirements.txt và requirements_ai.txt. README cảnh báo việc cài chung OpenCV packages từ requirements_ocr.txt với Pyannote environment chưa được xác minh sạch. Không cài đè OCR requirements vào .venv đang hoạt động một cách mù quáng. Với video, xác nhận import PaddleOCR được trong đúng worker environment và model directories trước E2E. Nếu chưa có stack OCR tương thích, dùng audio-only để kiểm thử phần còn lại và ghi nhận nhánh video/OCR chưa sẵn sàng.

### Terminal 5 — React Frontend

Từ repository root:

```bash
cd Frontend/smartrec-frontend
npm ci
npm run dev
```

package-lock.json có trong repository và script dev đặt cổng 5173. Mở http://localhost:5173. Frontend mặc định gọi http://localhost:8082/api/v1; đổi VITE_API_BASE_URL thì khởi động lại Vite. Đăng ký tài khoản local nếu chưa có rồi đăng nhập. Không đặt token/password backend trong VITE_*.

## 5. Checklist trước khi chạy E2E

| Thành phần | Cách kiểm tra | Kết quả mong đợi | Nếu chưa đạt |
| --- | --- | --- | --- |
| Docker daemon | docker info | Có thông tin daemon, không báo connect error. | Mở Docker Desktop và đợi daemon sẵn sàng. |
| Container/service | docker compose ps | postgres, redis, minio, chromadb, ai-engine đang chạy; minio-init có thể Exited (0). | Xem docker compose logs --tail=100 SERVICE_NAME. |
| PostgreSQL | docker compose exec postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | accepting connections. | Xem log postgres, kiểm tra port 5432 và cấu hình DB. |
| Redis | docker compose exec redis redis-cli ping | PONG. | Xem log redis và kiểm tra port 6379. |
| MinIO | curl -fsS http://localhost:9000/minio/health/live | HTTP 200. | Xem log minio; đợi minio-init hoàn tất. |
| ChromaDB | curl -fsS http://localhost:8001/api/v2/heartbeat | JSON heartbeat. | Xem log chromadb; Compose có service này nhưng không kiểm tra health tự động. |
| FastAPI | curl -fsS http://localhost:8000/health | status là HEALTHY. | docker compose logs --tail=200 ai-engine. HTTP 200 chỉ xác nhận route health, không probe Redis/Ollama/model. |
| Docker đến Ollama | Python urllib check từ container ở Terminal 2 | HTTP 200. | Kiểm tra Ollama host và LOCAL_LLM_ENDPOINT. |
| Spring Boot | lsof -nP -iTCP:8082 -sTCP:LISTEN và log startup | Backend lắng nghe 8082, startup không lỗi DB. | Kiểm tra cấu hình đã export, DB/Redis/MinIO và log Backend. |
| Celery Worker | Log ready; có thể chạy inspect ping | Worker kết nối Redis và trả pong. | Kiểm tra env, native Redis là localhost, compatibility ai-worker đã dừng. |
| Ollama | curl -fsS http://localhost:11434/api/tags; ollama list | HTTP 200 và có model đã cấu hình. | Khởi động Ollama; chỉ pull model nếu thiếu. |
| Frontend | Mở http://localhost:5173 | Trang login hiện ra và API base trỏ Backend 8082. | Xem log Vite, VITE_API_BASE_URL và CORS origin. |

Kiểm tra Celery từ Terminal mới:

```bash
cd ai-engine
source .venv/bin/activate
set -a
source ../.env
source .env
set +a
python -m celery -A app.celery_app:celery_app inspect ping --timeout=5
```

HTTP 200 từ /health, container Up hoặc Celery pong chỉ chứng minh từng thành phần phản hồi. Chỉ Job thực tế có stage thành công và kết quả hợp lệ mới xác minh E2E.

## 6. Chạy E2E và kiểm tra kết quả

1. Chuẩn bị file audio/video tiếng Việt ngắn, rõ tiếng nói và không chứa dữ liệu nhạy cảm. Chọn audio để kiểm tra STT; chọn .mp4 hoặc .mkv để đi qua nhánh OCR hiện tại. OCR không thấy slide có thể là kết quả hợp lệ.
2. Đăng ký/đăng nhập tại http://localhost:5173.
3. Upload file vào Meeting qua Frontend, đợi hoàn tất rồi dùng chức năng bắt đầu xử lý.
4. Ghi lại meetingId/jobId hiển thị trong giao diện/log; không chia sẻ transcript hoặc media.
5. Theo dõi Terminal Celery: task được nhận, tiếp đó stage FFMPEG, WEBRTC, PYANNOTE, OUTPUT. Trong OUTPUT kiểm tra log STT; với MP4/MKV kiểm tra thêm OCR.
6. Theo dõi FastAPI bằng docker compose logs -f ai-engine. FastAPI container gọi Ollama. Log local inference ghi metadata như token count, duration, done_reason, không cần prompt.
7. Spring nhận callback và lưu transcript/slide metadata/kết quả hợp lệ. Frontend Meeting page tải lại trạng thái/results.
8. Xác nhận transcript có thời gian và speaker attribution hợp lý. Với video kiểm tra tab OCR; NO_SLIDES_DETECTED sau OCR thành công không đồng nghĩa stage lỗi.
9. Kiểm tra LLM riêng: yêu cầu llmStatus=SUCCESS, summary có dữ liệu và action items hợp lệ; xem llmProvider/llmFallbackUsed nếu API trả các trường này.
10. Ghi nhận jobStatus, stage statuses, số transcript/OCR, llmStatus, llmFailureCode nếu có và việc Frontend hiển thị dữ liệu. Không báo E2E thành công chỉ dựa trên Core OUTPUT.

Các endpoint Backend đã xác nhận:

- GET /api/v1/jobs/{jobId} trả Job status. Endpoint cho người dùng đã xác thực hoặc internal worker có header X-Internal-Token.
- GET /api/v1/meetings/{meetingId}/jobs/{jobId}/results trả transcript, summary, action items, llmStatus. Dùng Frontend để tránh thao tác JWT thủ công; gọi trực tiếp cần JWT trong Authorization: Bearer ....
- FastAPI health: GET http://localhost:8000/health.
- Các FastAPI LLM routes /api/v1/internal/llm/prepare, /generate, /validate yêu cầu internal token; dùng qua Backend Router, không gọi thủ công bằng secret.

Không đưa JWT hoặc SMARTREC_INTERNAL_TOKEN vào command history. Nếu kiểm tra PostgreSQL trực tiếp, chỉ liệt kê schema/bảng trước; tránh truy vấn/in transcript text. application.yml hiện bật Hibernate SQL bind logging TRACE; log Backend có thể chứa giá trị bind của dữ liệu. Chỉ dùng media không nhạy cảm cho thử nghiệm local và không gửi log thô ra ngoài.

Lệnh dưới đây chỉ liệt kê table name, không in nội dung meeting/transcript:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'
```

Đối chiếu Job/Meeting bằng ID sau khi xem entity/migration để xác định bảng và cột đang dùng; ưu tiên Results API/UI cho xác nhận nội dung.

## 7. Local LLM và Gemini Fallback

### Ý nghĩa trạng thái

| Trường | Cách đọc |
| --- | --- |
| jobStatus | Trạng thái Core Job; COMPLETED không có nghĩa LLM summary thành công. |
| llmStatus | SUCCESS, FAILED, DISABLED, PENDING hoặc UNAVAILABLE theo kết quả enrichment đã lưu/trạng thái Job. |
| llmFailureCode | Mã lỗi enrichment; lưu lại mã để chẩn đoán, không chỉ nhìn HTTP/job status. |
| llmProvider | Provider ghi nhận cho summary đã lưu, nếu có. |
| llmFallbackUsed | Cho biết fallback provider đã được gọi khi có giá trị; có thể null nếu chưa có usage record/chưa biết. |

### Các trường hợp cần phân biệt

- Local LLM thành công: llmStatus=SUCCESS, có summary vượt schema/source-reference/evidence validation.
- Local LLM lỗi JSON/evidence: xem llmFailureCode và log safe diagnostics. Validation không bị tắt; summary chưa xác minh không được lưu.
- Local LLM timeout/unavailable: kiểm tra Docker → Ollama, endpoint, model và timeout; không chạy nhiều job LLM song song.
- Gemini Fallback thành công: chỉ kết luận khi API có llmStatus=SUCCESS, llmProvider cho biết Gemini và kết quả vượt cùng evidence validation.
- Gemini HTTP 429: mã lỗi có thể phân biệt rate limit với quota exhaustion; xem llmFailureCode và status log. Không tự tăng quota, request/cost budget hoặc retry.
- Gemini HTTP 503: lỗi dịch vụ tạm thời; retry bị giới hạn, không lặp vô hạn.
- Gemini MAX_TOKENS: trả GEMINI_OUTPUT_TRUNCATED; candidate một phần bị loại, không được xem JSON dở dang là summary.
- Core OUTPUT thành công nhưng LLM thất bại: jobStatus=COMPLETED cùng llmStatus=FAILED, có thể có llmFailureCode; Core được giữ nhưng không có summary hợp lệ.

FastAPI /prepare HTTP 200 chỉ xác nhận contract prompt đã chuẩn bị. Để xác nhận model thực sự được gọi, đối chiếu log Local inference complete trong FastAPI với thời điểm Ollama request, sau đó kiểm tra llmStatus=SUCCESS. ollama ps chỉ phản ánh model còn resident tại thời điểm kiểm tra; client hiện dùng keep_alive=0 nên model có thể unload ngay sau inference.

POST /jobs/{jobId}/retry hiện chạy lại media pipeline; đây không phải retry riêng LLM từ transcript đã lưu. Không dùng nút retry nếu chỉ muốn thử lại enrichment.

## 8. Debug, log và kiểm thử

### Theo dõi log/process

```bash
docker compose ps
docker compose logs --tail=200 -f ai-engine
docker compose logs --tail=100 -f postgres redis minio chromadb
ollama ps
ollama list
```

Celery, Spring Boot và Vite chạy foreground nên xem log ở Terminal tương ứng. Log AI Engine ghi loại lỗi, token/time metadata và mã validation; không bật log prompt/transcript để chẩn đoán thông thường. Không chia sẻ output docker compose config vì nội dung sau nội suy có thể chứa secret.

### Kiểm thử tự động

Chạy khi không có E2E nặng dùng tài nguyên:

```bash
# Kiểm thử Java / Spring Boot
./mvnw test

# Kiểm thử Python / AI Engine
cd ai-engine
source .venv/bin/activate
python -m pytest

# React: package.json không khai báo script test
cd ../Frontend/smartrec-frontend
npm run lint
npm run build
```

Frontend không có npm test script; lint và build là các lệnh kiểm tra hiện có. Unit test không thay thế E2E. Test Gemini phải dùng mock, không gọi API thật.

Các requirements runtime của Python không liệt kê pytest. Nếu module pytest chưa có trong môi trường dành cho test, cài test runner trong virtual environment phát triển riêng; không thêm test dependency vào runtime image chỉ để chạy test.

### Local LLM Debug Capture/Replay — chỉ development và opt-in

Mặc định capture tắt. Chỉ bật khi đã chấp thuận lưu dữ liệu job trong môi trường development; capture giữ raw output Ollama và evidence nên là dữ liệu nhạy cảm. Không bật production, không commit capture, không gửi capture/log ra ngoài. Gemini response và credential không được capture.

Từ repository root, bật rõ hai cờ qua Compose khi recreate FastAPI:

```bash
SMARTREC_ENVIRONMENT=development SMARTREC_LLM_DEBUG_CAPTURE_ENABLED=true \
  docker compose up -d --build --no-deps ai-engine
```

Capture nằm trong volume riêng /var/lib/smartrec/llm-debug, không được public qua route. Mặc định giới hạn 512 KiB mỗi file, 16 MiB tổng và retention 24 giờ (Settings đặt giới hạn tối đa). Capture vượt ngưỡng bị bỏ toàn bộ, không cắt cụt. Cleanup chạy định kỳ và khi thao tác store.

Liệt kê, replay normalization/validation offline (không gọi Ollama/Gemini), rồi xóa capture:

```bash
docker compose exec ai-engine python -m app.services.local_llm_debug list
docker compose exec ai-engine python -m app.services.local_llm_debug replay capture-<timestamp>-<uuid>.json
docker compose exec ai-engine python -m app.services.local_llm_debug delete --file capture-<timestamp>-<uuid>.json
docker compose exec ai-engine python -m app.services.local_llm_debug delete --all
```

Replay mặc định chỉ in validation result và diagnostics an toàn. Chỉ dùng --show-result trong Terminal riêng tư khi cần xem summary đã normalize. Tắt capture sau điều tra:

```bash
SMARTREC_ENVIRONMENT=production SMARTREC_LLM_DEBUG_CAPTURE_ENABLED=false \
  docker compose up -d --no-deps ai-engine
```

Không dùng delete --all nếu vẫn cần capture.

## 9. Lỗi thường gặp

| Triệu chứng | Kiểm tra | Cách xử lý |
| --- | --- | --- |
| Docker daemon chưa chạy | docker info | Mở Docker Desktop, đợi daemon sẵn sàng rồi chạy Compose. |
| Port bị chiếm | lsof -nP -iTCP -sTCP:LISTEN | Đối chiếu cổng trong bảng ở mục 2; dừng process do bạn quản lý hoặc cấu hình lại port nhất quán. Không kill process lạ. |
| PostgreSQL chưa ready | docker compose logs --tail=100 postgres; pg_isready như checklist | Kiểm tra daemon, port 5432, biến DB và log init; không xóa volume nếu muốn giữ DB. |
| Redis connection refused | docker compose exec redis redis-cli ping; log Redis | Đợi Redis sẵn sàng; native worker phải dùng localhost:6379, không dùng hostname redis. |
| MinIO không kết nối | curl -fsS http://localhost:9000/minio/health/live; log minio/minio-init | Kiểm tra API 9000, bucket init và cặp MinIO key giữa Compose, Spring, worker. |
| Internal token sai/thiếu | Kiểm tra trạng thái có/thiếu và so khớp an toàn theo mục 3 | Đặt cùng SMARTREC_INTERNAL_TOKEN cho Spring/Compose/worker rồi restart; không in token. |
| AI Engine lỗi config hoặc code cũ | docker compose ps; docker compose logs --tail=200 ai-engine; curl -fsS http://localhost:8000/health | Kiểm tra biến Compose bắt buộc và mount paths; rebuild/recreate ai-engine sau code change. Không chia sẻ docker compose config output. |
| Celery không nhận task | Worker log ready; inspect ping; docker compose stop ai-worker | Xác nhận worker/Backend dùng cùng Redis, worker source đúng root rồi ai-engine .env và không có worker thứ hai. |
| Whisper model không tìm thấy | command -v whisper-cli; test -r models/whisper/ggml-large-v3-turbo-q5_0.bin | Kiểm tra WHISPER_CPP_BIN, WHISPER_MODEL_PATH, working directory; không đổi model để lách lỗi. |
| Pyannote thiếu HF_TOKEN/quyền | Kiểm tra biến có/thiếu mà không in; worker log/cache path | Cấp quyền Hugging Face, nạp token trong ai-engine/.env, xác nhận cache. Không dán token vào terminal output. |
| OCR không khởi tạo hoặc không thấy slide | python -c 'import paddleocr'; log OUTPUT; model paths | Kiểm tra environment OCR tương thích và model detector/recognizer; NO_SLIDES_DETECTED sau OCR thành công có thể hợp lệ. |
| Ollama connection refused | curl -fsS http://localhost:11434/api/tags; ollama list | Khởi chạy Ollama native, kiểm tra LOCAL_LLM_ENDPOINT ở root .env. |
| Docker không gọi được Ollama host | Python urllib check từ container; FastAPI logs | Dùng host.docker.internal:11434, không dùng localhost trong container; xác nhận Ollama đang phục vụ request. |
| Local LLM trả JSON/evidence không hợp lệ | llmStatus, llmFailureCode, log an toàn; capture/replay opt-in nếu cần | Giữ strict validation. Không bỏ source refs/validation và không coi Core COMPLETED là summary thành công. |
| Gemini quota/rate limit | llmFailureCode và HTTP status an toàn trong log | Phân biệt 429 quota/rate với 503 service. Không tự tăng request/token/cost limit, bật Gemini hay phê duyệt chia sẻ dữ liệu. |
| Máy thiếu RAM hoặc swap cao | Activity Monitor, worker log, ollama ps | Dùng clip ngắn, một worker solo, tránh nạp thêm model; đóng ứng dụng nặng. Không tăng concurrency. |
| Frontend không gọi Backend | DevTools Network; VITE_API_BASE_URL; Spring 8082; CORS origin | Dùng http://localhost:8082/api/v1; restart Vite sau khi đổi env; đăng nhập lại nếu JWT hết hạn. |
| Job không sang COMPLETED | Meeting/Job page, GET /api/v1/jobs/{jobId}, Celery/Spring logs | Tìm stage dừng và errorCode; kiểm tra callback/token/Redis. FastAPI /health không đủ. |
| Job COMPLETED nhưng thiếu summary | Results API/Meeting page: llmStatus, llmFailureCode | Core có thể thành công trong khi LLM thất bại/tắt. Không báo summary thành công; retry endpoint hiện chạy lại toàn bộ pipeline. |

## 10. Dừng và khởi động lại

- Với Spring Boot, Celery, Vite và ollama serve chạy foreground, nhấn Ctrl+C trong đúng Terminal.
- Nếu Ollama chạy như ứng dụng macOS/service, thoát/dừng bằng ứng dụng hoặc service manager đã dùng để khởi động.
- Dừng các service Compose nhưng giữ containers/volumes:

```bash
docker compose stop postgres redis minio chromadb ai-engine
```

- Gỡ containers/network nhưng giữ named volumes:

```bash
docker compose down
```

- docker compose down -v xóa named volumes PostgreSQL, Redis, MinIO, ChromaDB và debug capture. Đây là thao tác xóa dữ liệu; không dùng khi muốn giữ meeting/jobs/uploads.
- Sau khi sửa code FastAPI ở Compose chuẩn (không bind mount), build và recreate ai-engine bằng docker compose up -d --build --no-deps ai-engine.
- Sau khi đổi root .env cho Compose, recreate container nhận biến. Sau khi đổi ai-engine/.env, restart Celery Worker để nạp lại. Sau khi đổi Spring env/property file, restart Spring Boot. Sau khi đổi VITE_*, restart Vite.
- Khởi động lại theo thứ tự: Docker services → Ollama (nếu dùng LLM) → Spring Boot → Celery Worker → Frontend.

## 11. QUICK START — KHỞI ĐỘNG SMARTREC MỖI NGÀY

Dùng phần này sau khi đã tạo/cấu hình hai file .env, cài dependencies, có model cần thiết và xác nhận token/cache paths. Mở năm Terminal. Không source Gemini config và không bật debug capture trong Quick Start.

### Terminal 1 — Repository root: Docker

```bash
docker compose up -d postgres redis minio minio-init chromadb ai-engine
docker compose ps
curl -fsS http://localhost:8000/health
docker compose exec redis redis-cli ping
curl -fsS http://localhost:9000/minio/health/live
```

Lần đầu hoặc sau thay đổi mã FastAPI, dùng docker compose up -d --build postgres redis minio minio-init chromadb ai-engine.

### Terminal 2 — Ollama native trên macOS

Nếu Ollama chưa chạy, khởi động server và giữ Terminal này mở; nếu Ollama app đã chạy thì không mở server trùng:

```bash
ollama serve
```

Kiểm tra ollama list và curl -fsS http://localhost:11434/api/tags. Chỉ pull model nếu thiếu.

### Terminal 3 — Repository root: Spring Boot

```bash
set -a
source .env
set +a
./mvnw spring-boot:run
```

### Terminal 4 — Repository root rồi vào ai-engine: Celery Worker

```bash
cd ai-engine
source .venv/bin/activate
set -a
source ../.env
source .env
set +a
python -m celery -A app.celery_app:celery_app worker --loglevel=INFO --pool=solo --concurrency=1
```

### Terminal 5 — Frontend React

```bash
cd Frontend/smartrec-frontend
npm ci
npm run dev
```

Mở http://localhost:5173, đăng nhập, upload một file ngắn và bắt đầu Job. Xác nhận Job thực tế đã chạy các stage mong đợi, transcript đã lưu, rồi kiểm tra riêng llmStatus=SUCCESS và summary/action items. Với video, xác nhận OCR; nếu OCR environment chưa được thiết lập, không kết luận nhánh video/OCR đã được E2E kiểm thử.
