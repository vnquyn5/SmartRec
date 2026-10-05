# SmartRec - Product Overview

**Trạng thái:** Draft / As-built snapshot, 2026-10-03

## 1. Tóm tắt

SmartRec là ứng dụng web có frontend React/Vite, backend Spring Boot và một service AI riêng viết bằng FastAPI. Các chức năng backend thể hiện rõ nhất trong source hiện tại là xác thực người dùng, upload media, quản lý meeting/media, download, đổi tên và quản lý thùng rác. PostgreSQL lưu dữ liệu nghiệp vụ, Redis hỗ trợ trạng thái phiên upload, MinIO lưu object media.

AI Engine hiện cung cấp root/health endpoint và có các module/pipeline/client nền. Chưa xác nhận được một luồng user-facing hoàn chỉnh từ upload -> AI job -> kết quả -> UI; vì vậy không coi transcription, summary, OCR, diarization hay semantic search là capability đã sẵn sàng.

## 2. Đối tượng sử dụng

- End user: đăng nhập, upload media, quản lý/tải file và dùng Trash.
- Developer/Integrator: phát triển frontend/backend, tích hợp API và dịch vụ lưu trữ.
- Operator: triển khai, giám sát và khôi phục dịch vụ theo quy trình được phê duyệt.

Role model/RBAC cho admin/operator chưa được xác nhận trong source reviewed.

## 3. Phạm vi capability

| Capability | Backend source | Frontend status | Ghi chú |
|---|---|---|---|
| Register/login/JWT | Implemented | Có màn auth; cần kiểm tra từng màn/API integration khi phát hành | Public auth routes; còn lại yêu cầu authentication |
| Profile | API get/update/change password | Trang profile tồn tại; cần xác nhận endpoints thực tế | Chi tiết API trong tài liệu 09 |
| Direct media upload | Multipart và presign/complete APIs | Integration theo màn hình cần xác minh | Hỗ trợ media metadata và MinIO |
| Chunk upload | Init/chunk/merge/status/pause/resume/cancel | Một hook chunk upload được rà soát đang mock | Không tuyên bố upload chunk đã dùng được trên UI |
| Library/meeting | List/filter/download/ZIP/rename/soft-delete | Các trang meeting tồn tại | Xác minh giao diện với backend |
| Trash | List/move/restore/permanent-delete; scheduled purge | Trang Trash tồn tại | Default retention trong code là 30 ngày, cấu hình được |
| AI processing | Health/root + nền tảng module | Chưa xác minh end-to-end | Planned/not integrated cho user workflows |

## 4. In scope của snapshot

- Đăng ký và đăng nhập; JWT stateless.
- Hồ sơ người dùng qua API.
- Media extensions của chunk upload: mp3, mp4, m4a, mkv.
- Quản lý meeting/media metadata, tìm kiếm/phân trang, tải đơn/lô, rename.
- Soft delete, restore, permanent delete và scheduled purge đã có service code.
- Hạ tầng local dự kiến qua Docker Compose: PostgreSQL, Redis, MinIO, ChromaDB, AI Engine.

## 5. Ngoài phạm vi hoặc cần xác nhận

- Kết quả AI cho user, transcript, meeting summary, OCR, speaker diarization, semantic search.
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

FastAPI AI Engine ---- configured Redis/MinIO/Chroma clients
   Current user-facing AI processing flow: TBD / not verified
```

## 7. Ràng buộc và giả định

- Source đang cấu hình context path `/api/v1`, port backend 8082; môi trường triển khai có thể override.
- Metadata table do JPA entity mô tả; schema thực tế phụ thuộc DB/migration/config.
- Không có bằng chứng trong snapshot này để cam kết production security, performance hoặc disaster recovery.
- Tên gọi “meeting” hiện gắn với media record; không đồng nghĩa có chức năng họp trực tuyến.

## 8. Tài liệu liên quan

Xem [Functional Requirements](./03-functional-requirements.md), [NFR](./04-non-functional-requirements.md), [Architecture](./06-system-architecture.md), [API Reference](./09-api-reference.md).
