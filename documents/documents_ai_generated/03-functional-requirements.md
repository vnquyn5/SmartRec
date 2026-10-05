# SmartRec - Functional Requirements

**Trạng thái:** Draft as-built baseline; Product Owner xác nhận scope trước acceptance.

## 1. Quy ước

Priority: `Must` = cốt lõi; `Should` = quan trọng; `TBD` = cần chốt.
Status: `Backend implemented`, `UI integration unverified`, `Mock`, `Planned`.
Mỗi requirement cần có acceptance test liên kết ở [Test Cases/UAT](./13-test-cases-and-uat.md).

## 2. Authentication and user

| ID | Requirement | Priority | Source status |
|---|---|---|---|
| FR-AUTH-001 | Hệ thống cho phép đăng ký user mới với email, phone, password, full name hợp lệ. | Must | Backend implemented |
| FR-AUTH-002 | Hệ thống từ chối email/phone đã được đăng ký. | Must | Backend implemented |
| FR-AUTH-003 | Hệ thống kiểm tra credential và trạng thái active khi login; thành công trả JWT. | Must | Backend implemented |
| FR-AUTH-004 | Protected API yêu cầu Bearer JWT hợp lệ; request thiếu/sai token không được authenticate. | Must | Backend implemented; runtime test required |
| FR-USER-001 | User xem và cập nhật profile của chính mình. | Should | API implemented; UI integration unverified |
| FR-USER-002 | User đổi password qua API có xác thực. | Should | API implemented; UI integration unverified |

Validation hiện thấy: password 8–16 ký tự, ít nhất một chữ hoa và ký tự đặc biệt; full name 3–30 chữ/khoảng trắng; register/login email pattern chỉ `.com`, phone theo pattern trong DTO. Validation hiện hành có thể được điều chỉnh theo quyết định sản phẩm.

## 3. Upload

| ID | Requirement | Priority | Source status |
|---|---|---|---|
| FR-UPLOAD-001 | User authenticated upload media multipart tới backend; backend lưu object và tạo media/meeting metadata. | Must | Backend implemented |
| FR-UPLOAD-002 | User có thể xin presigned PUT URL, upload object trực tiếp lên MinIO, rồi xác nhận complete. | Should | Backend API implemented |
| FR-UPLOAD-003 | Hệ thống tạo chunk upload session, kiểm tra extension, size/chunk count và lưu trạng thái. | Must | Backend implemented |
| FR-UPLOAD-004 | Mỗi chunk được kiểm checksum MD5 trước khi chấp nhận; trạng thái tiến độ được cập nhật. | Must | Backend implemented |
| FR-UPLOAD-005 | Khi đủ chunks, backend merge bất đồng bộ, xác minh object cuối và tạo/reuse media/meeting records. | Must | Backend implemented |
| FR-UPLOAD-006 | User xem status và pause/resume/cancel chunk session. | Should | Backend API implemented; UI integration unverified |
| FR-UPLOAD-007 | UI upload chunk phải dùng API thật, thể hiện status phản hồi backend. | Must | Hook được rà soát đang mock; chưa đạt đến khi tích hợp |

Chunk upload hiện allow extension `mp3`, `mp4`, `m4a`, `mkv`; chunk size trong backend là 5 MiB. Simple multipart có max size 2 GiB trong service/config. Các con số là implementation facts, không phải capacity/SLA guarantee.

## 4. Library / Meeting

| ID | Requirement | Priority | Source status |
|---|---|---|---|
| FR-LIB-001 | User truy vấn meeting list theo pagination, status, keyword và sort được hỗ trợ. | Must | Backend implemented |
| FR-LIB-002 | User tải một meeting file thuộc quyền truy cập của mình. | Must | Backend implemented |
| FR-LIB-003 | User tải nhiều file thành ZIP. | Should | Backend implemented |
| FR-LIB-004 | User đổi tên file theo validation extension/name. | Should | Backend implemented |
| FR-LIB-005 | User xóa meeting theo soft-delete vào Trash. | Must | Backend implemented |

Page mặc định 0, size 20, max size 100. Meeting status hiện gồm `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`. Không hiểu các status này là AI outputs nếu chưa có processor integration.

## 5. Trash lifecycle

| ID | Requirement | Priority | Source status |
|---|---|---|---|
| FR-TRASH-001 | User liệt kê Trash theo page/size/keyword/sort. | Must | Backend implemented |
| FR-TRASH-002 | User restore media đang TRASHED về trạng thái trước đó (fallback UPLOADED). | Should | Backend implemented |
| FR-TRASH-003 | User permanent-delete chỉ media đang TRASHED; MinIO delete thành công trước khi xóa metadata. | Must | Backend implemented |
| FR-TRASH-004 | Scheduler purge file hết retention theo cron. | Should | Backend implemented; vận hành/config phải xác minh |

Default retention trong service là 30 ngày; purge cron mặc định 02:00 hàng ngày theo timezone/runtime config.

## 6. AI, search và scope loại trừ

| ID | Requirement | Priority | Source status |
|---|---|---|---|
| FR-AI-001 | Health endpoint trả trạng thái service và FFmpeg version. | Should | Implemented |
| FR-AI-002 | Process audio/video, transcription, OCR, NLP, embeddings, semantic search và hiển thị kết quả cho user. | TBD | Planned/not verified end-to-end |

Không đưa FR-AI-002 vào acceptance baseline cho đến khi chốt model/output, job API/queue, error/retry, persistence và UI.

## 7. Business rules / open questions

- Workspace hiện được set bằng user ID trong upload service; quy tắc chia sẻ workspace/multi-tenant cần xác nhận.
- Có hai route soft delete gần nhau: `DELETE /meetings/{id}` dùng meeting ID, `DELETE /media/{id}` dùng media ID. UI cần chọn đúng endpoint.
- Tên file, MIME validation, max file size và duplicate behavior cần thống nhất giữa direct và chunk upload.
- User-visible status khi merge async, cancel cleanup và retry behavior cần acceptance criteria cụ thể.
