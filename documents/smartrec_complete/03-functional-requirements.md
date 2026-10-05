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
| FR-UPLOAD-006 | User xem status và pause/resume/cancel chunk session. | Should | Backend API and active UploadPage controls are wired in source; runtime acceptance required |
| FR-UPLOAD-007 | UI upload chunk phải dùng API thật, thể hiện status phản hồi backend. | Must | Active UploadPage được nối với chunk service trong source; runtime acceptance required |

Upload page hiện chọn single/presigned path cho file ≤2 GiB và chunk API path cho file lớn hơn; UI cho tối đa 5 GiB, tối đa 5 file single và 3 file chunk queue/active theo code. Backend chunk size hiện là 5 MiB; direct multipart backend limit hiện cấu hình 2 GiB. UI presigned single upload không đồng nhất với multipart endpoint. Đây là implementation facts, không phải capacity/SLA guarantees. Extension validation cũng khác nhau giữa đường direct và chunk.

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

## 8. Target MVP requirements from Proposal and URD (not current implementation)

Các ID dưới đây giữ phạm vi nghiệp vụ FR-01…FR-09 trong URD. Chúng là baseline mục tiêu để PO duyệt; trạng thái không được suy ra từ việc có màn hình hoặc package rời rạc trong source.

| URD ID | Requirement summary | Current evidence/status |
|---|---|---|
| FR-01 | Nạp media .mp4/.mkv/.mp3, validate duration/size, lưu gốc và khởi tạo job bất đồng bộ; chia audio >2h thành đoạn 30–45 phút | Upload/storage có; không thấy duration >4h enforcement, Celery media enqueue hay audio chunk pipeline. URD yêu cầu tối đa 5GB nhưng backend/UI limits không đồng nhất |
| FR-02 | Khử nhiễu/echo; đầu ra 16kHz mono MP3; nguồn nêu giảm khoảng 97% dung lượng và mục tiêu giảm nhiễu >80% | Chưa thấy pipeline chạy; tiêu chí cần dataset/measurement |
| FR-03 | Vietnamese STT/code-switching và transcript có timestamp; target WER <15% | Chưa thấy ASR task/model/API kết quả |
| FR-04 | Diarization theo speaker; target DER <15% | Speaker UI có demo state; chưa có pipeline hoặc persistence xác nhận |
| FR-05 | Trích keyframe và OCR tiếng Việt/Anh/KPI/bảng | Chưa thấy xử lý OCR end-to-end |
| FR-06 | Transcript + OCR → Executive Summary và Task Matrix (Task/Assignee/Deadline), JSON hợp lệ; nguồn nêu Gemini 1.5 Flash | Chưa thấy provider/job/result integration |
| FR-07 | Player seek đồng bộ timestamp; source nêu latency <0.5s | Meeting detail có demo; chưa thấy transcript/timestamp data integration hoặc đo |
| FR-08 | Human review có thể thêm/sửa/xóa summary/task và lưu PostgreSQL | Chưa thấy CRUD/persistence API cho AI result |
| FR-09 | Xuất DOCX/PDF/JSON/CSV; DOCX template giữ layout và JSON/CSV tương thích Trello/Jira | Chưa thấy API/export generator; không có direct sync trong scope nguồn |

### User-requirement and business-rule crosswalk

| URD ID | User/business need | Target FR | Current disposition |
|---|---|---|---|
| UR-001 | Register/login to access SmartRec | FR-01 / Auth | Auth backend exists |
| UR-002 | Upload supported meeting media | FR-01 | Upload exists; align supported formats |
| UR-003 | Explain invalid format/size/duration | FR-01 | Some upload validation exists; duration gate not verified |
| UR-004 | Handle large/long files asynchronously | FR-01 | Chunk upload/merge exists; AI processing async is target |
| UR-005 | See processing status/progress | FR-01/AI orchestration | Upload progress exists; AI job progress not verified |
| UR-006 | Vietnamese transcript with English terms | FR-03 | Target, not implemented |
| UR-007 | Timestamp on each transcript segment | FR-03/07 | Target, not implemented |
| UR-008 | Speaker label on each transcript segment | FR-04 | Target; speaker UI demo only |
| UR-009 | Extract slide text/numbers/diagrams | FR-05 | Target, not implemented |
| UR-010 | Receive executive summary | FR-06 | Target, not implemented |
| UR-011 | Receive task/assignee/deadline matrix | FR-06 | Target, not implemented |
| UR-012 | Click content and seek media to timestamp | FR-07 | Target; no verified timestamp data binding |
| UR-013 | Review/add/edit/delete summary and task before export | FR-08 | Target, not implemented end-to-end |
| UR-014 | Persist user-approved changes | FR-08 | Target, no verified result persistence |
| UR-015 | Export approved data to enterprise Word template | FR-09 | Target, no verified exporter |
| UR-016 | Export PDF/JSON/CSV; JSON/CSV usable for Trello/Jira import | FR-09 | Target, no verified exporter/import fixture |
| UR-017 | Show processing success/failure | FR-01/AI orchestration | Upload/merge status exists; AI job result status not verified |
| UR-018 | Persist meeting data and processing results | FR-01/AI orchestration | Media metadata exists; AI result entities not verified |

| Rule ID | URD business rule (target) |
|---|---|
| BR-001 | Input media formats are .mp4, .mkv and .mp3 |
| BR-002 | Maximum duration is 4 hours; reject longer media with `ERR_FILE_TOO_LARGE` |
| BR-003 | Audio longer than 2 hours is split into approximately 30–45 minute segments for parallel processing |
| BR-004 | Heavy AI work runs asynchronously through a queue/worker, not inside a long HTTP request |
| BR-005 | Store original media in MinIO and create a `PENDING` record in PostgreSQL after ingest |
| BR-006 | On processing completion, callback updates status to `COMPLETED` in PostgreSQL |
| BR-007 | Audio for ASR is 16 kHz mono |
| BR-008 | Noise reduction target exceeds 80% for ordinary office background noise |
| BR-009 | Vietnamese/code-switching WER target is below 15% on the test set |
| BR-010 | Transcript timestamp accuracy is to the second |
| BR-011 | Diarization DER target is below 15% on multi-speaker meetings |
| BR-012 | OCR recognizes Vietnamese/English and captures important slide KPIs |
| BR-013 | LLM produces an executive summary (source says about 3–5 minutes) and Task/Assignee/Deadline matrix |
| BR-014 | Summary/task payload is syntactically valid JSON |
| BR-015 | Target is to extract 100% of mentioned tasks with an assignee and deadline |
| BR-016 | Clicking transcript/summary/task seeks to related timestamp in under 0.5 seconds |
| BR-017 | Users can edit summary/task fields and persist edits in PostgreSQL |
| BR-018 | Word export preserves the enterprise template layout |
| BR-019 | JSON/CSV export can be imported to Trello/Jira |
| BR-020 | Direct sync API to Trello/Jira/Google Calendar is outside MVP |
| BR-021 | Human-in-the-loop review is required before AI output is treated as official export data |
| BR-022 | Target processing time is under 5–7 minutes for a 1-hour video |
| BR-023 | All FR-01…FR-09 are required for the URD's target quality baseline |

These rules are target requirements, not current behavior. Rules containing a percentage or latency require the test definition described in [NFR](./04-non-functional-requirements.md).

### Target acceptance and exclusions

- Target acceptance trong URD: upload file tới 5GB nhưng đồng thời file >4h bị từ chối; audio 16kHz mono; noise suppression >80%; WER <15%; DER <15%; timestamp đến giây; seek <0.5s; video 1h xử lý <5–7 phút; task extraction 100%; Word giữ layout; JSON/CSV import được. Các metric cần dataset, cách đo, điều kiện benchmark và approval trước khi thành cam kết.
- In-scope mục tiêu MVP: FR-01…FR-09. Out-of-scope được nguồn nêu: real-time meeting bot, RAG chatbot, direct Trello/Jira/Google Calendar synchronization và education module. Export file compatibility không phải direct sync.
- Proposal/URD stack mục tiêu nêu Celery, Redis, WebSocket, webhook, FFmpeg/WebRTC, faster-whisper, pyannote, PaddleOCR, Gemini 1.5 Flash và Apache POI. Chỉ ghi là planned dependency; kiểm chứng kỹ thuật/billing/licensing/version compatibility trước khi chốt.

Các điểm khác nguồn và hành động được ghi trong [Source Reconciliation](./appendices/source-reconciliation.md). Chỉ nâng một target requirement thành release acceptance sau khi có owner, quyết định, endpoint/data contract, test case và evidence.
