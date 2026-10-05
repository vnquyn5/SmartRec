# SmartRec - Test Cases and UAT

**Trạng thái:** Proposed cases; all execution results are Pending. This file does not assert any test passed.

## 1. Test case format

Each execution records build/revision, environment, tester, date, preconditions, test data, steps, expected/actual result, status (`Pending`, `Pass`, `Fail`, `Blocked`), evidence and defect ID.

## 2. Authentication and profile

| ID | Scenario | Steps | Expected result |
|---|---|---|---|
| TC-AUTH-001 | Register valid user | Submit valid unique email/phone/name/password | `201`; account created; password not returned |
| TC-AUTH-002 | Duplicate email or phone | Register using existing value | Conflict business error |
| TC-AUTH-003 | Invalid password/name/phone | Submit DTO-invalid values | Validation error; no account created |
| TC-AUTH-004 | Login valid and invalid | Try correct then wrong password | Token only for valid active account; generic credential failure otherwise |
| TC-AUTH-005 | Protected endpoint without token | Call protected route without Bearer | Request rejected |
| TC-AUTH-006 | Expired/invalid token | Call protected route with invalid token | Request rejected; no authenticated data returned |
| TC-USER-001 | Own profile | GET current profile, update valid fields | Only current user profile is returned/updated |
| TC-USER-002 | Change password | Change password with valid/invalid current data | Defined success/error; verify subsequent login behavior |

## 3. Upload

| ID | Scenario | Steps | Expected result |
|---|---|---|---|
| TC-UP-001 | Multipart upload valid media | Upload synthetic supported file | Object and metadata created; response IDs present |
| TC-UP-002 | Multipart invalid/oversized media | Submit invalid type or over configured limit | Rejected; no misleading success |
| TC-UP-003 | Presign flow | Request URL, PUT object, call complete | Object verified; metadata created once |
| TC-UP-004 | Presign completion wrong key | Complete using key outside user's expected key | Forbidden/rejected |
| TC-UP-005 | Presign completion size mismatch | Upload size differs from submitted size | Rejected |
| TC-UP-006 | Chunk session init | Initialize valid filename/size/chunk count | Session ID and expected 5 MiB chunk setting returned |
| TC-UP-007 | Chunk checksum mismatch | Send bytes with incorrect MD5 | Chunk rejected; error state observable |
| TC-UP-008 | Missing chunk before merge | Skip one chunk and request merge | Merge not incorrectly marked complete |
| TC-UP-009 | Complete chunk merge | Upload every chunk, merge and poll status | Eventually COMPLETED; final object readable; metadata present |
| TC-UP-010 | Pause/resume/cancel | Exercise each control in allowed states | Status transition and subsequent allowed actions match contract |
| TC-UP-011 | Redis unavailable/recovery | Controlled fault test | Explicit error/fallback behavior; no success-shaped false result |
| TC-UP-012 | UI real integration | Execute on release UI and inspect network requests | UI calls backend; exclude mock-only progress |

## 4. Library, ownership and Trash

| ID | Scenario | Steps | Expected result |
|---|---|---|---|
| TC-LIB-001 | Page/filter/search/sort | Query valid and invalid values | Correct user-scoped page; invalid pagination/sort rejected |
| TC-LIB-002 | Download own file | Download using owned meeting UUID | Correct content/name/size |
| TC-LIB-003 | ZIP selected files | Submit valid IDs and empty list | ZIP contains selected files; empty list rejected |
| TC-LIB-004 | Rename valid/invalid | Rename own file with valid and invalid names | Valid metadata updates; invalid filename rejected |
| TC-SEC-001 | Cross-user access | User B attempts User A list/download/rename/delete | No User A data disclosure or modification |
| TC-TRASH-001 | Soft delete and list | Delete owned meeting, list Trash | Media status TRASHED; object remains present |
| TC-TRASH-002 | Restore | Restore trashed media | Status restored; metadata cleared |
| TC-TRASH-003 | Permanent delete | Permanent-delete trashed media | Object and associated DB records removed |
| TC-TRASH-004 | Permanent delete active media | Attempt permanent delete not in Trash | Conflict/rejected; object retained |
| TC-TRASH-005 | Expired retention purge | Controlled test with expired record | Scheduler attempts removal and logs failures |

## 5. Service resilience/security

| ID | Scenario | Steps | Expected result |
|---|---|---|---|
| TC-OPS-001 | MinIO outage on upload | Stop MinIO in isolated environment and upload | Explicit service error; no success response |
| TC-OPS-002 | MinIO outage on permanent delete | Fail object deletion | DB metadata is not deleted as if successful |
| TC-SEC-002 | CORS and bucket policy | Verify allowed origins/methods and anonymous access in target env | Matches approved policy, no unintended public access |
| TC-SEC-003 | Secret/config review | Inspect deployment environment and logs | No defaults/secrets exposed; sensitive values redacted |

## 6. UAT scenarios

| UAT ID | Business scenario | Acceptance evidence |
|---|---|---|
| UAT-001 | User registers and signs in | Approved validation and successful authenticated session |
| UAT-002 | User uploads a media file using the release-supported path | File appears in library with correct metadata |
| UAT-003 | User finds and downloads a file | Content matches uploaded test file |
| UAT-004 | User renames and moves file to Trash | New name visible; item appears in Trash |
| UAT-005 | User restores and permanently deletes selected test items | Restore returns item; permanent delete removes it |
| UAT-006 | User profile operation | Profile/change-password behavior matches approved requirement |

UAT is not accepted until customer representative records Actual Result, status, date and sign-off. AI output is excluded unless added as an approved scenario with expected output/quality thresholds.

## 7. Target AI MVP tests (blocked until scope/API/pipeline is implemented)

The following are acceptance candidates from URD, not executable/passable tests against current source. First approve datasets, metric calculation, model/provider versions, hardware, interfaces and expected error behavior.

| Candidate ID | URD trace | Scenario / proposed acceptance | Current state |
|---|---|---|---|
| TC-AI-001 | FR-01, BR-001/002 | Accept approved media types and size; reject >4h with agreed error | Duration validation/job orchestration not verified; 5 GiB vs backend limits conflict |
| TC-AI-002 | FR-01, BR-003 | Audio >2h split into 30–45 min segments without gaps/duplication | AI media pipeline not verified |
| TC-AI-003 | FR-02, BR-007/008 | Output 16 kHz mono; noise reduction >80% under approved acoustic test | Metric definition/dataset missing |
| TC-AI-004 | FR-03, BR-009/010 | Vietnamese/code-switching WER <15%; timestamps accurate to the second | No verified ASR flow or test corpus |
| TC-AI-005 | FR-04, BR-011 | DER <15% on approved multi-speaker corpus including overlaps | No verified diarization flow/corpus |
| TC-AI-006 | FR-05, BR-012 | OCR Vietnamese/English and capture agreed KPI/table content | No verified OCR flow/golden set |
| TC-AI-007 | FR-06, BR-013–015 | Valid summary/task JSON; measure task recall against labeled corpus | 100% target needs operational definition; no LLM integration |
| TC-AI-008 | FR-07, BR-016 | Timestamp click seeks in <0.5s and stays synchronized | UI demo only; media/network benchmark undefined |
| TC-AI-009 | FR-08, BR-017/021 | Human changes persist and unapproved output cannot be exported as final | No verified result CRUD/review state |
| TC-AI-010 | FR-09, BR-018–020 | DOCX layout check; JSON/CSV imports to approved Jira/Trello format | No exporter or target templates/import fixture |
| TC-AI-011 | NFR-PERF-AI-01 | End-to-end processing of 1-hour video <5–7 minutes | No worker pipeline; hardware/concurrency and timing start point TBD |

Do not mark these candidates Pass based on mock UI, architecture diagrams or isolated model experiments; attach build, environment, dataset, measurements and reviewer sign-off.
