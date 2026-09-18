# Báo Cáo Công Việc & Kế Hoạch Triển Khai (v1.0)
*(Cập nhật: 17/09/2026)*

## 1. Bối cảnh
Theo yêu cầu thu hẹp phạm vi công việc trong khi chờ mô tả chi tiết của Jira Task, chúng ta hiện tại chỉ tập trung triển khai duy nhất **Luồng Single Upload MinIO** ở phía Frontend. Các tính năng về Auth Context và Axios Interceptor Token sẽ được tạm gác lại.

## 2. Các Task Vừa Hoàn Thành Hôm Nay
Chỉ tập trung vào giao diện và logic kết nối tải file:

**Luồng Single Upload MinIO (Phase P4, P5):**
- **Chuẩn bị kết nối HTTP:** Tạo cấu hình `api` và `storageClient` cơ bản bằng thư viện Axios để sẵn sàng gọi API.
- **Tái cấu trúc UI:** Xóa bỏ thanh Progress Bar "ảo" bằng `setInterval` trong `UploadPage.jsx`.
- **Tạo Custom Hook `useSingleUpload.js`:** Thiết kế đúng Hợp đồng API 3 bước (U2: Presigned URL):
  1. `POST /files/presign`
  2. `PUT` (storageClient bắn thẳng lên MinIO) + Lắng nghe Event `onUploadProgress` của Axios để đo tốc độ thật 100%.
  3. `POST /files/confirm`
- **Logic Upload Tự động:** Khi người dùng chọn file, hệ thống sẽ **tự động gọi API upload**. Tốc độ thanh tiến trình (% hoàn thành) được đo lường thực tế dựa vào: `Tổng kích thước gốc của file` và `Băng thông mạng hiện tại`. Nút "Bắt đầu xử lý" (Tiếp tục) sẽ bị khóa cứng hoàn toàn cho đến khi mạng tải xong (100%).
- **Tính năng Hủy (Cancel Upload):** Cài đặt `AbortController` cho phép người dùng click nút "Hủy" trên giao diện để cắt đứt đường truyền mạng tức thì.
- **Bắt lỗi tự động:** Hiển thị cảnh báo lỗi chuẩn xác ra UI (ví dụ: Tệp vượt quá 5GB hoặc Mất kết nối tới Server) để nâng cao trải nghiệm người dùng, giúp người dùng biết được quá trình đã bị dừng.

## 3. Kịch Bản Kiểm Thử Bằng Frontend (Nghiệm Thu Không Cần Backend)
Dù Backend chưa sẵn sàng, Tester/Leader vẫn có thể tự kiểm chứng Frontend bằng các bước sau:
- **Test Validate Client:** Cố tình chọn 1 file lớn hơn dung lượng cho phép. Giao diện sẽ lập tức hiện lỗi đỏ *"Tệp vượt quá dung lượng"*, hoàn toàn không gọi dư thừa request nào về Backend.
- **Test Request Presign (Hợp đồng API 1):** Chọn 1 file hợp lệ (ví dụ: file `.mp4` 5MB). Mở tab Network (F12). Giao diện sẽ tự động bắn ra 1 request tên `presign`. Kiểm tra tab Payload sẽ thấy Frontend đóng gói đúng chuẩn `{fileName, contentType, size}` như API Contract.
- **Test Error Handling:** Vì Backend tắt, request `presign` sẽ báo lỗi mạng. Giao diện lập tức bắt lỗi đó và hiện khung đỏ *"Lỗi: Không kết nối được tới máy chủ"*, đồng thời khóa nút bấm an toàn.

## 4. Kế hoạch tiếp theo
Toàn bộ logic kết nối Upload của Frontend đã làm xong. Bước tiếp theo phụ thuộc vào thay đổi mô tả của Jira:
- Chờ đội Backend hoàn thiện và mở API cấp Presigned URL và API Confirm.
- Đợi thành viên Jira cập nhật lại chi tiết Description để triển khai tiếp các phần bị tạm dừng (Auth Context & Interceptor).
- Phối hợp với đội Tester khi API sẵn sàng để chạy luồng thông suốt từ đầu đến cuối.
