# Báo Cáo Công Việc: Tối Ưu Hóa & Sửa Lỗi Tính Năng Tải Lên File Lớn (SmartUpload)

**Thời gian:** 18/09/2026
**Mục tiêu:** Cải thiện và sửa lỗi UI/UX cho tính năng tải lên (upload) file ghi âm/ghi hình có kích thước lớn (> 5GB).

## 1. Tạo Dummy File Dung Lượng Lớn Không Gây Lag Máy
- **Vấn đề:** Khi tạo các file ảo dung lượng khổng lồ (5GB, 6GB) với định dạng media (`.mp3`, `.mp4`, `.mkv`), hệ điều hành (Windows Explorer) tự động quét file để tìm metadata/thumbnail dẫn đến tình trạng treo máy 100% CPU/Disk.
- **Giải pháp:** Sử dụng công cụ lệnh `fsutil` của hệ thống để tạo file ảo tức thời (`fsutil file createnew`) vào một thư mục riêng biệt không mở bằng File Explorer. Hướng dẫn sử dụng file thông qua thanh địa chỉ (Address Bar) của trình duyệt để bypass việc quét metadata của Windows.

## 2. Đồng Bộ Hóa Đơn Vị Hiển Thị Dung Lượng File
- **Vấn đề:** UI hiển thị `5120.0 MB` thay vì `5 GB` gây hiểu lầm cho người dùng (mặc dù chuẩn xác về mặt nhị phân 5 * 1024 = 5120 MB).
- **Giải pháp:** Viết lại logic định dạng dung lượng trên file `UploadPage.jsx`. Thêm hàm `formatBytes` linh hoạt để tự động quy đổi byte sang định dạng tối ưu nhất (KB, MB, GB). Kết quả: Dung lượng được hiển thị ngắn gọn, thân thiện (VD: hiển thị `5 GB` thay vì `5120 MB`).

## 3. Sửa Lỗi "Kẹt" Thanh Tiến Trình (State Caching Bug)
- **Vấn đề:** Khi người dùng vừa upload xong một file hợp lệ (thanh tiến trình 100%), nếu tiếp tục chọn một file quá giới hạn 5GB (như file 6GB), tiến trình bị chặn sớm (ném lỗi Exception). Do quá trình dừng quá nhanh, State của React bị kẹt lại, UI vẫn hiện thanh tiến trình xanh 100% và nhãn chiến lược cũ (SINGLE/CHUNKED).
- **Giải pháp:** 
  - Khởi tạo hàm `reset()` xuyên suốt chuỗi Custom Hooks (`useSmartUpload`, `useSingleUpload`, `useChunkUpload`).
  - Gọi `reset()` ngay từ vòng đời đầu tiên (khi người dùng kích hoạt sự kiện `onChange` lúc chọn file) để dọn dẹp sạch sẽ toàn bộ State cũ (đưa progress về 0, clear thông báo cũ, reset strategy).

## 4. Cải Thiện UX Báo Lỗi Khối Lượng File
- **Vấn đề:** Khi bị chặn tải lên do dung lượng > 5GB, UI chỉ thông báo chung chung là "Xử lý tải lên thất bại" hoặc không hiện rõ ràng lý do.
- **Giải pháp:** 
  - Đẩy trạng thái `error` ra ngoài UI một cách triệt để thông qua hàm `setError` của `useSingleUpload`.
  - Cấu trúc lại giao diện thanh tiến trình trong `UploadPage.jsx`: Khi trạng thái là `error`, ẩn các thông số không cần thiết (như 0%, 0 Byte) và chuyển toàn bộ thanh tiến trình sang màu đỏ.
  - Tự động bắt lại dung lượng thực tế của file bị từ chối và in ra cảnh báo chi tiết: *"Từ chối xử lý: File tải lên có dung lượng X.XX GB. Hệ thống chỉ hỗ trợ tối đa 5 GB!"*.

---
**Các file đã chỉnh sửa trong luồng công việc này:**
- `src/pages/upload/UploadPage.jsx`
- `src/features/files/useSmartUpload.js`
- `src/features/files/useSingleUpload.js`
- `src/features/files/useChunkUpload.js`
