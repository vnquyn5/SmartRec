# Backend - Test Cases

File tong hop danh muc testcase backend. Cac testcase duoc chia theo chuc nang:

| File | Pham vi |
|---|---|
| [BE-auth-user.md](./BE-auth-user.md) | Dang ky, dang nhap, JWT, profile va doi mat khau |
| [BE-meetings-trash.md](./BE-meetings-trash.md) | Meeting, file, download, thung rac va restore |
| [BE-upload.md](./BE-upload.md) | Upload don, presigned URL va chunked upload |
| [BE-jobs.md](./BE-jobs.md) | Purge file het han va xu ly loi job |

## Quy uoc chung

- `API_BASE` la base URL backend theo moi truong; cac path trong testcase tinh tu base URL. README hien tai ghi `http://localhost:8082/api/v1`; xac nhan lai cau hinh moi truong truoc khi test.
- Them JWT cua dung tai khoan cho endpoint can dang nhap.
- Chuan bi it nhat hai tai khoan A/B, meeting/file cua moi tai khoan, PostgreSQL, Redis, MinIO va file media mau `.mp3`, `.mp4`, `.m4a`, `.mkv`.
- Test boundary upload lon can fixture phu hop; khong tao file nhieu GB tren production.
- Backend co JUnit tai `src/test`; bo nay mo rong testcase theo API va luong hien dien trong source, khong phai ket qua chay test.
