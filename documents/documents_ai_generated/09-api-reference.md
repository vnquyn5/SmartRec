# SmartRec - API Reference

**Trạng thái:** Source-derived API inventory; response contracts must be checked against generated OpenAPI/runtime before external integration.

## 1. Base URL and authentication

Backend config sets `server.port: 8082` and `server.servlet.context-path: /api/v1`. For local default, context base is `http://localhost:8082/api/v1`. A controller mapping is appended to that base. For example, mapping `/api/auth/login` yields `/api/v1/api/auth/login`; verify actual deployment and Swagger/OpenAPI.

Protected APIs use:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Register/login are public by Spring Security configuration. Remaining requests require authentication.

## 2. API catalog

| Method | Controller mapping | Full local path pattern | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/auth/register` | `/api/v1/api/auth/register` | No | Create user |
| POST | `/api/auth/login` | `/api/v1/api/auth/login` | No | Login and issue token |
| GET | `/api/user/me` | `/api/v1/api/user/me` | Yes | Current profile |
| PUT | `/api/user/me` | `/api/v1/api/user/me` | Yes | Update profile |
| PUT | `/api/user/change-password` | `/api/v1/api/user/change-password` | Yes | Change password |
| POST | `/meetings/upload` | `/api/v1/meetings/upload` | Yes | Multipart direct upload |
| GET | `/meetings` | `/api/v1/meetings` | Yes | List meetings |
| DELETE | `/meetings/{id}` | `/api/v1/meetings/{id}` | Yes | Soft-delete meeting |
| GET | `/meetings/{id}/download` | `/api/v1/meetings/{id}/download` | Yes | Download media stream |
| POST | `/meetings/download` | `/api/v1/meetings/download` | Yes | Download selected IDs as ZIP |
| PATCH | `/meetings/{id}/name` | `/api/v1/meetings/{id}/name` | Yes | Rename |
| POST | `/upload/presign` | `/api/v1/upload/presign` | Yes | Create presigned PUT |
| POST | `/upload/complete` | `/api/v1/upload/complete` | Yes | Complete direct upload |
| POST | `/upload/init` | `/api/v1/upload/init` | Yes | Start chunk session |
| POST | `/upload/chunk` | `/api/v1/upload/chunk` | Yes | Send one multipart chunk |
| POST | `/upload/merge` | `/api/v1/upload/merge` | Yes | Start async merge |
| GET | `/upload/status` | `/api/v1/upload/status` | Yes | Read upload status |
| POST | `/upload/pause` | `/api/v1/upload/pause` | Yes | Pause session |
| POST | `/upload/resume` | `/api/v1/upload/resume` | Yes | Resume session |
| POST | `/upload/cancel` | `/api/v1/upload/cancel` | Yes | Cancel session |
| GET | `/media/trash` | `/api/v1/media/trash` | Yes | List Trash |
| DELETE | `/media/{id}` | `/api/v1/media/{id}` | Yes | Move media to Trash |
| POST | `/media/{id}/restore` | `/api/v1/media/{id}/restore` | Yes | Restore media |
| DELETE | `/media/{id}/permanent` | `/api/v1/media/{id}/permanent` | Yes | Permanent delete |

FastAPI AI Engine exposes `GET /` and `GET /health` on its own service (Compose port 8000); these are health endpoints, not media-processing APIs.

## 3. Auth request/response

### Register

`POST /api/auth/register`

```json
{
  "email": "user@example.com",
  "phone": "0901234567",
  "passWord": "Example!1",
  "full_name": "Example User"
}
```

Validation from DTO: email `.com` pattern; phone pattern `0(3|5|7|8|9)` + 8 digits; password 8–16 chars, at least one uppercase and one special character; full name 3–30 letters/spaces. Success: `201 Created`, string response. Duplicate email/phone: conflict business error.

### Login

`POST /api/auth/login`

```json
{
  "email": "user@example.com",
  "passWord": "Example!1"
}
```

Login identifier field `email` accepts email or phone format. Success `200 OK` with fields `message`, `accessToken`, `userId`, `email`, `fullName`.

## 4. User APIs

- `GET /api/user/me`: current profile response DTO.
- `PUT /api/user/me`: body defined by `UpdateUserProfileRequest`.
- `PUT /api/user/change-password`: body defined by `ChangePassWordRequest`, success string.

See source DTOs/OpenAPI for exact fields and validation; do not guess missing fields in integration.

## 5. Direct upload APIs

### Multipart

`POST /meetings/upload`, `multipart/form-data`: `file` (required) and `title` (optional). Service max is 2 GiB, stores in MinIO and creates media/meeting records. Success `201 Created`.

### Presign and complete

`POST /upload/presign` JSON:

```json
{"fileName":"clip.mp4","fileSize":123456,"mimeType":"video/mp4"}
```

Returns `uploadUrl`, `objectKey`, `expiresInSeconds` (20 minutes in service).

Client PUTs bytes directly to the returned URL, then sends:

```json
{
  "objectKey": "returned-key",
  "fileName": "clip.mp4",
  "fileSize": 123456,
  "mimeType": "video/mp4",
  "title": "Optional title"
}
```

to `POST /upload/complete`. Service checks key belongs to current user's expected upload path and checks object size. Exact permitted MIME/extension/size validation should be read from `FileServiceImpl` and confirmed for release.

## 6. Chunk upload APIs

### Init

`POST /upload/init`:

```json
{"fileName":"clip.mp4","fileSize":123456789,"totalChunks":24}
```

Success response: `uploadSessionId`, `chunkSize` (backend constant 5 MiB), `totalChunks`, `status` (`INITIATED`).

### Upload one chunk

`POST /upload/chunk`, `multipart/form-data`:
- `uploadSessionId`: string UUID
- `chunkIndex`: integer (zero-based behavior should be confirmed in caller)
- `checksumMD5`: client MD5
- `file`: bytes

Chunk response includes session ID, index, status and message/object key. Backend calculates MD5 and rejects mismatch.

### Merge

`POST /upload/merge` JSON:

```json
{"uploadSessionId":"<uuid>","fileName":"clip.mp4"}
```

When accepted for async merge, controller returns `202 Accepted` with status `MERGING`. Completion must be queried; do not treat 202 as completed.

### Status and controls

- `GET /upload/status?uploadSessionId=<uuid>` returns `uploadSessionId`, `status`, `receivedChunks`, `totalChunks`, `missingChunks`.
- `POST /upload/pause?uploadSessionId=<uuid>`
- `POST /upload/resume?uploadSessionId=<uuid>`
- `POST /upload/cancel?uploadSessionId=<uuid>`

Controls return `204 No Content` in controller. Access ownership and exact allowed state transitions are enforced by service.

## 7. Meeting and Trash APIs

### List meetings

`GET /meetings?page=0&size=20&status=PENDING&keyword=weekly&sort=created_at,desc`

Page defaults 0/20, size maximum 100. Status values: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`. Response shape: `content`, `page`, `size`, `totalElements`, `totalPages`; meeting item fields include id/title/status/mediaFileId/fileName/mimeType/fileSizeBytes/durationSeconds/createdAt/updatedAt. Sort allowlist is service-defined; validate against `MeetingServiceImpl`.

### Download / rename / delete

- `GET /meetings/{id}/download`: binary attachment stream.
- `POST /meetings/download`: JSON array of meeting UUIDs; returns ZIP. Empty selection rejected.
- `PATCH /meetings/{id}/name`: JSON DTO `RenameFileRequest`; exact field is `fileName`. Filename validation is service-enforced.
- `DELETE /meetings/{id}`: soft-delete media; `204`.

### Trash

- `GET /media/trash?page=0&size=20&keyword=clip&sort=deleted_at,desc`
- `DELETE /media/{mediaFileId}`: move to Trash; returns trash item.
- `POST /media/{mediaFileId}/restore`: returns restored item.
- `DELETE /media/{mediaFileId}/permanent`: permanent deletion; `204`.

## 8. Error contract

Global error DTO fields are `code`, `message`, `detail` (list), `timestamp`; actual HTTP status/code depends on exception handler. Common service codes include invalid filename/type/size, invalid pagination/sort, session missing, checksum mismatch, MinIO unavailable, ownership/not-found and conflict states. Treat response details as implementation contracts and verify by integration tests.

## 9. API publication checklist

- Generate/inspect OpenAPI at runtime and ensure path prefix is accurate.
- Confirm examples and required fields from DTOs and validation annotations.
- Record endpoint security, ownership behavior, limits and status transitions.
- Never publish real JWTs, credentials, object keys if sensitive, or presigned URLs.
- Version API contract and test compatibility before customer integration.
