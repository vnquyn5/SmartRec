# SmartRec - User Workflows

**Trạng thái:** User journeys theo chức năng backend; frontend integration cần xác minh release-by-release.

## 1. Hành trình tổng thể

```mermaid
flowchart TD
    A[Mở SmartRec] --> B{Đã có tài khoản?}
    B -- Chưa --> C[Đăng ký]
    C --> D{Đăng ký hợp lệ?}
    D -- Không --> C1[Hiển thị lỗi và sửa thông tin]
    C1 --> C
    D -- Có --> E[Đăng nhập]
    B -- Có --> E
    E --> F{Credential hợp lệ và account active?}
    F -- Không --> E1[Hiển thị lỗi]
    E1 --> E
    F -- Có --> G[Dashboard]
    G --> H{Chọn tác vụ}
    H --> I[Upload media]
    H --> J[Thư viện]
    H --> K[Trash]
    H --> L[Profile]
    I --> M[File được lưu và metadata được tạo]
    M --> J
    J --> N[Tải / ZIP / rename / chuyển Trash]
    N --> K
    K --> O[Restore hoặc permanent delete]
    O -- Restore --> J
    L --> G
```

## 2. Register/Login

```mermaid
sequenceDiagram
    actor User
    participant UI as Frontend
    participant API as Spring Boot
    participant DB as PostgreSQL
    User->>UI: Điền register/login form
    UI->>API: POST register hoặc login
    API->>DB: Tìm user / lưu registration
    DB-->>API: Kết quả
    alt Login thành công
        API-->>UI: accessToken + profile fields
        UI->>UI: Lưu token theo triển khai frontend
    else Validation/credential failure
        API-->>UI: Error response
        UI-->>User: Hiển thị lỗi
    end
```

Register/login controller mapping có prefix `/api/auth`; full path phụ thuộc context path `/api/v1`, do đó thường là `/api/v1/api/auth/...`. Xác nhận bằng OpenAPI/runtime.

## 3. Upload trực tiếp

Có hai API khả năng direct upload:

```text
Multipart:
User -> chọn file -> POST /meetings/upload (multipart)
     -> validate -> MinIO object put -> save MediaFile + Meeting
     -> response metadata -> refresh library

Presigned:
User -> chọn file -> POST /upload/presign
     -> receive presigned URL + objectKey
     -> browser PUT to MinIO
     -> POST /upload/complete
     -> backend verify object/size/key -> save metadata
     -> refresh library
```

UI nào dùng nhánh nào phải kiểm tra trên component/service của release cụ thể.

## 4. Upload theo chunk (backend workflow; UI cần xác minh)

```mermaid
flowchart TD
    A[Chọn media] --> B[POST /upload/init]
    B --> C[Nhận sessionId và chunk configuration]
    C --> D[Chia file và tính MD5]
    D --> E[POST /upload/chunk lặp từng part]
    E --> F{Chunk accepted?}
    F -- Checksum/error --> X[Hiển thị lỗi; kiểm tra session]
    F -- Có --> G[Tiến độ cập nhật Redis/PostgreSQL]
    G --> H{Đủ chunks?}
    H -- Chưa --> I{Pause/resume/cancel/status?}
    I -- Status --> E
    I -- Pause --> P[POST /upload/pause]
    P --> R{Resume hay cancel?}
    R -- Resume --> S[POST /upload/resume]
    S --> E
    R -- Cancel --> CXL[POST /upload/cancel]
    I -- Tiếp tục --> E
    H -- Đủ --> J[POST /upload/merge]
    J --> K[202 MERGING]
    K --> L[Async compose object]
    L --> M[GET /upload/status poll]
    M --> N{Final status}
    N -- MERGING --> M
    N -- COMPLETED --> O[GET /meetings và hiển thị file]
    N -- MERGE_FAILED --> X
```

`useChunkUpload.js` hiện được rà soát là mock. Trên UI thực tế không cam kết workflow này hoạt động tới khi API wiring được nghiệm thu.

## 5. Library actions

- **List/search/filter:** user mở library, query có pagination/status/keyword/sort; server giới hạn page size tối đa 100.
- **Download:** backend kiểm tra tài nguyên theo user, stream object từ MinIO.
- **ZIP:** user gửi danh sách UUID; backend stream archive; selection rỗng bị từ chối.
- **Rename:** backend validate tên; hiện chấp nhận filename ký tự chữ/số/dot/underscore/hyphen và extension media được hỗ trợ.
- **Move to Trash:** soft-delete metadata; object vẫn ở MinIO cho tới permanent delete/purge.

## 6. Trash lifecycle

```text
Library -> soft-delete -> TRASHED
Trash -> restore -> previous status (fallback UPLOADED)
Trash -> permanent delete -> remove object from MinIO -> delete meeting/media rows
Retention expires -> scheduled purge attempts same object + metadata deletion
```

Purge schedule và retention do environment/config quyết định. Permanent delete không thể hoàn tác.

## 7. Profile actions

Backend API: `GET /api/user/me`, `PUT /api/user/me`, `PUT /api/user/change-password` (cộng context path). Profile page tồn tại trong frontend; endpoint wiring/validation cần xác minh trước user manual release.

## 8. Chưa phải user workflow

AI transcription/summary/NLP/vision/semantic search không đưa vào workflow hiện hành cho tới khi xác nhận API/task dispatch, status/persistence, quyền truy cập kết quả và UI.
