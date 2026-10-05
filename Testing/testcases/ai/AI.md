# AI Engine - Test Cases

File tong hop danh muc testcase AI Engine. Cac testcase duoc chia theo chuc nang:

| File | Pham vi |
|---|---|
| [AI-http-health.md](./AI-http-health.md) | Root endpoint va health check |
| [AI-media-processing.md](./AI-media-processing.md) | FFmpeg version va trich xuat audio |
| [AI-integrations.md](./AI-integrations.md) | Celery, Redis, MinIO, ChromaDB va settings |
| [AI-scope.md](./AI-scope.md) | Ghi nhan cac pipeline chua co inference de test |

## Quy uoc chung

- AI Engine hien co FastAPI root/health, FFmpeg wrapper, Celery ping task va cac ham tao client ha tang.
- Cac testcase la thu cong hoac can harness tuong ung; chuan bi dich vu ngoai theo precondition truoc khi chay.
- Pipeline `audio`, `nlp`, `vision` chua co logic xu ly noi dung. Khong dat expected inference output hay danh dau inference PASS truoc khi tinh nang duoc implement.
