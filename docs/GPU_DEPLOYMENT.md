# SmartRec GPU Deployment Guide

## 1. Kiến trúc triển khai

SmartRec triển khai theo mô hình phân tán:

**Mac (Backend Host)**

- Spring Boot Backend: `8082`, context path `/api/v1`
- PostgreSQL
- MinIO: `9000`
- React Frontend

**Ubuntu GPU Server**

- FastAPI AI Engine: `8000`
- Redis: `6379` (nội bộ)
- Celery GPU Worker
- Pyannote Speaker Diarization 3.1
- PyTorch 2.7.1 + CUDA 12.8

Hai máy kết nối qua Tailscale.

Luồng xử lý:

`Frontend → Backend → GPU FastAPI → Redis → Celery GPU Worker → MinIO → Pyannote → Backend Callback`

## 2. Yêu cầu hệ thống

- Ubuntu Linux và GPU NVIDIA tương thích CUDA.
- NVIDIA Driver hoạt động.
- Docker Engine và Docker Compose hỗ trợ `!override`.
- NVIDIA Container Toolkit.
- Tailscale kết nối cùng tailnet với Mac.
- Hugging Face token được cấp quyền cho Pyannote 3.1 và các model phụ thuộc.

## 3. Chuẩn bị GPU Server

Clone repository từ nhánh triển khai:

```bash
git clone -b feature/gpu-deployment https://github.com/vnquyn5/SmartRec.git
cd SmartRec
```

Kiểm tra môi trường:

```bash
bash scripts/gpu/setup.sh
```

Nếu có lỗi về NVIDIA Driver, Docker hoặc Tailscale, xử lý theo thông báo của script rồi chạy lại.

## 4. Cấu hình biến môi trường

```bash
cp .env.gpu.example .env
chmod 600 .env
nano .env
```

Cập nhật:

- `GPU_TAILSCALE_IP`: IP Tailscale của GPU Server.
- `BACKEND_BASE_URL`: địa chỉ Backend trên Mac.
- `MINIO_ENDPOINT`: địa chỉ MinIO trên Mac.
- `SMARTREC_INTERNAL_TOKEN`: phải trùng token của Backend.
- `HF_TOKEN`: token Hugging Face hợp lệ.
- `MINIO_USER`, `MINIO_PASSWORD`: thông tin xác thực MinIO đang chạy trên Mac.

Không commit `.env` hoặc token thật.

## 5. Build và khởi động

Build lần đầu:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.gpu.yml \
  build ai-engine ai-worker
```

Khởi động:

```bash
bash scripts/gpu/start.sh
```

Kiểm tra:

```bash
bash scripts/gpu/check.sh
```

Xem log:

```bash
bash scripts/gpu/logs.sh
```

Dừng dịch vụ:

```bash
bash scripts/gpu/stop.sh
```

## 6. Cấu hình Backend Mac

Đặt `AI_ENGINE_BASE_URL` thành địa chỉ FastAPI của GPU Server:

```text
http://<GPU_TAILSCALE_IP>:8000
```

Đảm bảo Backend đang sử dụng cùng `SMARTREC_INTERNAL_TOKEN`.

GPU Worker sử dụng địa chỉ Tailscale của Mac để truy cập Backend và MinIO.

## 7. Kiểm thử E2E

1. Đăng nhập SmartRec Frontend.
2. Upload một file audio hợp lệ.
3. Tạo Job xử lý cuộc họp.
4. Xác minh FastAPI nhận yêu cầu enqueue.
5. Xác minh Celery Worker nhận và xử lý Job.
6. Xác minh Pyannote nạp model trên CUDA.
7. Xác minh Worker gửi callback thành công.
8. Xác minh trạng thái Job và kết quả speaker diarization trên Frontend.

`check.sh` chỉ kiểm tra các dịch vụ. E2E phải được xác nhận riêng.

## 8. Khôi phục khi thuê GPU Server mới

1. Chuẩn bị Ubuntu, NVIDIA Driver, Docker, Toolkit và Tailscale.
2. Clone repository.
3. Tạo `.env` từ `.env.gpu.example`.
4. Chạy `setup.sh` để kiểm tra hệ thống.
5. Build Docker images.
6. Chạy `start.sh`.
7. Chạy `check.sh`.
8. Kiểm thử E2E.

Model cache sẽ được tải lại nếu sử dụng VM mới và không khôi phục thư mục cache.

## 9. Bảo mật

- Không đẩy token hoặc credentials lên GitHub.
- Chỉ publish FastAPI qua Tailscale.
- Redis chỉ bind localhost.
- Không mở MinIO của Mac ra Internet công cộng.
- Xoay vòng credentials khi có nghi ngờ bị lộ.
