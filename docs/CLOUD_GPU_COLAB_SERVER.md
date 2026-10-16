# Tài liệu Hệ thống Cloud GPU Diarization Server (Google Colab - Tesla T4)

## 1. Tổng quan Kiến trúc

Hệ thống **SmartRec Cloud GPU Server** chuyển toàn bộ tác vụ nặng nhất của pipeline âm thanh (**Speaker Diarization & Speaker Embedding Extraction** bằng mô hình `pyannote/speaker-diarization-community-1` / `3.1`) từ CPU máy local lên **GPU NVIDIA Tesla T4 trên Google Colab**, giúp giảm thời gian xử lý từ hàng chục phút xuống chỉ còn **10–15 giây**.

```
[Web SmartRec] ──► [Spring Boot Backend] ──► [Redis Queue] ──► [AI Worker (Local Docker)]
                                                                       │
                    ┌──────────────────────────────────────────────────┤
                    ▼                                                  ▼
     [1. FFMPEG + WebRTC ANS/AEC]                      [2. Đọc URL mới nhất từ GitHub Gist]
        (Chuẩn hóa 16kHz Mono)                                 (gpu_url.txt)
                    │                                                  │
                    └──────────────────────┬───────────────────────────┘
                                           ▼
                        [3. Cloud GPU Server (Google Colab T4)]
                         POST /diarize (Cloudflare Tunnel HTTPS)
                                           │
                                           ▼
                    [4. Trả về Speaker Turns + 256-d Embeddings]
```

---

## 2. Cấu trúc Thư mục & Các File Thành phần

| Đường dẫn File | Vai trò |
| :--- | :--- |
| `cloud-gpu-server/colab_gpu_server.py` | Script All-in-One chạy trên Google Colab: cài đặt thư viện, khởi tạo FastAPI GPU Server, mở Cloudflare Tunnel và tự động cập nhật link tunnel vào GitHub Gist. |
| `cloud-gpu-server/server.py` | Mã nguồn FastAPI GPU Server độc lập (`GET /health`, `GET /stats`, `POST /diarize`). |
| `ai-engine/app/services/cloud_gpu_client.py` | Client phía `ai-engine` / `ai-worker`: tự động lấy URL mới nhất từ GitHub Gist Registry, gửi file WAV lên Cloud GPU và chuyển đổi kết quả về `pyannote.core.Annotation`. |
| `ai-engine/app/services/diarization_runtime.py` | Điều phối runtime giữa Cloud GPU Server và Local fallback cho cả `diarize()` và `extract_speaker_embeddings()`. |
| `ai-engine/app/core/config.py` | Cấu hình biến môi trường kết nối Cloud GPU và GitHub Gist Registry. |
| `ai-engine/app/services/audio_ans.py` | Tối ưu tính toán RMS bằng NumPy và nhường GIL định kỳ để giữ nhịp tim (`WorkerHeartbeat`) ổn định với các video dài. |
| `ai-engine/app/services/audio_pipeline.py` | Tối ưu kiểm định chất lượng âm thanh (`QUALITY_CHECK`) bằng vector hóa NumPy trước khi đẩy sang Cloud GPU. |
| `monitor.ps1` / `monitor.py` / `monitor.bat` | Dashboard giám sát thời gian thực trên VSCode Terminal: hiển thị thanh đo System RAM, GPU VRAM (Tesla T4), Disk của Colab, trạng thái Docker local và tiến trình xử lý từng video (`PENDING` ➔ `PROCESSING` ➔ `DONE`). |

---

## 3. Cơ chế Tự động Đồng bộ Link Tunnel (GitHub Gist Registry)

Do Cloudflare Quick Tunnel (`*.trycloudflare.com`) sinh URL ngẫu nhiên mỗi lần khởi động lại phiên Google Colab, hệ thống sử dụng **GitHub Gist** làm hộp thư định danh cố định:

1. **Khi Google Colab khởi động**:
   Script `colab_gpu_server.py` mở cổng Cloudflare Tunnel, trích xuất link `https://xxxx.trycloudflare.com` và gọi `PATCH https://api.github.com/gists/{GIST_ID}` để ghi đè vào file `gpu_url.txt`.
2. **Khi AI Worker xử lý Job**:
   `CloudGpuClient` đọc nội dung `gpu_url.txt` từ Gist (có cơ chế cache TTL 20 giây và xác thực qua `CLOUD_GPU_REGISTRY_GITHUB_TOKEN` để tránh giới hạn rate-limit), nhờ đó luôn gọi đúng địa chỉ GPU Server mới nhất mà **không cần sửa file `.env` hay khởi động lại Docker**.

---

## 4. Đặc tả API trên Cloud GPU Server

### 4.1. `GET /health`
Kiểm tra trạng thái hoạt động và thiết bị phần cứng đang chạy mô hình.

**Response mẫu:**
```json
{
  "status": "ok",
  "device": "cuda",
  "name": "Tesla T4",
  "cuda_available": true
}
```

### 4.2. `GET /stats`
Trả về thông số tài nguyên phần cứng thời gian thực trên Google Colab để hiển thị lên `monitor.ps1`.

**Response mẫu:**
```json
{
  "status": "ok",
  "device": "cuda",
  "system_ram": { "used_gb": 3.9, "total_gb": 12.7, "percent": 31.0 },
  "gpu_ram": { "name": "Tesla T4", "used_gb": 1.4, "total_gb": 15.0, "percent": 9.3 },
  "disk": { "used_gb": 47.8, "total_gb": 118.9, "percent": 40.2 }
}
```

### 4.3. `POST /diarize`
Nhận file âm thanh/video (`multipart/form-data`), chuẩn hóa qua FFmpeg (16kHz, Mono, PCM 16-bit), chạy phân đoạn người nói trên GPU và trích xuất vector đặc trưng giọng nói (hỗ trợ cả `dict`, `numpy.ndarray` của Pyannote 4.0 và `_embedding` model).

**Response mẫu:**
```json
{
  "status": "SUCCESS",
  "process_time_seconds": 12.72,
  "device": "cuda",
  "turns": [
    { "speaker": "SPEAKER_00", "start": 12.485, "end": 27.284 }
  ],
  "embeddings": {
    "SPEAKER_00": [0.0124, -0.0431, "..."]
  }
}
```

---

## 5. Cấu hình Biến Môi trường (`.env`)

```env
CLOUD_GPU_URL=https://your-tunnel-url.trycloudflare.com
CLOUD_GPU_REGISTRY_GIST_ID=59acfce671db1746f4996d5ae358b027
CLOUD_GPU_REGISTRY_GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
JOB_HEARTBEAT_TIMEOUT_SECONDS=600
```

---

## 6. Hướng dẫn Vận hành & Giám sát

### Bước 1: Bật Cloud GPU trên Google Colab
1. Mở Google Colab, chọn **Runtime ➔ Change runtime type ➔ T4 GPU**.
2. Dán nội dung file `cloud-gpu-server/colab_gpu_server.py` vào ô code và bấm **Run**.
3. Chờ xuất hiện dòng `🔗 LINK SERVER GPU: https://...trycloudflare.com` và `Uvicorn running on http://0.0.0.0:8000`.

### Bước 2: Khởi chạy AI Engine & Worker ở Local
```powershell
docker compose up -d --build ai-engine ai-worker
```

### Bước 3: Bật Bảng Giám sát Thời gian thực trên VSCode Terminal
```powershell
.\monitor.ps1 -w
```

