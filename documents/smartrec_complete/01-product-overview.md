# SmartRec - Product Overview

**Trạng thái:** Draft hợp nhất; tách hiện trạng source với phạm vi mục tiêu từ Proposal/URD

## 1. Tóm tắt

SmartRec là sản phẩm mục tiêu hỗ trợ xử lý biên bản cuộc họp từ media bằng AI, cho phép người dùng rà soát kết quả và xuất báo cáo. Source repository hiện có frontend React/Vite, backend Spring Boot và service AI FastAPI. Backend hiện thể hiện xác thực, upload, quản lý media/meeting, tải file, đổi tên và Trash. PostgreSQL lưu metadata, Redis hỗ trợ upload session, MinIO lưu object.

AI Engine hiện có health/root endpoint và Celery ping task; chưa thấy worker xử lý media hoặc luồng tích hợp từ upload → AI job → kết quả → UI. Vì vậy transcript, summary, OCR, diarization và semantic search là yêu cầu mục tiêu, không phải capability hiện hành.

## 2. Đối tượng sử dụng

- End user: đăng nhập, upload media, quản lý/tải file và dùng Trash.
- Developer/Integrator: phát triển frontend/backend, tích hợp API và dịch vụ lưu trữ.
- Operator: triển khai, giám sát và khôi phục dịch vụ theo quy trình được phê duyệt.

Role model/RBAC cho admin/operator chưa được xác nhận trong source reviewed.

## 3. Phạm vi capability

| Capability | Backend source | Frontend status | Ghi chú |
|---|---|---|---|
| Register/login/JWT | Implemented | Auth pages call backend in source; runtime release test still needed | Does not imply OAuth/OTP |
| Password recovery | No verified backend API | Forgot-password page exists; backend flow unverified | UI/design only until API is demonstrated |
| Profile | Get/update/change-password APIs | Profile page exists; verify each action at acceptance | Backend API present |
| Direct media upload | Multipart and presign/complete APIs | UploadPage uses presigned flow through upload service | MIME/size limits require per-path/deployment confirmation |
| Chunk upload | Init/chunk/merge/status/pause/resume/cancel APIs | Active UploadPage uses `useLargeUploadStore` and real chunk service in source | Runtime, recovery and merge acceptance still required; a legacy hook is separate/mock |
| Library/meeting | List/filter/download/ZIP/rename/soft-delete | Meeting/library pages exist | Detail screen contains demo state/data, not AI results |
| Trash | List/move/restore/permanent-delete; scheduled purge | Trash page exists | Code default retention is 30 days; configurable |
| AI processing | Health/root + Celery ping | No verified end-to-end flow | Target requirement; not implemented |

## 4. In scope của snapshot

- Đăng ký và đăng nhập; JWT stateless.
- Hồ sơ người dùng qua API.
- UI/chunk validation currently permits mp3, mp4, m4a, mkv; validation differs by upload path.
- Quản lý meeting/media metadata, tìm kiếm/phân trang, tải đơn/lô, rename.
- Soft delete, restore, permanent delete và scheduled purge đã có service code.
- Hạ tầng local dự kiến qua Docker Compose: PostgreSQL, Redis, MinIO, ChromaDB, AI Engine.

## 5. Ngoài phạm vi hoặc cần xác nhận

- AI results, transcript, meeting summary, OCR, diarization, timestamp review, AI result editing, persisted approval and report export.
- OAuth, OTP/password reset and role/permission management unless server/API workflows are verified.
- SLA/availability, production capacity, upload concurrency/throughput.
- RBAC/admin console, SSO, audit policy.
- Production topology, backup/DR guarantees.
- Browser/OS support matrix.

## 6. Kiến trúc ở mức cao

```text
React/Vite
    | REST + Bearer JWT
    v
Spring Boot API ---- PostgreSQL (users, upload sessions, media/meeting metadata)
    |       |
    |       +---- Redis (upload session state/progress)
    +------------ MinIO (media objects and temporary chunks)

FastAPI AI Engine ---- Redis/MinIO/Chroma configured infrastructure
   Current media worker / result API: not implemented or not verified

Target (Proposal/URD, not as-built):
Backend -> Redis/Celery -> AI workers -> audio + vision + LLM
        -> persisted result -> progress push/callback -> review -> export
```

## 7. Ràng buộc và giả định

- Source đang cấu hình context path `/api/v1`, port backend 8082; môi trường triển khai có thể override.
- Metadata table do JPA entity mô tả; schema thực tế phụ thuộc DB/migration/config.
- Không có bằng chứng trong snapshot này để cam kết production security, performance hoặc disaster recovery.
- Tên gọi “meeting” hiện gắn với media record; không đồng nghĩa có chức năng họp trực tuyến.

## 8. Tài liệu liên quan

Xem [Functional Requirements](./03-functional-requirements.md), [NFR](./04-non-functional-requirements.md), [Architecture](./06-system-architecture.md), [API Reference](./09-api-reference.md), và [Source Reconciliation](./appendices/source-reconciliation.md).
