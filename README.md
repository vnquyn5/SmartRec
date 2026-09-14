# SmartRec

Smart Recommendation System built with Spring Boot (Backend) và Vite (Frontend).

## Project Structure

```text
SmartRec Demo/
├── Frontend/
│   └── smartrec-frontend/    # Frontend application (Vite)
├── src/                      # Backend source code (Spring Boot)
├── docker-compose.yml        # Docker config (Postgres, Redis, MinIO, Keycloak)
├── pom.xml                   # Backend dependencies
└── README.md
```

## Getting Started

### Prerequisites
- **Java 17** or higher
- **Maven** 3.6+
- **Node.js** & **npm**
- **Docker Desktop**

---

## 🚀 Run Instructions (Hướng dẫn chạy dự án)

### Bước 1: Chạy Môi trường Hạ tầng (Docker)
Cần khởi động các dịch vụ hỗ trợ (PostgreSQL, Redis, MinIO, Keycloak) trước khi chạy Backend.
```bash
docker-compose up -d
```
- **Keycloak** chạy ở port `8081` (Tài khoản: admin / admin)
- **MinIO** chạy ở port `9000/9001` (Tài khoản: minioadmin / minioadmin)
- **Postgres** chạy ở port `5432`
- **Redis** chạy ở port `6379`

### Bước 2: Chạy Backend (Spring Boot)
Mở một terminal mới tại thư mục gốc của dự án (`SmartRec Demo`) và chạy lệnh sau:
```bash
mvn spring-boot:run
```
- Backend sẽ được khởi chạy tại địa chỉ: `http://localhost:8082`

### Bước 3: Chạy Frontend (Vite)
Mở một terminal khác, di chuyển vào thư mục Frontend và khởi chạy:
```bash
cd Frontend/smartrec-frontend
npm install
npm run dev
```

---

### API Endpoints cơ bản
- `GET /api/v1/` - Trả về Welcome message.
