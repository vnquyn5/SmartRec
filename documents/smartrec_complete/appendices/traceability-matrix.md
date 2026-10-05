# SmartRec - Traceability Matrix

**Status:** Initial mapping template; separates source implementation from target MVP requirements. Test IDs identify proposed cases; no execution is implied.

| Requirement | Workflow | Design | API | Proposed test | UAT |
|---|---|---|---|---|---|
| FR-AUTH-001 | 05 Register | 06 Auth boundary | `POST /api/v1/api/auth/register`* | TC-AUTH-001/002/003 | UAT-001 |
| FR-AUTH-003 | 05 Login | 06 JWT | `POST /api/v1/api/auth/login`* | TC-AUTH-004 | UAT-001 |
| FR-AUTH-004 | 05 Protected actions | 08 Security | Protected endpoints | TC-AUTH-005/006 | UAT-001 |
| FR-USER-001 | 05 Profile | 07 users | `GET/PUT /api/v1/api/user/me`* | TC-USER-001 | UAT-006 |
| FR-USER-002 | 05 Profile | 08 Security | `PUT /api/v1/api/user/change-password`* | TC-USER-002 | UAT-006 |
| FR-UPLOAD-001 | 05 Direct upload | 06 Storage | `POST /api/v1/meetings/upload`* | TC-UP-001/002 | UAT-002 |
| FR-UPLOAD-002 | 05 Presigned upload | 06 Browser/MinIO | `POST /api/v1/upload/presign`, `/complete`* | TC-UP-003/004/005 | UAT-002 |
| FR-UPLOAD-003–006 | 05 Chunk flow | 06 Redis/MinIO/async merge | `/upload/init`, `/chunk`, `/merge`, `/status`, controls* | TC-UP-006–011 | UAT-002 if UI integrated |
| FR-UPLOAD-007 | 05 UI integration | 06 Frontend/backend boundary | Chunk APIs | TC-UP-012 | UAT-002 |
| FR-LIB-001 | 05 Library | 07 meetings | `GET /api/v1/meetings`* | TC-LIB-001 | UAT-003 |
| FR-LIB-002/003 | 05 Download | 06 MinIO stream | `GET /meetings/{id}/download`, `POST /meetings/download`* | TC-LIB-002/003 | UAT-003 |
| FR-LIB-004 | 05 Rename | 07 media_file | `PATCH /meetings/{id}/name`* | TC-LIB-004 | UAT-004 |
| FR-LIB-005 | 05 Soft delete | 07 media lifecycle | `DELETE /meetings/{id}`* | TC-TRASH-001 | UAT-004 |
| FR-TRASH-001/002 | 05 Trash/restore | 07 media lifecycle | `/media/trash`, `/media/{id}/restore`* | TC-TRASH-001/002 | UAT-005 |
| FR-TRASH-003/004 | 05 Permanent/purge | 06 MinIO/DB | `/media/{id}/permanent`* + scheduler | TC-TRASH-003/004/005 | UAT-005 |
| FR-AI-001 | Ops health | 06 AI Engine | AI `GET /`, `/health` | Operational smoke test | Out of end-user UAT |
| FR-AI-002 | Planned | TBD | No verified user-facing API | Not in current acceptance baseline | Not applicable |

## Target URD FR traceability

| URD requirement | Target workflow | Source API/data evidence | Candidate test | Current implementation |
|---|---|---|---|---|
| FR-01 Large media ingestion and AI job creation | 05 target AI flow | Existing upload endpoints cover upload only; no verified AI job API/entity | TC-AI-001/002 | Upload paths exist; duration enforcement/job dispatch absent or unverified |
| FR-02 Noise reduction | 05 target AI flow | No user-facing processing API/result contract | TC-AI-003 | Not verified |
| FR-03 Vietnamese STT | 05 target AI flow | No transcript API/entity | TC-AI-004 | Not verified |
| FR-04 Diarization | 05 target AI flow | No persisted speaker-result API/entity | TC-AI-005 | UI demo state only |
| FR-05 Video/OCR | 05 target AI flow | No OCR API/entity | TC-AI-006 | Not verified |
| FR-06 Summary/task extraction | 05 target AI flow | No job/result/export contract | TC-AI-007 | Not verified |
| FR-07 Interactive player | 05 target review | Meeting-detail UI exists; no verified timestamped AI data contract | TC-AI-008 | Demo UI/data only |
| FR-08 Human review/edit | 05 target review | No verified result CRUD endpoint/entity | TC-AI-009 | Not verified |
| FR-09 Report export | 05 target export | No report generation API found in inventory | TC-AI-010 | Not verified |
| Target AI performance | 04 proposed NFR | No verified AI processing flow | TC-AI-011 | Not measurable yet |

## Authority and interpretation

- Requirement statement and target scope: manual URD v1.0 and Proposal v1.1.
- Screen concepts and interactions: manual Interface Design v1.0; visual presence does not prove backend behavior.
- As-built endpoint/entity/component status: repository source as documented in 03, 06, 07 and 09.
- If the mappings disagree, capture a product decision in [Source Reconciliation](./source-reconciliation.md) and update this table after approval.

`*` Confirm full externally exposed path and contract from target runtime/OpenAPI before customer integration. Update this matrix when IDs, endpoints, implementation status or test IDs change.
