# SmartRec - API Workflows

**Trạng thái:** As-built upload/library sequences plus a clearly separated target AI workflow.

## 1. Common request path

```text
Browser -> base URL + context path (/api/v1)
        -> Spring Security JWT filter
        -> Controller mapping
        -> Service
        -> PostgreSQL / Redis / MinIO
        -> HTTP response -> frontend state/UI
```

Authentication routes are public. Protected endpoints require Bearer token. Error response should be mapped to client UI; exact status/error body is governed by global exception handler.

## 2. Registration/login sequence

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant BE as Spring Boot
    participant DB as PostgreSQL
    User->>FE: Submit credentials/profile
    FE->>BE: POST /api/v1/api/auth/register or /login
    BE->>DB: Lookup/create user
    alt Login success
        BE-->>FE: accessToken + user details
        FE->>FE: Persist token as implemented by client
    else Validation, conflict or credential error
        BE-->>FE: Error response
        FE-->>User: Show error
    end
```

## 3. Direct multipart flow

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant BE as Spring API
    participant MINIO as MinIO
    participant DB as PostgreSQL
    User->>FE: Choose file
    FE->>BE: POST /api/v1/meetings/upload (multipart)
    BE->>BE: Validate file and authenticated owner
    BE->>MINIO: Put object
    BE->>DB: Save MediaFile and Meeting
    BE-->>FE: 201 + upload metadata
    FE-->>User: Show success/update library
```

## 4. Presigned upload flow

```mermaid
sequenceDiagram
    actor User
    participant FE as Browser
    participant API as Spring API
    participant MINIO as MinIO
    participant DB as PostgreSQL
    FE->>API: POST /api/v1/upload/presign
    API-->>FE: uploadUrl + objectKey + expiry
    FE->>MINIO: PUT bytes to presigned URL
    MINIO-->>FE: PUT result
    FE->>API: POST /api/v1/upload/complete
    API->>MINIO: Verify expected key and object size
    API->>DB: Save/reuse MediaFile and Meeting
    API-->>FE: Upload result
```

Presigned URL is sensitive and short-lived. Do not log it or assume browser PUT succeeds until client checks its response.

## 5. Chunk upload and asynchronous merge

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant API as UploadController
    participant SVC as UploadService
    participant PG as PostgreSQL
    participant R as Redis
    participant M as MinIO
    participant W as Async merge service
    FE->>API: POST /upload/init + JWT
    API->>SVC: validate and initialize
    SVC->>PG: persist upload session
    SVC->>R: save upload metadata/state
    API-->>FE: sessionId, chunkSize, totalChunks
    loop Each chunk
        FE->>API: POST /upload/chunk (multipart + MD5)
        API->>SVC: validate session/owner/checksum
        SVC->>M: save tmp chunk
        SVC->>R: mark chunk uploaded
        SVC->>PG: update progress/status
        API-->>FE: chunk accepted or error
    end
    FE->>API: POST /upload/merge
    API->>SVC: verify completeness and prepare job
    API-->>FE: 202 Accepted / MERGING
    SVC->>W: dispatch asynchronous merge
    W->>M: compose final object and verify size
    W->>PG: persist MediaFile + Meeting; mark completed
    W->>R: update session state
    W->>M: attempt temporary chunk cleanup
    loop Until terminal state
        FE->>API: GET /upload/status?uploadSessionId=...
        API->>SVC: load status (Redis/DB fallback as implemented)
        API-->>FE: status and progress
    end
```

Possible terminal outcomes include `COMPLETED`, `MERGE_FAILED`, `FAILED`, or `CANCELLED`. Exact retry behavior should be verified from service state transitions. A response `202` only means accepted/in-progress.

## 6. Library and Trash sequence

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant API as Meeting/Trash Controller
    participant S as Service
    participant DB as PostgreSQL
    participant M as MinIO
    FE->>API: GET /meetings with filters
    API->>S: find meetings for current user
    S->>DB: Query page/status/keyword/sort
    API-->>FE: PageResponse
    alt Download file
        FE->>API: GET /meetings/{id}/download
        API->>S: Verify ownership and load object
        S->>M: Get object stream
        API-->>FE: File attachment
    else Rename
        FE->>API: PATCH /meetings/{id}/name
        S->>DB: Validate ownership/name and update metadata
        API-->>FE: Updated MeetingResponseDTO
    else Soft delete
        FE->>API: DELETE /meetings/{id}
        S->>DB: Set media TRASHED and retention timestamps
        API-->>FE: 204
    end
    FE->>API: GET /media/trash
    API->>DB: Query user's trashed media
    API-->>FE: Trash page
    alt Restore
        FE->>API: POST /media/{id}/restore
        API->>DB: Restore previous media status
        API-->>FE: Restored item
    else Permanent delete
        FE->>API: DELETE /media/{id}/permanent
        API->>M: Delete object
        API->>DB: Delete Meeting and MediaFile
        API-->>FE: 204
    end
```

## 7. Target AI API/workflow (no verified endpoint contract)

The Proposal/URD target implies an API/job contract but does not establish implemented endpoint paths or schemas. The intended sequence is:

```mermaid
sequenceDiagram
    actor User
    participant UI as React UI
    participant API as Spring Boot (target)
    participant DB as PostgreSQL (target)
    participant R as Redis/Celery (target)
    participant AI as AI worker (target)
    User->>UI: Upload media
    UI->>API: Existing upload route(s)
    API->>DB: Persist media + target Job(PENDING)
    API->>R: Enqueue job (contract TBD)
    API-->>UI: Accepted + job identifier (contract TBD)
    R->>AI: Process media
    AI-->>API: Result callback (contract TBD)
    API->>DB: Persist transcript/OCR/summary/task + terminal status
    API-->>UI: Target progress/result push or polling (TBD)
    User->>UI: Review/edit and approve
    UI->>API: Target result CRUD/export APIs (TBD)
```

No AI job submission, callback, WebSocket route, transcript/result CRUD or report export path is cataloged in the as-built API reference. Do not invent URLs or promise compatibility until API design and OpenAPI contracts are approved.

## 8. UI integration evidence checklist

For each release, record page/component → API service/hook → endpoint → observed request/response → tested result. Active UploadPage uses `useSingleUploadStore`/`useLargeUploadStore` and API services in source; legacy `useSmartUpload.js`/`useChunkUpload.js` simulate progress and are not evidence for the active path. Capture runtime evidence separately.
