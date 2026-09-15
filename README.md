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
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

### API Endpoints cơ bản
- Backend base URL: `http://localhost:8082/api/v1`
- AI Engine base URL: `http://localhost:8000`
