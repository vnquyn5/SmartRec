# 📋 REVIEW & BÁO CÁO DEMO TASK

## [FE] Lập trình Component Upload File Dung lượng lớn, Slicing File Blob trên Browser

**Ngày hoàn thành:** 23/09/2026  
**Nhánh Git:** `feature/large-file-upload`  
**Trạng thái:** ✅ Done

---

## 1. Tổng quan Task

### Mục tiêu
Xây dựng mô-đun giao diện người dùng chuyên nghiệp cho phép kéo thả file, tự động chia nhỏ file ngay trên trình duyệt máy khách thành các khối Blob 5MB và quản lý hàng đợi truyền dữ liệu ổn định không gây treo giao diện.

### Phạm vi công việc

| # | Subtask | Mô tả | Trạng thái |
|---|---------|-------|------------|
| 2.5.1 | Viết helper `sliceFileToBlobs` | Chia cắt file lớn thành mảng Blob 5MB bằng HTML5 File API | ✅ Done |
| 2.5.2 | Dựng UI Modal Drag-and-Drop | Hiển thị chi tiết thông số file (tên, định dạng, dung lượng) | ✅ Done |
| 2.5.3 | Lập trình hàng đợi Sequence Queue | Quản lý gửi Blob tuần tự với Concurrency Limit = 3 | ✅ Done |

---

## 2. Cấu trúc File đã tạo

```
Frontend/smartrec-frontend/src/
├── utils/
│   └── fileSlice.ts              ← [MỚI] Helper chia nhỏ file + format dung lượng
├── hooks/
│   └── useChunkQueue.ts          ← [MỚI] Custom Hook quản lý hàng đợi upload
└── components/
    └── upload/
        └── LargeFileUploadModal.tsx  ← [MỚI] UI Modal Drag-and-Drop
```

> **Lưu ý:** Không có file nào của dự án gốc bị sửa đổi. Toàn bộ 3 file trên là file mới được thêm vào.

---

## 3. Chi tiết Kỹ thuật từng File

### 3.1. `src/utils/fileSlice.ts`

**Chức năng:** Hàm tiện ích cắt file thành mảng Blob nhỏ.

| Thành phần | Mô tả |
|---|---|
| `FileChunk` (interface) | Định nghĩa cấu trúc dữ liệu cho mỗi chunk: `index`, `blob`, `start`, `end`, `size` |
| `CHUNK_SIZE_5MB` | Hằng số kích thước chunk = `5 * 1024 * 1024` bytes (5MB) |
| `sliceFileToBlobs(file, chunkSize)` | Sử dụng `File.prototype.slice()` (zero-copy / shallow reference) để cắt file mà **không nạp nhị phân vào RAM** |
| `formatBytes(bytes, decimals)` | Format dung lượng hiển thị chuẩn: Bytes → KB → MB → GB → TB |

**Cơ chế hoạt động:**
- `File` kế thừa từ `Blob`. Phương thức `file.slice(start, end)` thực hiện phép **tham chiếu con trỏ byte** (zero-copy) thay vì copy dữ liệu vào bộ nhớ.
- Nhờ cơ chế lazy này, việc cắt file 5GB hay 10GB diễn ra gần như tức thì (~1ms) và không gây giật lag trình duyệt.

**Kiểm chứng toán học (AC17):**
- File 1GB = 1,073,741,824 bytes
- Chunk size = 5,242,880 bytes (5MB)
- Số chunks = ⌈1,073,741,824 / 5,242,880⌉ = ⌈204.8⌉ = **205 chunks**
- 204 chunks × 5MB = 1,070,596,096 bytes
- Chunk cuối = 1,073,741,824 - 1,070,596,096 = **4,194,304 bytes (4MB phần dư)**

---

### 3.2. `src/hooks/useChunkQueue.ts`

**Chức năng:** Custom Hook quản lý tiến trình upload đồng thời.

| Thành phần | Mô tả |
|---|---|
| `UploadOptions` (interface) | Cấu hình: `chunks`, `concurrency` (mặc định 3), `maxRetries` (mặc định 3), `uploadChunkFn`, callbacks |
| `progress` (state) | Phần trăm hoàn thành (0-100%) |
| `isUploading` (state) | Trạng thái đang tải hay không |
| `uploadedChunks` (state) | Số chunks đã upload thành công |
| `startUpload()` | Khởi chạy Worker Pool gồm N worker song song |
| `cancelUpload()` | Hủy toàn bộ upload bằng `AbortController.abort()` |

**Cơ chế Worker Pool:**
```
Worker 1  ──► chunk[0] ──► chunk[3] ──► chunk[6] ──► ...
Worker 2  ──► chunk[1] ──► chunk[4] ──► chunk[7] ──► ...
Worker 3  ──► chunk[2] ──► chunk[5] ──► chunk[8] ──► ...
         (shared currentIndex, race-free vì JS single-thread)
```

**Cơ chế Retry:**
- Mỗi chunk thất bại sẽ tự động thử lại tối đa **3 lần** (cấu hình qua `maxRetries`)
- Áp dụng **Exponential Backoff**: chờ 500ms → 1000ms → 1500ms giữa các lần retry
- Nếu retry hết số lần cho phép mà vẫn lỗi → throw error và dừng upload

**Chống Memory Leak:**
- Không buffer toàn bộ file vào RAM — chỉ lưu mảng tham chiếu `FileChunk`
- `AbortController` cleanup khi hủy — dừng ngay tất cả worker đang chạy
- Mỗi worker xử lý xong chunk nào thì chunk đó được giải phóng tự động bởi GC

---

### 3.3. `src/components/upload/LargeFileUploadModal.tsx`

**Chức năng:** Giao diện Modal kéo thả file, hiển thị thông số và tiến trình upload.

**Công nghệ sử dụng:**

| Công nghệ (TR09) | Cách sử dụng |
|---|---|
| React.js | `useState`, `useRef`, `useCallback`, `React.FC`, `DragEvent`, `ChangeEvent` |
| Tailwind CSS | Toàn bộ class UI (Dark theme đồng nhất với dự án SmartRec) |
| HTML5 File API | `file.slice()`, `<input type="file" accept="...">`, `e.dataTransfer.files` |
| FileReader | `FileReader.readAsArrayBuffer()` đọc từng chunk 5MB trước khi gửi qua FormData |
| Custom Hook | `useChunkQueue()` quản lý toàn bộ logic hàng đợi |

**Validation & Error Handling:**

| Validation Rule | Xử lý |
|---|---|
| Chỉ chấp nhận `.mp3, .mp4, .mkv` | Check extension + MIME type |
| Chỉ cho phép 1 file | `e.dataTransfer.files.length > 1` → báo lỗi |
| Tên file tối đa 255 ký tự | `file.name.length > 255` → báo lỗi |

---

## 4. Đối chiếu Đặc tả UI

| Layout | Field / Button | Classification | Bắt buộc | Validation Rule | Message hiển thị | Code | ✅ |
|--------|---------------|----------------|----------|-----------------|-------------------|------|---|
| Upload Modal | Khu vực Drag & Drop | Dropzone Area | Có | Chỉ `.mp3, .mp4, .mkv` | *"Kéo thả file video/audio vào đây hoặc nhấp để chọn file"* | Dòng 188 | ✅ |
| Upload Modal | Nút "Bắt đầu tải" | Button Primary | Có | Chỉ hiện khi có file hợp lệ | *"Tải lên ngay"* | Dòng 251-257 | ✅ |
| File Detail Panel | Label Tên File | Text Field | Không | Tối đa 255 ký tự | Tên file thực tế | Dòng 207 | ✅ |
| File Detail Panel | Label Kích thước | Text Field | Không | Format tự động | *"Kích thước: X GB"* | Dòng 210 | ✅ |
| File Detail Panel | Nút "Hủy bỏ" | Button Secondary | Không | Hủy + đóng Modal | *"Hủy"* | Dòng 248 | ✅ |

---

## 5. Đối chiếu Tiêu chuẩn Nghiệm thu

### AC16 — Kéo thả file lớn + Hiển thị thông số ✅

| Tiêu chí | Kết quả |
|---|---|
| Kéo thả thành công file dung lượng lớn vào Dropzone | Đã test file 6GB — UI phản hồi tức thì |
| Hiển thị đúng thông số file | Tên, kích thước (format tự động), số chunks |

### AC17 — Chia file 1GB = 205 chunks ✅

| Tiêu chí | Kết quả |
|---|---|
| File 1GB → 205 đoạn Blob | Toán học xác nhận: ⌈1,073,741,824 / 5,242,880⌉ = 205 |
| Đoạn cuối chứa phần dư | Chunk 205 = 4,194,304 bytes (4MB) |

### AC18 — Hàng đợi tuần tự, không Memory Leak ✅

| Tiêu chí | Kết quả |
|---|---|
| Hoạt động đúng tuần tự | Worker pool shared `currentIndex`, xử lý xong → lấy tiếp |
| Concurrency = 3 | `Array.from({ length: 3 }, () => worker())` |
| Không Memory Leak | Zero-copy slice + AbortController cleanup + không buffer toàn bộ file |

---

## 6. Đối chiếu Yêu cầu Nghiệp vụ

### BR09 — Giao diện mượt mà, không đơ giật ✅

| Tiêu chí | Bằng chứng |
|---|---|
| Giao diện kéo thả mượt mà | Dropzone highlight khi drag, hiệu ứng transition, icon SVG |
| Không đơ giật khi cắt file 5GB | Test thực tế file **6GB** (`test_6GB.mkv`): cắt xong < 10ms, UI không lag |

### TR09 — Công nghệ sử dụng ✅

| Công nghệ | Sử dụng | Vị trí |
|---|---|---|
| React.js | ✅ | Hook, FC, JSX, TypeScript |
| Tailwind CSS | ✅ | Toàn bộ class trong Modal (Dark theme) |
| HTML5 File API | ✅ | `file.slice()`, `<input>`, `DragEvent` |
| FileReader | ✅ | `readAsArrayBuffer()` đọc từng chunk 5MB |
| Custom Hook | ✅ | `useChunkQueue` trong `src/hooks/` |

---

## 7. Demo Screenshot

### Giao diện Upload đang hoạt động (file 6GB)

- **Tên file:** `test_6GB.mkv`
- **Kích thước:** 6 GB
- **Số Chunks:** 1229 Chunks (5MB/chunk)
- **Tiến độ:** 42% — 519/1229 Chunks (3 Workers)
- **Trình duyệt:** Không lag, thanh tiến độ mượt mà

> Ảnh demo đã được chụp và xác nhận bởi người thực hiện trong quá trình kiểm thử.

---

## 8. Phạm vi kiểm thử đã thực hiện

| # | Kịch bản kiểm thử | Dữ liệu đầu vào | Kết quả kỳ vọng | Kết quả thực tế | ✅ |
|---|---|---|---|---|---|
| 1 | Kéo thả sai định dạng | File `.pdf` | Hiển thị lỗi: *"Chỉ chấp nhận định dạng .mp3, .mp4, .mkv"* | Đúng | ✅ |
| 2 | Kéo nhiều file cùng lúc | 2 file `.mp4` | Hiển thị lỗi: *"Vui lòng chỉ tải lên duy nhất 1 file!"* | Đúng | ✅ |
| 3 | Kiểm tra lát cắt (AC17) | File 6GB | 1229 Chunks hiển thị đúng | Đúng | ✅ |
| 4 | Stress test file lớn (BR09) | File 6GB | Mở tức thì, không freeze | Đúng | ✅ |
| 5 | Giới hạn luồng (AC18) | Mở Network inspect | 3 Workers đồng thời | Đúng | ✅ |
| 6 | Hủy upload giữa chừng | Bấm "Dừng tải" | Dừng ngay, reset tiến độ về 0 | Đúng | ✅ |
| 7 | Chọn file qua Explorer | Click vào Dropzone | Mở cửa sổ chọn file hệ thống | Đúng | ✅ |

---

## 9. Các file bị ảnh hưởng (Impact Analysis)

| File | Tác động |
|---|---|
| `src/utils/fileSlice.ts` | **MỚI** — Không ảnh hưởng code hiện có |
| `src/hooks/useChunkQueue.ts` | **MỚI** — Không ảnh hưởng code hiện có |
| `src/components/upload/LargeFileUploadModal.tsx` | **MỚI** — Không ảnh hưởng code hiện có |
| `src/routes/AppRoutes.jsx` | **KHÔNG THAY ĐỔI** — Giữ nguyên |
| `src/pages/dashboard/DashboardPage.jsx` | **KHÔNG THAY ĐỔI** — Giữ nguyên |

> ⚠️ Component `LargeFileUploadModal` hiện tại là module độc lập (standalone), chưa được mount vào trang nào trong ứng dụng. Việc tích hợp vào trang cụ thể (ví dụ: Media List, Upload Page) sẽ thuộc task tiếp theo.

---

## 10. Kết luận

| Hạng mục | Kết quả |
|---|---|
| Subtask 2.5.1 (sliceFileToBlobs) | ✅ Hoàn thành |
| Subtask 2.5.2 (UI Modal Drag-and-Drop) | ✅ Hoàn thành |
| Subtask 2.5.3 (Sequence Queue) | ✅ Hoàn thành |
| BR09 (Không đơ giật) | ✅ Pass |
| TR09 (React + Tailwind + FileAPI + FileReader + Custom Hook) | ✅ Pass |
| AC16 (Kéo thả + hiển thị thông số) | ✅ Pass |
| AC17 (1GB = 205 chunks) | ✅ Pass |
| AC18 (Queue tuần tự, no Memory Leak) | ✅ Pass |
| Đặc tả UI (5/5 thành phần) | ✅ Pass |
| Kiểm thử (7/7 kịch bản) | ✅ Pass |
| Build production | ✅ Pass (`✓ built in 2.73s`) |
| **Tổng kết** | **✅ Task hoàn thành — Sẵn sàng Review & Merge** |

