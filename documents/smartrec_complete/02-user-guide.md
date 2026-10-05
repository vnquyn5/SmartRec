# SmartRec - User Guide

**Trạng thái:** Draft; mô tả thao tác UI hiện thấy trong source, cần smoke test trên bản phát hành.

## 1. Điều kiện sử dụng

- Truy cập URL ứng dụng do quản trị viên cung cấp.
- Có tài khoản hợp lệ; các API ngoại trừ register/login yêu cầu JWT.
- Hỗ trợ media ở backend chunk upload: `.mp3`, `.mp4`, `.m4a`, `.mkv`. Direct upload có validation riêng; kiểm tra UI/API trước khi kết luận danh sách định dạng đồng nhất.

## 2. Đăng ký

1. Mở màn hình Register.
2. Nhập email, số điện thoại, mật khẩu, họ tên theo validation UI.
3. Gửi đăng ký.
4. Khi thành công, chuyển tới màn Login; nếu lỗi, kiểm tra email/phone đã tồn tại và quy tắc nhập liệu.

Backend validation đã thấy trong DTO: password dài 8–16 ký tự, có chữ hoa và ký tự đặc biệt; tên dài 3–30 ký tự, chữ và khoảng trắng; email pattern hiện giới hạn đuôi `.com`; phone theo pattern đầu số Việt Nam. UI có thể có validation khác; nghiệm thu cần kiểm tra hai phía.

## 3. Đăng nhập

1. Nhập email hoặc số điện thoại cùng password.
2. Gửi Login.
3. Khi hợp lệ, backend trả access token và một số thông tin user.
4. Frontend phải đính token dạng `Authorization: Bearer <token>` cho protected API.
5. Token expiry mặc định cấu hình 24 giờ; có thể override qua environment.

Nếu lỗi, kiểm tra thông tin đăng nhập, trạng thái tài khoản và khả năng gọi backend. Tài khoản bị khóa trả lỗi theo nghiệp vụ.

## 4. Hồ sơ

Backend API có endpoint xem hồ sơ, cập nhật hồ sơ và đổi mật khẩu. Vị trí/form validation của giao diện cần kiểm tra trên bản release. Không chia sẻ password hoặc token trong ticket/screenshot.

## 5. Upload media

### Direct upload

Backend cung cấp:
- Multipart `POST /meetings/upload`; hoặc
- Presign `POST /upload/presign`, browser upload trực tiếp tới MinIO bằng URL trả về, sau đó `POST /upload/complete`.

Thực hiện theo UI của phiên bản triển khai. Không tự gửi presigned URL cho người khác; URL có thời hạn.

### Chunk upload

Upload page hiện phân file theo ngưỡng 2 GiB: file nhỏ dùng presigned upload lên MinIO rồi gọi complete; file lớn dùng chunk API thật qua `useLargeUploadStore` và `chunkedUploadService`. Backend chunk session trả về chunk size (hiện 5 MiB); UI giới hạn file tới 5 GiB, tối đa 5 file đơn và 3 file chunk trong queue. Các giới hạn UI/backend/deployment không phải SLA và cần xác nhận khi phát hành.

1. Chọn file; UI kiểm tra extension, dung lượng, duplicate và dung lượng queue.
2. File >2 GiB: UI khởi tạo session, gửi các chunk có MD5, retry có giới hạn và chạy tối đa 3 worker.
3. Với session chunk, có thể pause/cancel; sau khi tải xong, UI gọi merge và poll status. `MERGING` chưa có nghĩa file sẵn sàng.
4. File ≤2 GiB: UI yêu cầu presigned URL, PUT trực tiếp tới MinIO rồi gọi complete.
5. Sau khi hoàn tất, file được thêm vào danh sách meeting/library; refresh để kiểm tra.

Việc khôi phục chunk queue sau refresh có thể yêu cầu chọn lại file cục bộ. Một bộ hook facade cũ (`features/files/useSmartUpload.js` cùng `useChunkUpload.js`) vẫn mô phỏng progress; không nhầm bộ hook legacy đó với đường active UploadPage vừa mô tả. Xác nhận network requests và resume behavior trên bản phát hành.

## 6. Thư viện file

Library API hỗ trợ phân trang, tìm kiếm keyword, lọc meeting status, sort, download đơn, download ZIP, rename và soft-delete. Các thao tác khả dụng phụ thuộc UI phiên bản triển khai.

- Download: tải file attachment.
- Download nhiều file: tải ZIP `smartrec-files.zip`.
- Rename: tên phải hợp lệ và giữ extension được hỗ trợ.
- Delete: chuyển vào Trash; thao tác này không phải xóa vĩnh viễn.

## 7. Trash

1. Mở Trash và tìm file cần thao tác.
2. Restore đưa media trở lại status trước đó (fallback `UPLOADED` nếu status trước không hợp lệ).
3. Permanent delete xóa object trong MinIO trước, sau đó xóa meeting/media metadata.
4. File quá hạn retention có thể bị scheduled purge; giá trị mặc định code là 30 ngày, cấu hình qua `TRASH_RETENTION_DAYS`.

Permanent delete không thể hoàn tác. Xác nhận lựa chọn trước khi thao tác.

## 8. Lỗi thường gặp

| Tình huống | Hướng xử lý |
|---|---|
| Đăng nhập thất bại | Kiểm tra email/phone, password, tài khoản có active không |
| File không hợp lệ | Kiểm tra extension, tên và kích thước theo UI/backend |
| Chunk checksum lỗi | Dừng/retry theo giao diện; ghi lại session ID và thông báo lỗi |
| Upload/MinIO unavailable | Thử lại sau; báo operator nếu lặp lại |
| Merge còn `MERGING` | Chờ và kiểm tra status; không gửi nhiều merge request tùy tiện |
| Không thấy file | Refresh library, kiểm tra upload status; liên hệ hỗ trợ kèm request ID nếu có |
| Không có quyền/file not found | Kiểm tra đang dùng đúng account |

## 9. Hỗ trợ

Khi báo lỗi cung cấp thời điểm, thao tác, endpoint/request ID nếu có, upload session ID và mã lỗi. Không gửi password, access token, secret hoặc presigned URL.

## 10. Màn hình trong thiết kế so với hành vi có bằng chứng

| Màn hình/luồng từ Interface Design | Trạng thái theo source đã rà soát |
|---|---|
| Login/Register, Dashboard, Profile, Upload, Meeting list, Trash, Workspace | Có route/page; kiểm thử release cần xác nhận toàn bộ thao tác/API |
| Forgot Password / OTP, Google OAuth | Có route/page recovery trong UI, nhưng chưa xác minh API/backend flow; OAuth chưa xác nhận |
| Role & Permissions / quản trị người dùng | Nêu trong design; chưa thấy workflow quản trị/RBAC hoàn chỉnh được nối |
| Meeting detail, speaker labels, transcript/summary/task, timestamp review | Trang detail có nội dung/state demo cục bộ; không coi là kết quả AI được xử lý/lưu |
| Batch upload | Upload page có nhiều file/queue; giới hạn theo chiến lược nêu ở mục 5 |
| Workspace sharing, report export, AI actions | Chưa có end-to-end capability được xác nhận; xem target requirements |

Tài liệu này không sao chép dữ liệu cá nhân/định danh trên bìa hay ví dụ trong DOCX nguồn.
