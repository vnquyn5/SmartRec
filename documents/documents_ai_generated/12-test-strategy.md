# SmartRec - Test Strategy

**Trạng thái:** Test plan, not a test execution report.

## 1. Objectives

- Verify each approved functional requirement.
- Verify API contracts, ownership boundaries and media object lifecycle.
- Exercise cross-service flows with PostgreSQL, Redis and MinIO.
- Validate UI/API integration and explicitly identify mock behavior.
- Provide reproducible evidence for UAT and release decisions.

## 2. Scope

### In scope

Auth/profile, direct and chunk upload APIs, meeting list/download/rename/Trash, Trash restore/permanent purge, API security, frontend integration, service startup.

### Not assumed in scope

AI transcription/model quality, production load/SLA, DR guarantees and compliance certification. Include only after separate approved requirements.

## 3. Test levels

| Level | Examples | Owner |
|---|---|---|
| Unit | Service validation, status transitions, DTO/business rules | Developers |
| API/component | Controller request/response and validation | Dev/QA |
| Integration | PostgreSQL/Redis/MinIO interactions, merge and cleanup | Dev/QA |
| UI/system | User flows through browser and real API | QA |
| Security | JWT, ownership isolation, upload/session access, config | Security/QA |
| UAT | Customer-confirmed business scenarios | Customer/PO with QA |

## 4. Test environments and data

- Local isolated Compose stack for development/integration.
- Dedicated test environment for acceptance; never use production customer media as test data without approval.
- Synthetic accounts and small synthetic media files with known size/checksum.
- Separate users to test cross-user access denial.
- Controlled fault injection for Redis/MinIO/database failures; do not disrupt shared environments.

Environment versions, endpoint URLs, data reset procedure and access controls must be recorded per execution.

## 5. Entry and exit criteria

### Entry

- Build deployable and target environment available.
- Test build/source revision known.
- Requirements and expected behavior approved.
- Test accounts/data prepared; dependencies healthy.

### Exit

- All Must requirements have pass/fail/blocked result and evidence.
- No open release-blocking defects; remaining risks accepted by named owner.
- Security/ownership cases passed.
- UAT acceptance signed off by authorized customer representative.
- Build, environment and test report are traceable.

Threshold for defect severity/count is TBD by project governance.

## 6. Automation and reporting

Repository currently contains backend tests under `src/test`; the reviewed test inventory includes `UserServiceImplTest`. Frontend scripts include lint/build, not a declared test script in package manifest. This does not imply all listed scenarios are automated.

For every run, capture: test ID, source revision, environment, tool/command, start time, result, evidence reference, defect ID and tester.

## 7. Risks

- Frontend chunk hook currently contains mock behavior; false-positive UI progress risk.
- Async merge creates timing-sensitive tests; poll status with bounded timeout.
- Cross-service operations are not one atomic transaction; test partial failures.
- Compose defaults are development-oriented; avoid running test instructions against production.
- Missing agreed NFR thresholds prevents performance acceptance.

## 8. Defect handling

Record reproducible steps, expected/actual result, request/session IDs (redacted), environment, logs and severity. Never include credentials, JWTs, presigned URLs or private media in defect tickets.
