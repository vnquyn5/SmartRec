# SmartRec Database Audit Report

## Phương pháp và phạm vi

Audit ngày 2026-11-20 (Asia/Bangkok). Kết nối `smartrec_db` trên PostgreSQL 18.6; truy vấn `pg_catalog` với `default_transaction_read_only=on`; export schema bằng `pg_dump --schema-only`. Không truy vấn dữ liệu hàng, không chạy migration, không sửa DB/source. Source kiểm tra tại `src/main/java/com/example/smartrec/entity` và `repository`, cùng truy vấn native liên quan.

| Chỉ số | Giá trị |
|---|---:|
| Schema ứng dụng | 1 (`public`) |
| Bảng | 24 |
| Cột | 216 |
| Index (gồm index hỗ trợ PK/UNIQUE) | 36 |
| Index độc lập khỏi PK/UNIQUE constraint | 6 |
| Constraint trong `pg_constraint` | 155 |
| PK / UNIQUE / CHECK / NOT NULL | 24 / 6 / 7 / 118 |
| FK | 0 |
| View / trigger / function / custom type / sequence | 0 / 0 / 0 / 0 / 0 |
| Entity / Repository | 23 / 23 |

## Entity đối chiếu với bảng

| Entity | Bảng DB | Cột Entity / DB | Repository |
|---|---|---:|---|
| `ActionItem` | `public.action_items` | 14 / 14 | Có |
| `AiUsage` | `public.ai_usage` | 21 / 22 | Có |
| `ContextPayload` | `public.context_payloads` | 3 / 3 | Có |
| `Folder` | `public.folders` | 7 / 7 | Có |
| `Job` | `public.processing_jobs` | 18 / 18 | Có |
| `JobDispatchOutbox` | `public.job_dispatch_outbox` | 7 / 7 | Có |
| `JobStage` | `public.job_stages` | 11 / 11 | Có |
| `MediaFile` | `public.media_file` | 18 / 18 | Có |
| `Meeting` | `public.meetings` | 11 / 11 | Có |
| `MeetingSlide` | `public.meeting_slides` | 8 / 8 | Có |
| `OCRResult` | `public.ocr_results` | 3 / 3 | Có |
| `PendingMediaUpload` | `public.pending_media_uploads` | 10 / 10 | Có |
| `PublicShareLink` | `public.public_share_links` | 10 / 10 | Có |
| `RefreshToken` | `public.refresh_tokens` | 6 / 6 | Có |
| `ShareLinkAudit` | `public.share_link_audits` | 6 / 6 | Có |
| `SlideKeyframe` | `public.slide_keyframes` | 7 / 7 | Có |
| `Speaker` | `public.speakers` | 4 / 4 | Có |
| `SpeakerSegment` | `public.speaker_segments` | 5 / 5 | Có |
| `Summary` | `public.meeting_summaries` | 6 / 6 | Có |
| `Transcript` | `public.transcripts` | 9 / 9 | Có |
| `UploadSession` | `public.upload_sessions` | 7 / 7 | Có |
| `User` | `public.users` | 16 / 16 | Có |
| `WorkspaceMember` | `public.workspace_members` | 5 / 5 | Có |

**Bảng không có Entity:** `public.ocrresult` (3 cột).

**Entity chưa có bảng:** Không có.

**Cột DB không được Entity mapping:** `public.ai_usage.processing_time` (ngoài toàn bộ 3 cột của `ocrresult` do bảng không có Entity). **Cột Entity không có trong bảng:** Không có.

**Quan hệ JPA:** Không có annotation `@OneToOne`, `@OneToMany`, `@ManyToOne`, `@ManyToMany`, `@JoinColumn`, `@JoinTable` trong Entity. Các trường liên hệ là UUID scalar. Vì DB không có FK, không có cardinality được DB cưỡng chế ngoại trừ tính duy nhất của một số cột.

## Sai lệch và vấn đề phát hiện

| Mức | Đối tượng | Bằng chứng từ DB và source | Ảnh hưởng |
|---|---|---|---|
| Cao | `ocr_results` / `OCRResult` | DB PK (`id`, `keyframe_id`); Entity chỉ `@Id id`; `OCRResultRepository` dùng `JpaRepository<OCRResult, UUID>`. Bảng `ocrresult` cũng có PK ghép. | Mapping định danh không khớp; thao tác theo ID có thể mơ hồ nếu `id` lặp với keyframe khác. |
| Cao | `upload_sessions.status` | Enum Java có `PAUSED`, `READY_TO_MERGE`, `MERGING`, `MERGE_FAILED`; DB CHECK chỉ cho `INITIATED`, `UPLOADING`, `COMPLETED`, `FAILED`, `CANCELLED`. | Ghi bốn trạng thái mới có thể bị DB từ chối. |
| Cao | `AiUsageRepository.insertIfNew` | Native SQL dùng `ON CONFLICT (request_id) WHERE request_id IS NOT NULL DO NOTHING`; DB không có unique constraint/index trên `ai_usage.request_id`. | PostgreSQL không tìm được arbiter cho conflict target; câu lệnh có thể lỗi khi thực thi. |
| Cao | `AiUsageRepository.insertIfNew` | Native SQL `INSERT INTO ai_usage` không cấp `id`; DB khai báo `id uuid NOT NULL` và không có default/identity. `@GeneratedValue(UUID)` chỉ áp dụng khi JPA tạo ID cho Entity. | Câu lệnh native không có giá trị PK để insert, kể cả khi thêm arbiter cho `ON CONFLICT`. |
| Trung bình | Quan hệ tham chiếu | 0 FK trên 24 bảng dù nhiều trường UUID liên hệ logic. | DB không chặn orphan record và không thực thi cascade/restrict. |
| Trung bình | `users.user_code` | Entity khai báo `nullable=false, unique=true`; DB cột nullable và không có UNIQUE. | Có thể lưu NULL/trùng mã ở mức DB. |
| Trung bình | `users.provider_id` | Entity khai báo `unique=true`, mặc định JPA `varchar(255)`; DB `varchar(100)` và không UNIQUE. | Có thể trùng ID provider và giá trị dài hơn 100 ký tự bị từ chối. |
| Trung bình | `processing_jobs.meeting_id` | `Job.meetingId` khai báo `nullable=false`; DB cho NULL. | DB cho phép job thiếu meeting. |
| Trung bình | `meetings.status` | Entity `nullable=false, length=30`; DB nullable `varchar(255)` và không có CHECK. | DB cho phép NULL/giá trị ngoài enum; giới hạn dài khác JPA. |
| Thấp | `users.avatar_url` | Entity `@Column(length=500)`; DB là `text`. | Giới hạn độ dài không đồng nhất. |
| Thấp | `ai_usage.processing_time` | Cột DB `bigint` còn tồn tại; Entity chỉ mapping `processing_time_ms`. | Cột không được JPA hiện tại đọc/ghi. |
| Cần xác minh | `ocrresult` | Bảng 3 cột có cấu trúc giống `ocr_results`, không có Entity/Repository hay tham chiếu source hiện tại. | Nguồn tạo và dữ liệu/sử dụng thực tế chưa xác minh. |
| Cần xác minh | `workspace_id` | Nhiều bảng chứa `workspace_id`, nhưng DB này không có bảng `workspaces`. | Quan hệ đích có thể ở hệ thống khác hoặc chưa được tạo; source/DB hiện tại không xác minh được. |
| Cần lưu ý | Phiên bản PostgreSQL | DB kết nối trực tiếp là PostgreSQL 18.6; `docker-compose.yml` khai báo `postgres:15-alpine`. | DDL và hành vi catalog có thể khác giữa môi trường hiện tại và môi trường Compose. |

`src/main/resources/application.yml` hiện đặt `spring.jpa.hibernate.ddl-auto: update`. Audit này không khởi chạy ứng dụng; nếu ứng dụng khởi chạy với cấu hình đó, Hibernate có thể tự cập nhật schema, nên trạng thái DB cần được kiểm tra lại trước khi làm migration.

## Enum và CHECK

| Entity.field | Kiểu DB | CHECK tại DB | Đối chiếu |
|---|---|---|---|
| `Job.status` | varchar(255) | `processing_jobs_status_check` | Khớp các giá trị `JobStatus`. |
| `Job.currentStage` | varchar(255) | `processing_jobs_current_stage_check` | Khớp `PipelineStage`. |
| `JobStage.stage` | varchar(255) | `job_stages_stage_check` | Khớp `PipelineStage`. |
| `JobStage.status` | varchar(255) | `job_stages_status_check` | Khớp `JobStageStatus`. |
| `PublicShareLink.status` | varchar(20) | `public_share_links_status_check` | Khớp `ShareLinkStatus`. |
| `ShareLinkAudit.action` | varchar(30) | `share_link_audits_action_check` | Khớp `ShareLinkAuditAction`. |
| `UploadSession.status` | varchar(50) | `upload_sessions_status_check` | Thiếu 4 giá trị enum đã nêu ở trên. |
| `Meeting.status` | varchar(255) | Không có | Không cưỡng chế enum; nullable/length lệch Entity. |

## Những phần chưa thể xác minh

- Không truy vấn dữ liệu hàng theo yêu cầu bảo mật, nên chưa xác định có orphan, giá trị enum đang lưu, ID trùng, hay dữ liệu trong `ocrresult`/`processing_time`.
- Chưa xác định lịch sử migration/nguyên nhân tạo `ocrresult` và các cột dư; tài liệu này ghi nhận trạng thái DB hiện tại.
- Các quan hệ/cardinality logic trong ERD chưa được FK bảo đảm; không thể chứng minh tính toàn vẹn tham chiếu chỉ bằng schema.
- DB export và các truy vấn catalog được thực hiện liên tiếp, không dùng cùng một snapshot liên giao dịch; không phát hiện lệch số bảng/constraint/index giữa dump và metadata tại thời điểm kiểm tra.

## File bàn giao

- [Database_Schema.sql](Database_Schema.sql): DDL schema-only từ DB thực tế.
- [Database_ERD.md](Database_ERD.md): ERD Mermaid, phân biệt liên hệ logic và FK thực tế.
- [Database_Documentation.md](Database_Documentation.md): bảng, cột, constraint, index và luồng dữ liệu.
- [Database_Data_Dictionary.csv](Database_Data_Dictionary.csv): 216 dòng cột dữ liệu, 15 trường từ điển.
- [Database_Audit_Report.md](Database_Audit_Report.md): kết quả đối chiếu DB/source.
