# Software Project Documentation Structure

## 1. Recommended Documentation Structure

```text
documents/
│
├── 00-document-index.md
│
├── 01-product-overview.md
├── 02-user-guide.md
│
├── 03-functional-requirements.md
├── 04-non-functional-requirements.md
├── 05-user-workflows.md
│
├── 06-system-architecture.md
├── 07-data-model.md
├── 08-security-and-privacy.md
│
├── 09-api-reference.md
├── 10-api-workflows.md
│
├── 11-developer-guide.md
│
├── 12-test-strategy.md
├── 13-test-cases-and-uat.md
│
├── 14-deployment-and-operations.md
│
└── appendices/
    ├── traceability-matrix.md
    ├── glossary.md
    └── changelog.md
```

> **Quy mô bộ tài liệu:** cấu trúc trên gồm **15 tài liệu chính** (ID 00-14) và **3 phụ lục**. Số lượng này được dùng thống nhất trong phần ưu tiên và checklist bên dưới.

## 1.1 Quy tắc phản ánh đúng trạng thái sản phẩm

Mỗi mô tả chức năng trong tài liệu SmartRec cần được đánh dấu theo một trong các trạng thái sau:

- **Implemented in backend** — logic/API có trong source backend.
- **Integrated in frontend** — giao diện hiện gọi API thật cho luồng đó.
- **Mock/demo** — giao diện hoặc service mô phỏng, chưa thực hiện nghiệp vụ thật.
- **Planned / not integrated** — ý tưởng hoặc module nền tảng chưa nối thành luồng sản phẩm.
- **TBD / needs confirmation** — yêu cầu hoặc quyết định chưa được khách hàng/project owner xác nhận.

Không suy ra trạng thái “sẵn sàng cho người dùng” chỉ từ việc có class, pipeline file hoặc endpoint health. Đặc biệt, các tính năng AI phải có API/task integration, kết quả và luồng hiển thị đã được xác minh trước khi đưa vào phạm vi tính năng hiện hành.

Các tài liệu phải phản ánh source tại thời điểm phát hành; ghi ngày rà soát, version/revision và các giới hạn đã biết.

---

## 2. Documentation Overview

| ID | Document | Purpose |
|---|---|---|
| 00 | `00-document-index.md` | Danh mục và hướng dẫn đọc toàn bộ tài liệu |
| 01 | `01-product-overview.md` | Tổng quan sản phẩm, mục tiêu, phạm vi và đối tượng sử dụng |
| 02 | `02-user-guide.md` | Hướng dẫn sử dụng hệ thống cho người dùng cuối |
| 03 | `03-functional-requirements.md` | Các yêu cầu chức năng của hệ thống |
| 04 | `04-non-functional-requirements.md` | Các yêu cầu phi chức năng và tiêu chí chất lượng |
| 05 | `05-user-workflows.md` | Luồng nghiệp vụ và user workflow |
| 06 | `06-system-architecture.md` | Kiến trúc hệ thống, component và data flow |
| 07 | `07-data-model.md` | Database schema, ERD và quan hệ dữ liệu |
| 08 | `08-security-and-privacy.md` | Authentication, authorization, security và privacy |
| 09 | `09-api-reference.md` | Danh sách và đặc tả API |
| 10 | `10-api-workflows.md` | Luồng gọi API theo từng business flow |
| 11 | `11-developer-guide.md` | Hướng dẫn setup và phát triển project |
| 12 | `12-test-strategy.md` | Chiến lược, phạm vi, phương pháp và môi trường kiểm thử |
| 13 | `13-test-cases-and-uat.md` | Test cases, acceptance criteria và UAT |
| 14 | `14-deployment-and-operations.md` | Docker, deployment, configuration và vận hành |
| A1 | `appendices/traceability-matrix.md` | Trace Requirement → Design → API → Test → UAT |
| A2 | `appendices/glossary.md` | Giải thích thuật ngữ dùng trong project |
| A3 | `appendices/changelog.md` | Lịch sử thay đổi tài liệu/project |

---

# 3. Detailed Content Recommendation

## 00. Document Index

### Mục đích
Là entry point của toàn bộ documentation.

### Nên có
- Documentation map
- Danh sách tất cả tài liệu
- Mô tả ngắn từng tài liệu
- Documentation flow
- Version hiện tại

### Documentation Flow

```text
Product Overview
        ↓
Functional Requirements
        ↓
Non-Functional Requirements
        ↓
User Workflows
        ↓
System Architecture
        ↓
Data Model / Security
        ↓
API Reference / API Workflows
        ↓
Developer Guide
        ↓
Test Strategy
        ↓
Test Cases / UAT
        ↓
Deployment & Operations
```

---

# 4. Product Documentation

## 01. Product Overview

### Nên có
- Product vision
- Problem statement
- Objectives
- Target users
- Main features
- Product scope
- In-scope
- Out-of-scope
- Technology overview
- Project constraints

### Ví dụ Scope

```text
In Scope:
- Đăng ký, đăng nhập và xác thực JWT (đối chiếu trạng thái UI)
- Quản lý profile người dùng
- Upload media trực tiếp và upload theo chunk (ghi rõ API backend vs UI integration)
- Quản lý meeting/media: danh sách, tìm kiếm/lọc, đổi tên và tải file
- Thùng rác: chuyển vào Trash, khôi phục, xóa vĩnh viễn
- AI Engine root/health check (chỉ là health capability)

Planned / Not yet confirmed as user-facing:
- AI audio/video analysis, transcription, OCR, NLP, embeddings hoặc semantic search
- AI job lifecycle và hiển thị kết quả xử lý trên UI

Out of Scope:
- Tính năng không được xác nhận trong source hoặc product decision
- Real-time video conferencing, live meeting streaming, calendar integration,
  enterprise SSO (trừ khi được đưa vào scope chính thức)
```

Phân loại trên là bản khởi đầu theo source đã rà soát; cần cập nhật khi kiểm tra UI/service đầy đủ và chốt phạm vi với khách hàng.

---

## 02. User Guide

### Nên có
- System requirements
- Register
- Login
- Dashboard
- Upload media (nêu rõ đường upload đang được UI sử dụng)
- Theo dõi upload status nếu UI đã tích hợp endpoint status
- Xem danh sách meeting/media, tìm kiếm/lọc
- Tải một file hoặc tải nhiều file dạng ZIP
- Đổi tên file
- Chuyển file vào Trash, restore, xóa vĩnh viễn
- Xem/cập nhật profile và đổi password nếu giao diện cung cấp
- Logout
- Error messages
- Screenshots

Tài liệu này dành cho **end user**, không phải developer.
Chỉ đưa thao tác vào hướng dẫn sau khi xác nhận màn hình tương ứng thực sự có và đã được nối với backend. Không hướng dẫn transcript hoặc kết quả AI khi chưa có luồng sản phẩm hoàn chỉnh.

---

# 5. Requirements

## 03. Functional Requirements

Mỗi requirement nên có ID duy nhất.

### Recommended ID

```text
FR-AUTH-001
FR-AUTH-002

FR-UPLOAD-001
FR-UPLOAD-002
FR-LIBRARY-001
FR-TRASH-001
FR-PROFILE-001
```

### Recommended format

```text
FR-UPLOAD-001

Title:
Upload Media File

Description:
The system shall provide the agreed media upload flow for an authenticated user.

Pre-condition:
User is authenticated.

Input:
- Media file in a supported format
- File name and size
- For chunked upload: upload session, chunk index and checksum

Expected Behavior:
- Validate request and supported file type
- For chunked upload, create a session and track chunk progress
- Store uploaded object in MinIO
- Create/reuse media and meeting metadata after successful completion
- Report asynchronous merge status where applicable

Not implied by this requirement:
- Starting an AI/transcription job, unless a verified integration is included in scope.
```

### Requirement categories

```text
Authentication
Authorization
Meeting Management
File Upload
Media Library
Trash and Restore
User Profile
AI / transcription (Planned only unless implementation is verified)
```

---

## 04. Non-Functional Requirements

### Nên có

```text
Performance
Scalability
Availability
Reliability
Security
Usability
Compatibility
Maintainability
Observability
```

### Recommended ID

```text
NFR-PERF-001
NFR-SEC-001
NFR-USE-001
NFR-REL-001
```

### Lưu ý

Các chỉ số như:

```text
WER target
DER target
Processing time target
Maximum upload size
Response time
```

nên ghi rõ là **requirement, target, acceptance threshold, TBD hoặc not applicable** tùy theo quyết định chính thức của project. Không đưa WER/DER hay AI processing time thành NFR cam kết nếu xử lý AI chưa thuộc phạm vi đã triển khai và nghiệm thu.

Mỗi NFR cần có tối thiểu:

- ID duy nhất, mô tả và lý do nghiệp vụ.
- Chỉ số/đơn vị đo, điều kiện đo và môi trường đo.
- Ngưỡng mục tiêu hoặc trạng thái `TBD — customer/project owner confirmation required`.
- Cách kiểm chứng và tài liệu/test evidence liên quan.

Ví dụ, các giá trị sau **chưa được mặc định**; cần điền sau khi thống nhất:

| NFR | Chỉ số cần chốt | Trạng thái ban đầu |
|---|---|---|
| Hiệu năng API | p95 response time, endpoint và tải thử | TBD |
| Upload | dung lượng file tối đa, số upload đồng thời, throughput | TBD; cấu hình backend hiện không tự động là cam kết sản phẩm |
| Availability | service availability target và cửa sổ đo | TBD |
| Reliability | retry/recovery behavior, giới hạn mất dữ liệu | TBD |
| Security | yêu cầu xác thực, authorization, quản lý secret, kiểm thử | Cần đối chiếu thiết kế và deployment |
| Backup/Recovery | RPO, RTO, tần suất backup và restore test | TBD |
| Compatibility | browser/OS/client versions được hỗ trợ | TBD |

---

## 05. User Workflows

### Nên có workflow cho

```text
Register
Login
Profile Management
Direct Upload (nếu UI tích hợp)
Chunked Upload (API capability; xác minh UI integration)
View/Search/Filter Media Library
Download / Rename
Move to Trash / Restore / Permanent Delete
Logout
```

### Ví dụ Upload Flow

```text
User
  ↓
Select File
  ↓
Validate File
  ↓
Choose implemented upload mode
  ├── Direct: request presigned upload or multipart upload
  │       ↓
  │   Complete upload and create metadata
  └── Chunked: initialize session
          ↓
      Upload chunks and track progress
          ↓
      Request asynchronous merge
          ↓
      Check final upload status
  ↓
Create/reuse MediaFile and Meeting metadata
  ↓
Show file in library
```

Nên dùng flowchart/sequence diagram nếu có thể.
AI processing/transcript chỉ được thêm thành bước thực tế khi API/task dispatch, status transitions, persistence và UI result flow đã được xác minh.

---

# 6. Technical Architecture

## 06. System Architecture

### Nên có

- System context
- High-level architecture
- Component architecture
- Deployment architecture
- Data flow
- External services
- Technology stack
- Communication protocols

### Ví dụ kiến trúc

```text
React/Vite Frontend
        |
        | HTTP REST + JWT
        v
Spring Boot Backend
    |          |             |
    v          v             v
PostgreSQL   Redis          MinIO
                             ^
                             |
                   AI Engine (FastAPI)
                   Current verified scope:
                   root/health endpoints
                   + configured integration clients
                   (media-processing flow TBD)
                             |
                             v
                          ChromaDB
```

Sơ đồ cần thể hiện bằng nét liền các kết nối đã xác minh trong runtime; dùng nét đứt/ghi chú “planned” cho integration mới có cấu hình hoặc chưa có luồng nghiệp vụ hoàn chỉnh.

---

## 07. Data Model

### Nên có

- ERD
- Database tables
- Primary keys
- Foreign keys
- Relationships
- Data types
- Constraints
- Indexes
- Important business rules

### Ví dụ

```text
users (id)
  ├── meetings.workspace_id
  ├── media_file.workspace_id
  ├── media_file.uploaded_by
  └── upload_sessions.user_id

meetings.media_file_id ──> media_file.id
```

Sơ đồ trên chỉ là **logical ownership/reference map** theo các field trong entity hiện được rà soát. Không mặc định các đường này là database foreign keys hoặc JPA relationships. Xác nhận schema/migrations thực tế trước khi phát hành ERD vật lý.

### Table documentation

| Column | Type | Nullable | Key | Description |
|---|---|---|---|---|
| id | UUID | No | PK | Unique identifier |
| file_name | VARCHAR | No | | Original file name |
| created_at | TIMESTAMP | No | | Creation time |

---

## 08. Security and Privacy

### Nên có

- Authentication
- JWT/token handling
- Authorization
- Roles/RBAC only if implemented and verified
- Ownership access
- Password security
- Input validation
- API security
- File access control
- Data privacy
- Sensitive data handling
- Error handling

### Ownership example

```text
User A
  |
  | owns
  v
Meeting A

User B
  |
  X
  |
Meeting A
```

Hệ thống phải kiểm tra ownership/permission theo requirement.
Tài liệu as-built cần mô tả đúng cơ chế hiện có: JWT stateless authentication và các kiểm tra user/workspace ownership ở service. Không mô tả RBAC/role policy như tính năng hiện hành nếu chưa có role model, role claims và enforcement tương ứng. Security design cũng cần ghi rõ các điểm chưa được xác minh thay vì khẳng định kiểm soát bao phủ mọi endpoint.

---

# 7. API Documentation

## 09. API Reference

Mỗi API nên document:

```text
HTTP Method
Endpoint
Authentication
Authorization
Headers
Path Parameters
Query Parameters
Request Body
Response
HTTP Status Codes
Validation Rules
Error Responses
```

### Example

```text
Backend context path: /api/v1
Controller mapping: /api/auth/login
Effective endpoint: POST /api/v1/api/auth/login

Authentication:
Not required

Request:
{
    "email": "user@example.com",
    "password": "..."
}

Success:
200 OK

Possible Errors:
400 Bad Request
401 Unauthorized
```

Các endpoint thực tế cần lấy từ controller mapping cộng với `server.servlet.context-path` trong cấu hình môi trường đang triển khai. Không giả định rằng mọi route bắt đầu bằng `/api/v1`; không tự thêm/bỏ prefix. Bản OpenAPI/Swagger, nếu được dùng, cần đối chiếu với runtime trước khi gửi cho khách hàng.

---

## 10. API Workflows

API Reference trả lời:

> API này làm gì?

API Workflow trả lời:

> Trong một business flow, các API được gọi theo thứ tự nào?

### Example: Meeting Upload

```text
Direct multipart:
1. Client sends POST /meetings/upload with media file
2. Backend validates and stores the object
3. Backend creates media/meeting metadata
4. Client receives upload result

Presigned direct upload:
1. Client requests POST /upload/presign
2. Client uploads object directly to MinIO using the returned instructions
3. Client calls POST /upload/complete
4. Backend confirms completion and creates metadata

Chunked upload:
1. Client calls POST /upload/init
2. Client sends chunks using POST /upload/chunk and tracks progress
3. Client requests POST /upload/merge
4. Backend returns MERGING/202 while async merge runs
5. Client checks GET /upload/status for final status
6. On completion, client refreshes GET /meetings
```

AI processing must appear as a separate planned flow unless an implemented backend/queue integration and user-visible result flow are confirmed.

---

# 8. Developer Documentation

## 11. Developer Guide

### Nên có

```text
Prerequisites
Environment Setup
Repository Structure
Backend Setup
Frontend Setup
AI Engine Setup
Database Setup
Docker Setup
Environment Variables
Local Development
Testing Locally
Build
Troubleshooting
```

### Example technology prerequisites

```text
Java 17 or higher
Maven wrapper (included)
Node.js/npm compatible with the frontend project
Python version compatible with ai-engine dependencies
Docker Desktop / Docker Compose
PostgreSQL, Redis, MinIO and ChromaDB (normally started via Compose for local development)
```

### Repository Structure

```text
SmartRec/
├── Frontend/smartrec-frontend/
├── src/                         # Spring Boot backend
├── ai-engine/
├── documents/                   # Existing project documents
├── docker-compose.yml
├── pom.xml
└── documents/                   # Customer/development documentation set
```

---

# 9. Testing Documentation

## 12. Test Strategy

### Nên có

1. Testing Objectives
2. Testing Scope
3. Testing Types
4. Testing Levels
5. Test Environment
6. Test Tools
7. Test Data
8. Entry Criteria
9. Exit Criteria
10. Defect Management
11. Test Risks
12. Test Metrics
13. Regression Strategy

### Testing Types

```text
Functional Testing
API Testing
Integration Testing
Regression Testing
UAT
Security Testing
Compatibility Testing
Validation Testing
```

Test Strategy cần phân biệt **automated tests hiện có**, **manual/API test cases dự kiến hoặc đã chạy**, và **integration/UAT tests dự kiến hoặc đã chạy**. Không khẳng định test đã chạy/đạt nếu chưa có evidence; khi báo cáo kết quả cần ghi source revision, môi trường, thời điểm, lệnh chạy và kết quả.

### Test tools

```text
API client (e.g. Postman; confirm project choice)
Issue tracker (confirm project choice)
Browser DevTools
SQL client
Docker / Docker Compose
Supported browsers (must be agreed and recorded)
```

Đây là gợi ý công cụ, không phải khẳng định tất cả công cụ đã được chọn hoặc đang được sử dụng.

---

## 13. Test Cases and UAT

Nếu số lượng testcase lớn, nên tách thành thư mục riêng:

```text
documents/
└── testing/
    ├── test-strategy.md
    ├── test-environment.md
    ├── test-cases-auth.md
    ├── test-cases-upload.md
    ├── test-cases-meeting.md
    ├── test-cases-delete.md
    ├── test-cases-api.md
    ├── regression-test-suite.md
    └── uat.md
```

### Recommended Test Case Columns

```text
Test Case ID
Title
Pre-Condition
Test Data
Test Steps
Expected Result
Actual Result
Status
Bug ID
Tester
```

### Status

```text
Pass
Failed
Blocked
Pending
```

### UAT nên có

```text
UAT ID
Business Scenario
Pre-condition
Steps
Expected Result
Acceptance Criteria
Actual Result
Status
Remarks
```

---

# 10. Deployment and Operations

## 14. Deployment and Operations

### Nên có

- Deployment architecture
- Docker architecture
- Docker Compose
- Environment variables
- Service configuration
- Port mapping
- Health checks
- Logs
- Backup
- Recovery
- Monitoring
- Troubleshooting
- Startup/shutdown procedure

### SmartRec-specific deployment cautions

- Tách hướng dẫn local/development khỏi staging/production; không coi giá trị mặc định trong source hoặc Compose là cấu hình production.
- Dùng secret/credential riêng qua secret manager hoặc environment được bảo vệ; không ghi secret thật vào tài liệu, repository hoặc ảnh chụp màn hình.
- Rà soát cấu hình mặc định của PostgreSQL, MinIO, JWT, CORS và MinIO bucket policy; xác nhận quyền truy cập bucket trước khi triển khai.
- Rà soát `spring.jpa.hibernate.ddl-auto`, SQL/bind-parameter logging, port exposure, TLS/reverse proxy và network policy cho môi trường mục tiêu.
- Ghi rõ service nào bắt buộc để chạy tính năng nào; chỉ đưa AI Engine/ChromaDB vào critical path khi integration thực tế đã được xác nhận.
- Ghi lại các thao tác backup/restore và thử khôi phục trong môi trường kiểm soát; không chỉ nêu có volume là đã có backup.

### Example

```text
Frontend
Backend
AI Engine
PostgreSQL
Redis
MinIO
ChromaDB
```

### Basic Docker commands

```bash
docker compose up -d
docker compose ps
docker compose logs
docker compose down
```

---

# 11. Appendices

## A1. Traceability Matrix

Đây là tài liệu rất quan trọng để liên kết toàn bộ Software Engineering lifecycle.

### Recommended structure

| Requirement | Workflow | Design | API | Test Case | UAT |
|---|---|---|---|---|---|
| FR-AUTH-001 | Register | Auth Module | POST /api/v1/api/auth/register* | TC-AUTH-001 | UAT-001 |
| FR-UPLOAD-001 | Upload media | Upload Module | POST /api/v1/upload/init* | TC-UPLOAD-001 | UAT-002 |
| FR-TRASH-001 | Move to Trash | Trash/Meeting Module | DELETE /api/v1/meetings/{id}* | TC-TRASH-001 | UAT-003 |

`*` Endpoint minh họa được ghép từ context path và controller mapping hiện rà soát; phải xác minh trên runtime/OpenAPI trước khi phát hành.

### Traceability Flow

```text
Requirement
     ↓
User Workflow
     ↓
Architecture / Design
     ↓
API / Database
     ↓
Test Case
     ↓
UAT
```

Mục tiêu là tránh requirement bị bỏ sót không có testcase.

---

## A2. Glossary

### Recommended structure

| Term | Definition |
|---|---|
| API | Application Programming Interface |
| AI Engine | FastAPI service; document verified endpoints and distinguish planned media processing |
| JWT | JSON Web Token |
| RBAC | Role-Based Access Control; glossary term only, not an assertion that SmartRec implements RBAC |
| UAT | User Acceptance Testing |
| MinIO | Object storage service |
| ChromaDB | Vector database |

Chỉ thêm thuật ngữ nghiệp vụ như WER, DER hoặc transcript nếu tính năng liên quan thuộc scope đã xác nhận.

---

## A3. Changelog

### Recommended structure

| Version | Date | Change | Author |
|---|---|---|---|
| TBD | YYYY-MM-DD | Describe an approved documentation/product change | Name/team |

Đây là format mẫu, không phải lịch sử thay đổi SmartRec đã xác minh.

---

# 12. Recommended Documentation Lifecycle

```text
Product Overview
      |
      v
Functional Requirements <----> Non-Functional Requirements
      |                              |
      +----------> User Workflows <--+
                       |
                       v
              System Architecture
                /      |       \
               v       v        v
          Data Model Security API Reference
                              |
                              v
                       API Workflows
                              |
             +----------------+----------------+
             v                                 v
      Developer Guide                    Test Strategy
                                               |
                                               v
                                      Test Cases / UAT
                                               |
                                               v
                                 Deployment / Operations
                                               |
                                               v
                                   Traceability updates
```

---

# 13. Recommended Priority

Không cần viết tất cả tài liệu cùng lúc.

## Priority 1 — Must Have

```text
00-document-index.md
01-product-overview.md
02-user-guide.md
03-functional-requirements.md
04-non-functional-requirements.md
05-user-workflows.md
06-system-architecture.md
07-data-model.md
09-api-reference.md
12-test-strategy.md
13-test-cases-and-uat.md
14-deployment-and-operations.md
```

API Reference is Must Have because frontend integration, API testing and customer/system integration depend on an accurate request/response contract.

## Priority 2 — Strongly Recommended

```text
08-security-and-privacy.md
10-api-workflows.md
11-developer-guide.md
```

## Priority 3 — Supporting Documentation

```text
appendices/traceability-matrix.md
appendices/glossary.md
appendices/changelog.md
```

User Guide được xếp Must Have khi bộ tài liệu gửi khách hàng bao gồm hướng dẫn sử dụng; có thể hạ ưu tiên nếu lần bàn giao hiện tại chỉ dành cho đội kỹ thuật.

---

# 14. Final Recommended Structure

```text
documents/
│
├── 00-document-index.md
│
├── 01-product-overview.md
├── 02-user-guide.md
│
├── 03-functional-requirements.md
├── 04-non-functional-requirements.md
├── 05-user-workflows.md
│
├── 06-system-architecture.md
├── 07-data-model.md
├── 08-security-and-privacy.md
│
├── 09-api-reference.md
├── 10-api-workflows.md
│
├── 11-developer-guide.md
│
├── 12-test-strategy.md
├── 13-test-cases-and-uat.md
│
├── 14-deployment-and-operations.md
│
└── appendices/
    ├── traceability-matrix.md
    ├── glossary.md
    └── changelog.md
```

## Overall Assessment

This is a **recommended structure and planning checklist**, not evidence that the documents already exist or that all listed features are implemented. Each document should report its actual completion and verification state.

Recommended content coverage:

- Product: Required
- Requirements: Required
- Workflow: Required
- Architecture: Required
- Database: Required
- Security: Required
- API: Required
- Development: Required for engineering handover
- Testing: Required
- UAT: Required for customer acceptance
- Deployment: Required for environment handover
- Traceability: Recommended
- Glossary: Recommended
- Changelog: Recommended

This structure is suitable for SmartRec product and engineering documentation. Any section about AI processing, integrations, security controls, operational targets or deployment guarantees must be supported by verified implementation or clearly marked as planned/TBD. The documentation owner should re-check the source and target environment before each customer release.
