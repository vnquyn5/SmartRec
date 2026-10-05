# SmartRec - Source Reconciliation and Decisions

**Status:** Draft analysis; no product-owner/customer decisions are implied by this document.

## 1. Purpose and source set

This appendix compares the repository-derived documentation with the manually prepared product documents and records how conflicts are handled in this consolidated set.

| Source | Role in the consolidated set | Limitation |
|---|---|---|
| `documents_ai_generated/` (15 primary Markdown documents + 3 appendices) | Repository-oriented baseline: observed architecture, API inventory, data model, local operations, test candidates | A source snapshot, not runtime/UAT proof; some earlier conclusions about frontend wiring were stale and corrected here |
| `document_myself/Proposal/C1SE.15_Proposal_SmartRec_v1.1.docx` | Product vision, target MVP, proposed technology, target metrics, risks and exclusions | Proposal intent is not proof of implementation or customer-approved SLA |
| `document_myself/URD/SmartRec_URD_v1.0.docx` | User requirements, FR-01…FR-09, business rules, NFR/acceptance candidates, data and workflows | Contains conflicting limits and ambitious metrics that need approval and measurable test definitions |
| `document_myself/Interface Design/C1SE.15_InterfaceDesign_SmartRec_v1.0.docx` | Screen and interaction design inputs | A designed screen does not establish a backend API, persisted state or completed feature |

Personal names and other cover-page identifiers in the DOCX files are intentionally not reproduced. Keep the original sources unchanged.

## 2. Reconciliation principles

1. **Source code proves only what is present in the reviewed repository.** Runtime wiring, environment behavior, integration tests and customer deployment still require evidence.
2. **URD/Proposal define target intent.** Requirements are retained with their original FR-01…FR-09 meaning but marked `Target requirement` until implemented and approved.
3. **Interface Design is design evidence.** Existing page routes may be implemented while their designed business behavior remains demo-only or unconnected.
4. **Do not resolve conflicts silently.** Preserve each stated value, identify impact, and ask the product owner/customer to establish one release baseline.
5. **No false acceptance claim.** AI metrics, performance targets and export compatibility are proposed acceptance candidates, not achieved results.

## 3. High-impact comparison

| Topic | Manual target/design | Repository evidence | Consolidated conclusion |
|---|---|---|---|
| Product purpose | AI meeting processing → transcript/speakers/OCR/summary/tasks → human review → export | Upload, file/library, meeting metadata and Trash are implemented; no verified media-to-AI-to-result-to-export path | Treat AI meeting intelligence as target scope, not live capability |
| Authentication | URD login/register; Interface Design also includes forgot-password/OTP and Google OAuth concepts | Backend register/login/JWT and profile/password APIs; UI contains forgot-password route/page. No verified OTP/reset/OAuth backend workflow | Login/register are implemented; recovery/OAuth are UI/design-only unless backend APIs are demonstrated |
| Upload formats | URD names MP4/MKV/MP3; Proposal may describe broader user context | Active UI validation permits MP4/MKV/MP3/M4A; backend paths have separate validation | Approve canonical list and align UI, API, media sniffing and tests |
| File size | URD acceptance says upload up to 5 GB; it does not establish one verified server cap for every upload route | Active UI ceiling is 5 GiB; UI switches to chunk upload above 2 GiB; chunk API exists. Backend multipart is configured at 2 GiB. Presign/complete has service-level verification, requiring runtime limit check | 5 GiB is a UI allowance, not verified system-wide capacity; explicitly approve limit per upload path and proxy/storage |
| Duration | URD input says max 4 hours and BR/AC reject >4h; processing audio >2h should split into 30–45 min pieces | Frontend reads duration for display, but no end-to-end server-side duration gate or AI audio splitting verified | Keep 4h rejection and >2h splitting as target requirements; implement authoritative server validation |
| Chunk-upload workflow | URD targets chunked upload for large media, async continuation | Backend init/chunk/merge/status/control APIs exist. Active UploadPage uses `useLargeUploadStore`/`chunkedUploadService`; a separate legacy hook still simulates progress | Correct prior blanket “chunk UI is mock” statement: active page is wired in source. Verify runtime resume, retries, merge and size edge cases |
| Background execution | URD/Proposal target Redis/Celery AI queue, webhook completion and WebSocket progress | Backend asynchronous chunk merge and upload status polling exist. AI Engine has FastAPI health/root and Celery ping task; no verified media task dispatch or result callback | Separate working async file merge from planned async AI processing |
| AI stack | FFmpeg/WebRTC, faster-whisper, pyannote, PaddleOCR, Gemini 1.5 Flash / LangChain appear in target docs | No complete worker pipeline/result API verified; package/config/pipeline directories alone are insufficient evidence | Treat stack as proposed; confirm versions, licenses, privacy, quotas, hardware and integration before commitment |
| Transcript/review/player | Timestamped transcript, diarization, interactive seek, editable summary/task and human approval | Meeting detail route/component exists but uses local demo status/speaker data; no persisted AI result APIs/entities verified | Preserve as UI prototype/design; exclude from current operational user guide claims |
| Exports/integrations | DOCX/PDF/JSON/CSV; Word template; JSON/CSV compatible with Trello/Jira. Direct sync excluded | No report generator/export API found in API inventory | Export compatibility is target; no direct Trello/Jira/Calendar sync in target MVP |
| Roles/workspace | Interface Design contains roles/permissions and workspace concepts; URD identifies business roles/actors | Workspace page and user-specific ownership exist; no complete role-management/permission matrix or sharing workflow verified | Define tenant/workspace semantics and RBAC before multi-user/customer data use |
| Non-functional targets | WER <15%, DER <15%, noise >80%, video 1h in <5–7 min, timestamp seek <0.5s, no OOM | No integrated AI pipeline, benchmark corpus, defined hardware envelope or runtime measurements | Keep as proposed targets. Approve dataset, scoring method, hardware, timing boundary and confidence criteria before acceptance |
| Infrastructure | Proposal/URD target Vercel + cloud GPU VPS, PostgreSQL/MinIO/Redis/Docker | Repo Compose is a development stack; AI service may use Chroma; backend/frontend run separately per docs | Production topology, GPU allocation, network, TLS, secrets, backup, recovery and SLA remain deployment decisions |
| Delivery schedule | Proposal describes a six-sprint MVP; URD describes a 12-week MVP | Repository snapshot does not establish an approved delivery baseline | Confirm sprint length, milestones, acceptance gates and whether both schedules refer to the same release |

## 3A. Proposal risks carried into the consolidated set

| Risk from manual source | Potential impact | Mitigation/decision to carry forward |
|---|---|---|
| GPU/VRAM OOM on long media or concurrent jobs | AI processing failure and missed latency target | Define supported GPU/hardware and concurrency envelope; benchmark model memory; test controlled OOM/recovery |
| Vietnamese code-switching and specialist vocabulary | WER and task quality miss target | Approve representative annotated corpus and terminology normalization policy; measure by agreed scoring method |
| External Gemini API availability, quota and cost | Summary/task stage blocked, variable cost or data exposure | Confirm provider/API version, quota, budget, retry/fallback policy and privacy/data-processing terms |
| Distributed service/worker integration | Jobs stuck, duplicate callbacks or incorrect status | Define idempotency, retries, terminal states, observability, callback authentication and dead-letter handling |
| Word template variability | Broken layout or unusable report | Obtain approved representative templates and regression fixtures; document unsupported template constructs |
| Long media latency | Processing misses stated target | Define upload-vs-processing timing boundary, hardware, queue load and segment strategy before promising <5–7 min |

## 4. Decisions required before baselining scope

| Decision ID | Decision needed | Source conflict / impact | Recommended next action |
|---|---|---|---|
| DEC-01 | Canonical upload formats and MIME verification | URD MP4/MKV/MP3 vs UI includes M4A; validation differs per path | PO approves a format matrix; engineering enforces it consistently on client and server |
| DEC-02 | Maximum file size and per-path limits | URD says up to 5 GB; backend multipart 2 GiB; UI allows chunk up to 5 GiB | Approve decimal GB vs binary GiB, single/chunk caps, request/proxy/storage caps, and tests |
| DEC-03 | Duration cap | URD max 4 hours, but current upload API does not establish server-side duration validation | Confirm whether 4h is binding and where validation occurs |
| DEC-04 | AI MVP acceptance boundary | URD puts FR-01…FR-09 in MVP; current repository lacks end-to-end AI | Decide release/sprint scope and required dependencies, cost and delivery criteria |
| DEC-05 | AI quality/performance targets | WER/DER/noise/task completeness/latency are stated without corpus/hardware methodology | Approve labeled corpus, metric definitions, test environment and target percentile |
| DEC-06 | Progress/async API | Target mentions WebSocket and webhook; current chunk flow polls status and AI callbacks are absent | Choose polling vs WebSocket, callback authentication, job idempotency/retry and state model |
| DEC-07 | User identity and account recovery | UI has forgot-password concepts; no verified reset/OTP/OAuth server flow | Decide supported auth factors/providers and lifecycle/security requirements |
| DEC-08 | RBAC/workspace/sharing | Role/permission designs lack an established implementation contract | Define roles, tenant boundary, workspace membership, ownership and sharing rules |
| DEC-09 | Review and result lifecycle | Target requires human approval, edit history and durable AI results; current data model lacks result entities | Define entities, versioning, audit, authorization, concurrency and approval state |
| DEC-10 | Export contract | Formats and Trello/Jira import compatibility lack templates/schemas | Approve sample templates, field mapping, encoding, error behavior and compatibility versions |
| DEC-11 | Privacy, retention and data residency | Meeting media/transcripts may contain sensitive business/personal information; policy not defined | Approve consent, region, encryption, access logs, retention/deletion and provider data handling |
| DEC-12 | Production operations | Cloud GPU, backups, RPO/RTO, availability, alerts and support window not baselined | Create customer-specific topology and operational/SLA runbook before production |

## 5. Interface Design disposition

The consolidated [User Guide](../02-user-guide.md) maps designed screens to source evidence. In brief:

- Routes/pages exist for login/register, forgot password, dashboard, profile, upload, meeting/library, meeting detail, Trash and workspace.
- Page existence is not equivalent to a completed business flow. Password recovery has no verified server contract; meeting detail includes local/demo AI state and speakers; role/permission management, persisted result editing, workspace sharing and export are not verified end-to-end.
- Batch upload is present in the active upload page, with per-strategy queue limits. These limits are current UI behavior and require release testing.

## 6. Document crosswalk

| Manual source | Consolidated destinations |
|---|---|
| Proposal v1.1: vision, scope/exclusions, target architecture, metrics, risks/roadmap | [Product Overview](../01-product-overview.md), [FR](../03-functional-requirements.md), [NFR](../04-non-functional-requirements.md), [Architecture](../06-system-architecture.md), this appendix |
| URD v1.0: UR-001…UR-018, BR-001…BR-023, FR-01…FR-09, NFR, workflows, data, integrations, constraints, AC-01…AC-21 | [FR](../03-functional-requirements.md), [NFR](../04-non-functional-requirements.md), [User Workflows](../05-user-workflows.md), [Data Model](../07-data-model.md), [API Workflows](../10-api-workflows.md), [Test Cases/UAT](../13-test-cases-and-uat.md), [Traceability Matrix](./traceability-matrix.md) |
| Interface Design v1.0: page/screen requirements and interactions | [User Guide](../02-user-guide.md), [Product Overview](../01-product-overview.md), this appendix |
| AI-generated documentation: source inventory and code-derived details | Documents 06–14, with active upload wiring correction in 01/02/03/05/10 |

URD acceptance criteria AC-01…AC-21 are represented as candidate requirements/tests in sections 3–4 and test cases. They are not reported as passed.

## 7. Reconciliation maintenance

When the owner resolves a decision, record decision ID, approver, date, selected option and affected release. Update the relevant requirement/API/workflow/test documents and traceability links together. Keep the AI-generated and manual source folders unchanged as provenance.
