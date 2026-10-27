# SmartRec

Smart Recommendation System built with Spring Boot, FastAPI, and Vite.

## Project Structure

```text
SmartRec/
├── Frontend/
│   └── smartrec-frontend/    # Frontend application (Vite)
├── ai-engine/                # AI microservice (FastAPI + FFmpeg)
├── src/                      # Backend source code (Spring Boot)
├── docker-compose.yml        # Docker config (Postgres, Redis, MinIO, ChromaDB, AI)
├── pom.xml                   # Backend dependencies
└── README.md
```

## Getting Started

### Prerequisites
- **Java 17** or higher
- **Maven** 3.6+
- **Python** 3.11+
- **Node.js** & **npm**
- **Docker Desktop**

---

## 🚀 Run Instructions (Hướng dẫn chạy dự án)


### Cấu hình AI Models trước khi chạy Docker

SmartRec sử dụng faster-whisper large-v3 để nhận dạng tiếng nói.
Model được lưu bên ngoài repository và mount vào Docker ở chế độ chỉ đọc.

**Cấu trúc thư mục:**

~~~text
<SMARTREC_MODELS_DIR>/
└── faster-whisper-large-v3/
    ├── model.bin
    ├── config.json
    ├── tokenizer.json
    └── ...
~~~

`SMARTREC_MODELS_DIR` phải trỏ đến thư mục cha chứa `faster-whisper-large-v3`.

**macOS / Linux:**

~~~bash
export SMARTREC_MODELS_DIR="$HOME/smartrec-models"
~~~

**Windows PowerShell:**

~~~powershell
$env:SMARTREC_MODELS_DIR = "D:\\smartrec-models"
~~~

Docker Compose sử dụng cấu hình:

- Model path trong container: `/models/faster-whisper-large-v3`
- Biến môi trường: `WHISPER_MODEL_PATH`
- Volume mount: read-only (`:ro`)
- Model weights không được đóng gói vào Docker image.

**Các biến môi trường liên quan:**

- `SMARTREC_INTERNAL_TOKEN`: Bắt buộc, phải khớp với Backend.
- `HF_TOKEN`: Cần thiết khi truy cập các model Pyannote gated trên Hugging Face.
- `DIARIZATION_DEVICE`: Có thể cấu hình `auto`, `cpu`, `cuda` hoặc `mps`.

Có thể cấu hình các biến trong môi trường hoặc file `.env` cục bộ.

Không commit `.env`, credentials, API tokens hoặc model weights lên GitHub.

**Chạy Docker CPU:**

~~~bash
docker compose up -d --build
~~~

**Chạy Docker NVIDIA GPU:**

Yêu cầu NVIDIA GPU, driver và NVIDIA Container Toolkit tương thích.
GPU image được xây dựng cho nền tảng Linux AMD64.

~~~bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
~~~

Lưu ý: Docker GPU build thành công không đồng nghĩa với việc đã xác minh NVIDIA inference thực tế.

---

### Bước 1: Chạy Môi trường Hạ tầng (Docker)
Cần khởi động các dịch vụ hỗ trợ trước khi chạy Backend.
```bash
docker-compose up -d
```
- **AI Engine** chạy ở port `8000`
- **ChromaDB** chạy ở port `8001`
- **MinIO** chạy ở port `9000/9001` (Tài khoản: minioadmin / minioadmin)
- **Postgres** chạy ở port `5432`
- **Redis** chạy ở port `6379`

### Bước 2: Chạy Backend (Spring Boot)
Mở một terminal mới tại thư mục gốc của dự án và chạy lệnh sau:
```bash
./mvnw spring-boot:run
```
- Backend sẽ được khởi chạy tại địa chỉ: `http://localhost:8082`

### Bước 3: Chạy Frontend (Vite)
Mở một terminal khác, di chuyển vào thư mục Frontend và khởi chạy:
```bash
cd Frontend/smartrec-frontend
npm install
npm run dev
```

### Bước 4: Chạy AI Engine thủ công (tùy chọn)
Nếu không chạy qua Docker, có thể chạy AI service trực tiếp:
```bash
cd ai-engine
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements_ai.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

### API Endpoints cơ bản
- Backend base URL: `http://localhost:8082/api/v1`
- AI Engine base URL: `http://localhost:8000`
