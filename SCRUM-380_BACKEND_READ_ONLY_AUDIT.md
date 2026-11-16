# SMARTREC — SCRUM-380 Backend Read-Only Implementation Audit

**Ngày audit:** 13-11-2026  
**Branch:** `Full-text-Search-Engine`  
**HEAD:** `5d8fa155d6c87955ad6b45a971fe3c454443bb24`  
**Verdict:** **PARTIALLY READY**

## A. Executive Summary

Backend hiện đã có API hủy Job, lưu trạng thái hủy, kiểm tra cancellation qua heartbeat, callback theo stage, retry và execution lease. Những cơ chế này đã được nối vào luồng Backend–AI Engine hiện tại.

SCRUM-380 chưa sẵn sàng cho E2E vì còn ba vấn đề chính:

1. Callback `FAILED` vẫn có thể chuyển Job khỏi `CANCEL_REQUESTED` sang `FAILED` hoặc `RETRYING`; cancellation có thể thua race với stage failure.
2. Backend chỉ lưu trạng thái cho `FFMPEG`, `WEBRTC`, `PYANNOTE`, `OUTPUT`; không có stage riêng cho `STT`, `OCR`, `CONTEXT`, `LLM`. OCR lỗi chưa có đường tiếp tục transcript-only.
3. Chưa có hợp đồng sở hữu và cleanup artifact đủ an toàn. Backend có hàm xóa MinIO nhưng không có cleanup gắn với hủy Job. AI Engine xóa workspace cục bộ của Job khi hủy, trong khi workspace có thể chứa checkpoint cần cho retry.

AI Engine có thể bắt đầu các thay đổi độc lập như chuẩn hóa cancellation checks tại safe point và quy tắc giữ/xóa workspace. E2E cần thống nhất stage/error contract, precedence giữa cancel và failure, quyền sở hữu artifact và cleanup acknowledgment.

Không đưa ra phần trăm readiness vì không có thang điểm được định nghĩa.

**Giới hạn đặc tả:** Không tìm thấy mô tả Jira, Acceptance Criteria hoặc tài liệu SCRUM-380 trong source được kiểm tra. Báo cáo dựa trên tiêu đề task, brief người dùng và contract đang có; không tự đặt Acceptance Criteria.

## B. Repository Audit Context

| Hạng mục | Kết quả |
|---|---|
| Branch | `Full-text-Search-Engine` |
| HEAD | `5d8fa155d6c87955ad6b45a971fe3c454443bb24` |
| Working tree trước khi tạo báo cáo | Sạch theo `git status --short --branch` |
| Backend root | `src/main/java/com/example/smartrec`; schema tại `src/main/resources/schema.sql` |
| AI Engine root | `ai-engine/` |
| HEAD được ưu tiên | Kết luận về triển khai dựa trên source tại HEAD hiện tại |
| Giới hạn kiểm tra | Không đổi branch; không chạy tests, builds, services hay live endpoints |

README mô tả cấu trúc SmartRec gồm Spring Boot, FastAPI/Celery, PostgreSQL, Redis và MinIO. Không tìm thấy `SCRUM-380` trong tài liệu/source được tìm kiếm. Chức năng được đánh giá từ code hiện tại, không suy ra là đã triển khai chỉ từ lịch sử Git.

## C. Existing Backend Capability Inventory

| Capability | Status | Evidence | Reuse? | Missing Work |
|---|---|---|---|---|
| Job lifecycle và trạng thái CANCEL | IMPLEMENTED AND CONNECTED | `JobStatus`, `JobStateMachine`, `JobServiceImpl.cancelForCurrentUser` | Có | Quy định cancel thắng stage failure |
| Cancel API | IMPLEMENTED AND CONNECTED | `POST /jobs/{jobId}/cancel`, `JobController.cancel` | Có | Xác nhận ownership/role theo yêu cầu sản phẩm |
| Backend → Worker cancellation signal | IMPLEMENTED AND CONNECTED | Heartbeat trả status/control; AI Worker poll tại `WorkerHeartbeat` | Có | Bảo vệ retry/failure trong lúc cancel |
| Callback theo stage | PARTIAL | `/jobs/{jobId}/callback`, `WorkerCallbackRequest` | Có | OCR warning/recoverable outcome và stage chi tiết |
| Chặn worker cũ ghi dữ liệu | IMPLEMENTED AND CONNECTED | `executionId`, lease, pessimistic lock, active-job check | Có | Callback ID/idempotency bền vững chưa có |
| Lưu stage state | PARTIAL | `job_stages`; enum có bốn stage | Có | Không tương ứng trực tiếp STT/OCR/Context/LLM |
| OCR warning/transcript-only | MISSING IN CURRENT HEAD | AI source nói fallback chưa bật | Có thể mở rộng flow | Warning contract và tiếp tục pipeline |
| Xóa MinIO object | IMPLEMENTED BUT NOT CONNECTED | `MinioService.delete` | Có | Chưa được gọi bởi Job cancellation |
| Dọn workspace cục bộ | PARTIAL | Worker `shutil.rmtree` khi `preserve_workspace=False` | Có | Tránh xóa checkpoint cần cho retry |
| Cleanup/reconciliation artifact | MISSING IN CURRENT HEAD | Không tìm thấy Job cleanup flow trong source đã kiểm tra | Chưa đủ bằng chứng an toàn | Ownership, idempotency, retry, đối chiếu DB/MinIO |

## D. Job Lifecycle Audit

### Trạng thái và chuyển đổi

`JobStatus` có `CANCEL_REQUESTED` và `CANCELLED`; `JobStageStatus` cũng có `CANCELLED`. `JobStateMachine` kiểm tra các chuyển đổi, bao gồm hủy từ trạng thái đang chạy và `PAUSED` ([JobStatus.java:3](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/enums/JobStatus.java:3), [JobStageStatus.java:3](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/enums/JobStageStatus.java:3), [JobStateMachine.java:24](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/JobStateMachine.java:24)).

`cancelForCurrentUser` khóa Job, kiểm tra quyền truy cập Meeting, trả về không làm gì khi trạng thái đã là `CANCEL_REQUESTED`/`CANCELLED`, và trả conflict khi trạng thái không hợp lệ ([JobServiceImpl.java:316](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobServiceImpl.java:316)). Nếu Job đang `PAUSED`, hoặc chưa có execution lease, Job chuyển thẳng sang `CANCELLED`; nếu worker còn lease thì Backend đặt `CANCEL_REQUESTED` để worker dừng ở safe point ([JobServiceImpl.java:326](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobServiceImpl.java:326)).

Hủy sau `COMPLETED`, `FAILED` hoặc `DLQ` bị từ chối conflict. Yêu cầu hủy lặp lại là idempotent ở service. Tuy nhiên `CANCELLED` không bất biến: manual retry cho phép `CANCELLED → RETRYING`; đây là trạng thái kết thúc execution hiện tại nhưng có thể được chạy lại.

### Parent Job và stage

Job lưu `currentStage`; từng stage được lưu thành hàng `JobStage`. Tạo Job khởi tạo hàng cho mỗi `PipelineStage` ([JobServiceImpl.java:64](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobServiceImpl.java:64)). Stage success gọi `moveToNextStage`; chỉ khi stage cuối `OUTPUT` thành công thì Parent Job thành `COMPLETED` ([JobServiceImpl.java:817](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobServiceImpl.java:817)).

Đây là phân tách Parent Job/stage đang hoạt động. Nhưng stage hiện tại là `FFMPEG`, `WEBRTC`, `PYANNOTE`, `OUTPUT`, không phải `AUDIO`, `STT`, `OCR`, `CONTEXT`, `LLM` ([PipelineStage.java:3](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/enums/PipelineStage.java:3)).

### Khóa đồng thời

`JobRepository.findByIdForUpdate` dùng `PESSIMISTIC_WRITE`; cancellation, heartbeat và callback truy xuất Job theo đường này ([JobRepository.java:48](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/repository/JobRepository.java:48)). Không thấy `@Version` trên `Job` hoặc `JobStage`; bảo vệ đồng thời dựa vào pessimistic lock trên Job. Source được kiểm tra không chứng minh mọi đường ghi ngoài các service này đều dùng cùng lock.

## E. Cancel API và Authorization

`JobController` có `POST /jobs/{jobId}/cancel`, không body; thành công trả `200` không body ([JobController.java:87](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/controller/JobController.java:87)). Service gọi `meetingService.getMeeting(job.getMeetingId())`, thực hiện kiểm tra quyền truy cập Meeting của người dùng hiện tại ([JobServiceImpl.java:318](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobServiceImpl.java:318)).

`SecurityConfig` yêu cầu authentication cho `/jobs/**`, trừ các route được permit riêng; route cancel không nằm trong ngoại lệ ([SecurityConfig.java:47](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/config/SecurityConfig.java:47)). Chưa xác nhận được role workspace cụ thể chỉ từ route; bằng chứng hiện có là kiểm tra quyền Meeting qua `MeetingService`.

API cập nhật DB và trả ngay, không đợi worker xác nhận. Nếu worker có lease, Job ở `CANCEL_REQUESTED` cho đến heartbeat/callback hoặc watchdog hoàn tất.

## F. Backend → AI Engine Cancellation Signal

Backend không gọi trực tiếp Celery/Redis trong luồng dispatch. `JobQueueServiceImpl` gọi `POST /internal/jobs/{jobId}/enqueue`; outbox dispatcher retry khi enqueue thất bại ([JobQueueServiceImpl.java:40](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobQueueServiceImpl.java:40), [JobDispatchOutboxDispatcher.java:34](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobDispatchOutboxDispatcher.java:34)). AI Engine gọi Celery `.delay(job_id)` ([routes.py:46](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/ai-engine/app/api/routes.py:46)).

Cancellation được **poll qua heartbeat**, không phát thành queue message riêng:

1. Backend lưu `CANCEL_REQUESTED` và `cancel_requested_at`.
2. Worker gọi `POST /jobs/{jobId}/heartbeat` với `X-Execution-Id` và internal token.
3. Worker đọc `status`/`executionAllowed` tại checkpoint và nhận biết `CANCEL_REQUESTED`.
4. Worker callback `CANCELLED`; Backend cập nhật Job/stage.

Trạng thái bền vững vì lưu ở PostgreSQL; worker restart có thể đọc qua Job API/heartbeat. Không thấy Redis cancellation key hoặc cancellation version riêng. `executionId` và lease fence execution cũ; worker chỉ được xử lý stop request khi còn lease. Watchdog hoàn tất nếu lease stale ([JobServiceImpl.java:367](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobServiceImpl.java:367), [JobServiceImpl.java:436](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobServiceImpl.java:436), [redis_job_worker.py:95](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/ai-engine/app/workers/redis_job_worker.py:95)).

## G. AI → Backend Callback

### Route và contract

Callback là `POST /jobs/{jobId}/callback`, yêu cầu `X-Execution-Id`, `X-Internal-Token`. Controller xác thực token, gán execution ID từ header rồi gọi service ([JobController.java:105](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/controller/JobController.java:105)). DTO gồm `stage`, `status`, `errorCode`, `errorMessage`, `segments`, `aiResult`; execution ID được controller gán ([WorkerCallbackRequest.java:18](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/model/dto/WorkerCallbackRequest.java:18)).

Backend chấp nhận `PROCESSING`, `SUCCESS`, `FAILED`, `PAUSED`, `CANCELLED`; kiểm tra stage, execution lease hiện hành và active Job của Meeting ([JobServiceImpl.java:552](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobServiceImpl.java:552)). Không có callback ID độc lập; idempotency dựa trên trạng thái Job/stage ([JobServiceImpl.java:764](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobServiceImpl.java:764)). AI callback client retry; lỗi callback bắt buộc sẽ ném lỗi retryable ([redis_job_worker.py:165](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/ai-engine/app/workers/redis_job_worker.py:165)).

### Guard và giới hạn

- Callback SUCCESS đến khi `CANCEL_REQUESTED` được kết thúc thành `CANCELLED`, không hoàn tất Parent Job ([JobServiceImpl.java:641](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobServiceImpl.java:641)).
- Callback cũ sau cancel thường bị loại do execution ID không còn khớp; Job terminal cũng bị từ chối.
- Callback FAILED trong `CANCEL_REQUESTED` **chưa được bảo vệ tương đương**. `handleStageFailure` chuyển Job sang FAILED rồi có thể RETRYING ([JobServiceImpl.java:841](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobServiceImpl.java:841)). Đây là race quan trọng cần sửa.
- Callback FAILED cũ sau COMPLETED bị terminal guard chặn; callback từ execution cũ bị fencing.
- Callback SUCCESS trùng stage đã thành công được bỏ qua; callback FAILED sau COMPLETED bị chặn trước cập nhật.

## H. Stage Failure và Parent Job Consistency

Backend lưu error code/message và retry count theo stage hiện có. Failure retryable chuyển stage/Job sang `RETRYING` đến giới hạn; một số lỗi được đánh dấu non-retryable và skip stage phía sau ([JobServiceImpl.java:841](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/JobServiceImpl.java:841)).

`STT`, `OCR`, `CONTEXT`, `LLM` không phải stage enum riêng. OCR nằm trong xử lý multimodal của AI Engine. OCR lỗi hiện được báo như lỗi xử lý stage; chưa có Backend warning record để Job tiếp tục transcript-only. AI source ghi rõ fallback chưa được bật cho đến khi có warning support ([multimodal_pipeline.py:124](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/ai-engine/app/services/multimodal_pipeline.py:124)).

Kết luận:

- Có stage status/error/retry cho bốn stage coarse hiện tại.
- Không thấy attempt history chi tiết hoặc JSONB warnings.
- OCR failure chưa được xử lý như warning để tiếp tục LLM.
- Partial progress được trả qua `successfulStages` để resume; artifact liên quan có rủi ro khi workspace bị xóa (xem phần I).

## I. Artifact Ownership và Cleanup

Backend lưu object key media gốc trong `MediaFile`; AI dùng key đó để đọc media. Backend có `MinioService.delete(objectKey)` nhưng không tìm thấy luồng gọi cleanup khi Job cancel/fail ([MinioServiceImpl.java:122](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/src/main/java/com/example/smartrec/service/impl/MinioServiceImpl.java:122)).

AI ghi OCR artifacts dưới `meetings/{meetingId}/jobs/{jobId}/ocr`; key theo Job/meeting, không theo attempt ID. Source xác nhận key không phụ thuộc run ID ([multimodal_pipeline.py:124](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/ai-engine/app/services/multimodal_pipeline.py:124), [multimodal_pipeline.py:251](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/ai-engine/app/services/multimodal_pipeline.py:251)). Vì vậy đây là artifact Job-scoped/shared qua retry, không thể mặc định là tạm.

Khi cancellation xảy ra tại safe point, worker đặt `preserve_workspace=False`, và `finally` xóa toàn bộ thư mục workspace của Job ([redis_job_worker.py:1022](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/ai-engine/app/workers/redis_job_worker.py:1022), [redis_job_worker.py:1062](/E:/HocTap/NCKH/BE_JAVA/Smartrec/SmartRec/ai-engine/app/workers/redis_job_worker.py:1062)). Workspace có thể chứa checkpoint của stage đã thành công. Backend cho phép retry Job `CANCELLED` và trả `successfulStages`; do đó retry có thể mất artifact mà Backend vẫn coi là đã hoàn tất.

**Cleanup safety: BLOCKED BY CONTRACT.** Không thấy Backend artifact registry liên kết object key với attempt, version hoặc tham chiếu người dùng; không thấy cleanup outbox/retry/reconciliation. Không đủ bằng chứng để xác định xóa artifact nào an toàn. Không nên mở rộng xóa MinIO theo prefix trước khi chốt ownership.

## J. Database và Concurrency Safety

| Kịch bản | Hành vi hiện tại và rủi ro |
|---|---|
| G1: Cancel khi worker hoàn tất stage | Job lock tuần tự hóa. Nếu cancel trước, SUCCESS chuyển Job thành CANCELLED; nếu success trước, cancel sau bị conflict. FAILED trong `CANCEL_REQUESTED` vẫn có thể thành FAILED/RETRYING. |
| G2: Cancel ngay trước SUCCESS callback | SUCCESS trong `CANCEL_REQUESTED` làm Parent Job thành CANCELLED. Stage hiện hành cũng đánh dấu CANCELLED dù worker vừa hoàn tất stage. |
| G3: SUCCESS sau CANCELLED | Callback cũ bị chặn bởi execution ID và/hoặc terminal guard; không ghi đè Parent Job. |
| G4: Hai cancel đồng thời | Pessimistic lock, transaction và idempotent return bảo vệ cùng Job. |
| G5: Retry FAILED stage sau cancellation | Không an toàn: FAILED callback từ execution còn lease được nhận trong `CANCEL_REQUESTED`; stage failure có thể retry và enqueue lại. |
| G6: Cleanup trong lúc artifact writer hoạt động | Không có Backend cleanup coordination. Checkpoint quanh upload không chứng minh MinIO object an toàn khỏi writer khác. Cần ownership theo attempt và coordination contract. |
| G7: Worker restart sau yêu cầu cancel | DB lưu cancellation; execution mới không claim khi stop request chờ; watchdog kết thúc sau lease expiry. Cần đảm bảo queue retry không xử lý tiếp trước khi đọc trạng thái. |
| G8: OCR callback sau Parent Job completion | Chưa xác minh được endpoint OCR có guard Job terminal/active execution tương đương callback Job. Cần chặn callback muộn trước khi persist. |

## K. Existing Test Coverage Matrix

Tests chỉ được đọc, không chạy. Vì vậy không khẳng định test nào PASS.

| Trường hợp | Phân loại | Test hiện có |
|---|---|---|
| Cancel lặp lại | COVERED (có assertion trong source) | `JobLifecycleTest.cancelRequestIsIdempotent` |
| Cancel queued Job chưa claim | COVERED | `JobLifecycleTest.cancelQueuedUnclaimedJobCompletesWithoutReenqueuingIt` |
| Watchdog hoàn tất cancel khi lease hết hạn | COVERED | `JobLifecycleTest.staleCancelRequestBecomesCancelledAfterExecutionLeaseExpires` |
| SUCCESS sau cancel không hoàn tất Job | COVERED | `JobLifecycleTest.successCallbackAfterCancelCannotCompleteOrSaveOutputSegments` |
| Callback execution cũ/stage sai | COVERED | `JobLifecycleTest.callbackFromOlderExecutionIsRejected`, `callbackForNonCurrentStageIsRejected` |
| Duplicate output callback | COVERED | `JobServiceImplSpeakerCallbackTest.duplicateAiCallbackDoesNotPersistTwice` |
| Failure retry/DLQ | COVERED | `JobServiceImplSpeakerCallbackTest.retryableFailureStillUsesRetryPath`, `exhaustedRetryableFailureMovesJobToDlq` |
| FAILED callback cạnh tranh với `CANCEL_REQUESTED` | NOT FOUND | Không thấy assertion cho failure trong trạng thái cancel |
| OCR warning/transcript-only fallback | NOT FOUND | Không thấy Backend test; AI source nói fallback chưa bật |
| MinIO cleanup khi cancel/delete failure/reconciliation | NOT FOUND | Không tìm thấy test Backend cho Job cleanup |
| HTTP authorization của cancel API | NOT FOUND | Có service tests; không thấy controller/security test cho route cancel |
| Race thật trên DB/đa request | NOT VERIFIABLE | Unit tests không chứng minh DB concurrency |

## L. BE–AI Contract Compatibility Matrix

| Contract | Backend | AI Engine | Compatible? | Missing Owner |
|---|---|---|---|---|
| Job identity | UUID `jobId`, `executionId`, `meetingId` | Celery nhận `jobId`, mỗi lần chạy tạo `executionId` | Có với contract hiện tại | Đặc tả execution ID như fencing token |
| Cancel request | DB `CANCEL_REQUESTED` qua heartbeat | Poll heartbeat/checkpoint, callback CANCELLED | Có một phần; failure race còn hở | Backend quyết định precedence; AI ngừng retry khi cancel |
| Cancel acknowledgment | Nhận callback `CANCELLED` theo stage | Gửi callback ở safe boundary | Một phần | Hành vi khi callback mất/watchdog đã đóng Job |
| Stage failure | `FAILED`, error code/message, retry theo bốn stage | Callback FAILED với stage worker | Có với stage coarse; thiếu OCR warning | Mapping stage và recoverable errors |
| Parent Job transitions | Backend sở hữu Parent Job; OUTPUT cuối mới complete | Worker gửi callback stage | Có theo kiến trúc hiện tại | Xác nhận stage taxonomy theo SCRUM-380 |
| Callback retry/idempotency | Lock, execution fencing, state-based idempotency | Callback retry và Celery retry | Một phần | Callback identity/replay và terminal response |
| Artifact ownership | Có `MediaFile`, transcript/meeting records; chưa thấy attempt registry | Key MinIO theo Job; workspace theo Job | Chưa đủ an toàn | Hai module chốt attempt/job/meeting/version ownership |
| Cleanup completion | MinIO delete primitive, không gắn Job cancel | Xóa local workspace, không có cleanup ack Backend | Không | Owner, ack, retry và reconciliation |

## M. Minimal Backend Implementation Plan

### 1. Backend changes bắt buộc

| Ưu tiên | Module/extension point | Mục tiêu | Phụ thuộc AI | Acceptance criteria và test cần có | Rủi ro nếu bỏ qua |
|---|---|---|---|---|---|
| 1 | `JobServiceImpl.handleWorkerCallback` / `handleStageFailure` | Không cho FAILED/RETRYING vượt `CANCEL_REQUESTED`; định nghĩa cancel precedence | Thống nhất callback semantics | PROCESSING/SUCCESS/FAILED đua với cancel vẫn giữ lifecycle đúng; test thứ tự race | Cancel bị mất, Celery retry Job đã hủy |
| 2 | Job callback/DB contract | Thêm warning/recoverable outcome và stage chi tiết nếu AC yêu cầu STT/OCR riêng | Cần AI mapping | OCR warning cho phép tiếp tục đúng policy; test callback trễ/duplicate | OCR lỗi làm Parent Job fail ngoài policy |
| 3 | Artifact ownership/persistence | Phân biệt attempt, Job, meeting, version và references | Phối hợp AI key strategy | Cancel không xóa media/shared artifact; delete idempotent; test MinIO lỗi và reconciliation | Mất artifact retry, transcript hoặc summary |
| 4 | OCR metadata callback | Kiểm tra Job active, stage và execution trước khi persist callback muộn | AI gửi đúng identity | OCR callback sau cancel/completion không đổi dữ liệu; test stale/duplicate callback | Late OCR sửa meeting sau terminal Job |

### 2. AI Engine changes bắt buộc

1. Không retry pipeline/task sau khi nhận cancellation hoặc terminal status.
2. Gửi `CANCELLED` với execution ID hiện hành; định nghĩa hành vi khi watchdog đã đóng Job.
3. Không xóa workspace có checkpoint cần cho retry; tách scratch attempt khỏi Job-shared artifacts.
4. Phát outcome OCR theo warning/recoverable contract được thống nhất; giữ transcript và quyết định có chạy tiếp LLM theo policy.
5. Chỉ cleanup MinIO artifacts sau khi có ownership và acknowledgment contract.

### 3. Shared contract decisions

- Stage mapping: `FFMPEG/WEBRTC/PYANNOTE/OUTPUT` hay `STT/OCR/CONTEXT/LLM`.
- Precedence giữa cancellation, stage failure và Celery retry.
- Callback `CANCELLED` xác nhận dừng stage, execution hay Parent Job.
- OCR failure là warning hay terminal; error code nào recoverable; có chạy LLM tiếp không.
- Ownership artifact theo attempt/Job/meeting/version; ai xóa và cách retry/ack.
- Hành vi khi callback mất nhưng watchdog đã hoàn tất Job.

### 4. Optional improvements

- Callback ID/idempotency key bền vững ngoài execution ID.
- Lưu lịch sử nhiều lần thử stage nếu cần truy vết/debug.
- Metric/alert cho cancel acknowledgment timeout và cleanup tồn đọng.

## N. Blocking Dependencies

- **AI-local:** Có thể làm safe point, terminal checks, tránh retry khi canceled, điều chỉnh giữ/xóa workspace và test nội bộ. Chưa triển khai xóa MinIO artifacts khi ownership chưa rõ.
- **BE–AI integration:** Bị chặn bởi failure-vs-cancel precedence, stage taxonomy và OCR warning contract.
- **Full SCRUM-380 acceptance:** Bị chặn bởi các quyết định trên cùng ownership/cleanup/reconciliation artifact.

## O. Final Verdict

**PARTIALLY READY — Backend có nền tảng hủy và lifecycle; cần mở rộng Backend và chốt contract trước E2E.**

1. **Backend đã hỗ trợ Job cancellation?** Có; API, service transition và trạng thái persisted đã có.
2. **Backend nhận/lưu cancellation được không?** Có; DB lưu `CANCEL_REQUESTED` và `cancel_requested_at`; Job không có lease có thể thành `CANCELLED` ngay.
3. **Backend báo cancellation cho AI Worker được không?** Có, qua polling heartbeat; không có queue cancellation message riêng.
4. **Backend xử lý callback sau cancel an toàn không?** SUCCESS sau cancel được guard, callback execution cũ bị fencing. FAILED trong `CANCEL_REQUESTED` vẫn có thể thành FAILED/RETRYING.
5. **Backend theo dõi stage failure không?** Có cho bốn stage coarse; chưa có STT/OCR/Context/LLM riêng hoặc OCR warning contract.
6. **Backend điều phối cleanup artifact an toàn không?** Chưa; có hàm MinIO delete nhưng không thấy ownership registry hay cancellation cleanup/reconciliation.
7. **Backend changes bắt buộc?** Guard failure/retry sau cancel; thống nhất stage/warning contract; guard OCR callback muộn; thiết kế ownership/cleanup trước khi xóa artifact.
8. **AI Engine làm ngay được gì?** Safe points/terminal checks, không retry khi canceled, quản lý checkpoint đúng vòng đời; callback mapping sau khi chốt contract.
9. **SCRUM-380 sẵn sàng AI-only implementation?** Có thể bắt đầu phần nội bộ độc lập; chưa thể coi là tích hợp hoàn chỉnh.
10. **SCRUM-380 sẵn sàng E2E?** Chưa; cần hoàn tất Backend changes và contract decisions nêu trên.

---

Audit ban đầu chỉ đọc source và test definitions; không chạy tests/builds/services. File Markdown này được tạo theo yêu cầu tiếp theo của người dùng.
