# SmartRec - Non-Functional Requirements

**Trạng thái:** Baseline các nhóm NFR; mọi ngưỡng định lượng còn TBD trừ khi được ghi là implementation detail.

## 1. Quy tắc ghi NFR

Mỗi NFR phải có ID, owner, metric/unit, điều kiện đo, target/limit được duyệt, cách kiểm chứng và trạng thái. Không dùng “nhanh”, “ổn định” hoặc “an toàn” làm acceptance criterion nếu không có phép đo.

| Trạng thái | Ý nghĩa |
|---|---|
| TBD | Chưa có giá trị được khách hàng/PO phê duyệt |
| Proposed | Đang đề xuất, chưa phải cam kết |
| Approved | Đã được phê duyệt, cần lưu decision/version |
| Verified | Đã đo/test và có evidence trong môi trường xác định |

## 2. NFR register

| ID | Nhóm | Tiêu chí cần chốt | Trạng thái/verification |
|---|---|---|---|
| NFR-PERF-001 | API performance | p95/p99 latency theo endpoint, concurrency, data size | TBD; load test required |
| NFR-UPLOAD-001 | Upload | max file, concurrent uploads, throughput, chunk retry behavior | TBD; code có 2 GiB config cho simple upload và 5 MiB chunk size nhưng chưa phải SLA |
| NFR-AVAIL-001 | Availability | availability %, measurement window, planned maintenance | TBD |
| NFR-REL-001 | Reliability | retry, idempotency, session recovery, acceptable error rate | TBD; test các failure boundary |
| NFR-SEC-001 | Security | authentication/authorization policy, secret handling, security test scope | TBD/assessment required |
| NFR-PRIV-001 | Privacy | dữ liệu thu thập, retention, deletion evidence, access policy | TBD |
| NFR-REC-001 | Recovery | RPO, RTO, backup frequency, restore drill | TBD; volume persistence không tự đồng nghĩa backup |
| NFR-SCALE-001 | Scalability | user/file growth, horizontal scaling, storage growth | TBD |
| NFR-COMP-001 | Compatibility | browser/OS/device support matrix | TBD |
| NFR-OBS-001 | Observability | log fields, metrics, alert thresholds, retention | TBD |
| NFR-MAINT-001 | Maintainability | build/test gates, supported runtime versions, dependency policy | TBD |
| NFR-AI-001 | AI quality/time | WER/DER/model latency only if AI processing becomes approved scope | Not applicable to current verified user flow |

## 3. Implementation facts - not service guarantees

- Backend Spring multipart max-file-size/max-request-size are configured as 2GB in `application.yml`; deployment proxy/container limits may differ.
- Chunk merge uses asynchronous task execution.
- Trash default retention is 30 days and cron default is daily 02:00.
- JWT default expiry is 86,400,000 ms (24 hours).

Các giá trị trên có thể override và không thay thế load test, capacity planning hay SLA.

## 3A. Candidate targets from the manual Proposal/URD (not approved or verified)

| ID | Candidate target in source documents | Status and evidence required |
|---|---|---|
| NFR-PERF-AI-01 | Process a 1-hour video in under 5–7 minutes end-to-end | Proposed only; define hardware, upload included/excluded time, concurrency, model versions and percentile |
| NFR-UI-01 | Seek to a referenced timestamp in under 0.5 seconds | Proposed only; player/media format/network/cache and measurement method TBD |
| NFR-AI-ASR-01 | Vietnamese/code-switching WER <15% | Proposed only; approve representative annotated corpus and normalization policy |
| NFR-AI-DIA-01 | DER <15% on multi-speaker meetings | Proposed only; approve corpus, overlap policy and scoring tool |
| NFR-AI-NR-01 | Remove >80% common office background noise | Proposed only; source does not specify acoustic metric/dataset, so not testable until defined |
| NFR-ASYNC-01 | Long AI processing runs asynchronously | Target architecture; current AI job dispatch not verified |
| NFR-PERSIST-01 | Persist meeting/job/results in PostgreSQL and media/artifacts in MinIO | Current code persists upload metadata/media; AI job/result schema not verified |
| NFR-SCALE-01 | Scale by adding AI workers | Target architecture only; queue/worker production behavior and GPU capacity not verified |

The URD's 100% task extraction and "no OOM" acceptance statements are also targets, but need a bounded test corpus, task definition, hardware profile and load envelope. Do not state them as guarantees.

## 4. Câu hỏi cần PO/khách hàng quyết định

1. Mức tải: concurrent users, active uploads, file sizes and daily volume?
2. API latency targets và thời gian chờ tối đa cho upload/merge?
3. Availability/SLA, bảo trì, giờ hỗ trợ?
4. RPO/RTO và retention/backup requirements?
5. Browser/client support matrix?
6. Security/privacy jurisdiction, audit, encryption, retention?
7. Có AI scope không; nếu có, metrics và acceptance dataset nào?
8. File size, file duration và supported formats chuẩn nào được ưu tiên khi URD, UI và backend hiện khác nhau?
9. WebSocket/progress, Celery queue, AI callback, review/persistence và export có nằm trong release/customer acceptance nào?

## 5. Verification plan

- API performance: load test ở môi trường cô lập với profile dữ liệu đã duyệt.
- Upload: test boundary size, interrupted network, retry, missing/corrupt chunks và MinIO outage.
- Recovery: backup/restore drill thực tế, đo RPO/RTO.
- Security: review config/authorization và test access-control; lưu báo cáo có kiểm soát.
- Compatibility: chạy smoke/regression theo browser matrix được duyệt.

Không ghi `Verified` cho tới khi có test report gắn với build, môi trường, thời điểm và kết quả.
