# Frontend - Upload

## D. Upload single/chunked

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| FE-UP-001 | P1 | Dang nhap; mo upload page | Chon file co kich thuoc nho hon 2 GiB | Chien luoc `single`; upload chay qua presign/PUT/complete va hien trang thai/progress |
| FE-UP-002 | P1 | Dang nhap; file co kich thuoc dung chinh xac 2 GiB | Bat dau upload | Theo dieu kien `file.size > 2 GiB`, chon `single`, khong chunk |
| FE-UP-003 | P1 | Dang nhap; file lon hon 2 GiB | Bat dau upload | Chien luoc `chunk`; hien thong bao chuyen chunked va thong tin chunk |
| FE-UP-004 | P1 | Co file fixture kich thuoc bat ky | Kiem tra chia chunk voi file rong, nho hon 5 MiB, dung 5 MiB, 5 MiB + 1 byte | Chunk co start/end/index lien tuc; chunk cuoi co kich thuoc con lai; file rong tao danh sach rong |
| FE-UP-005 | P1 | File duoc chon | Huy upload single truoc khi hoan tat | Request bi abort/reset; khong hien success sau khi huy |
| FE-UP-006 | P1 | File duoc chon; backend tu choi presign/complete | Upload single | Hien error state/message; khong hien upload thanh cong |
| FE-UP-007 | P1 | File lon; upload dang chay | Pause, resume va cancel upload | Trang thai UI va request API tuan theo hanh dong; cancel khong tiep tuc merge |
| FE-UP-008 | P1 | File lon; chunk upload dang chay | Ngat mang mot chunk, sau do retry/resume theo UI | Loi duoc hien ro; chunk khong duoc tinh uploaded neu server tu choi |
| FE-UP-009 | P2 | Dung formatBytes/formatTime | Kiem tra 0 byte, KB/MB/GB; 0/null/finite seconds va thoi luong >1 gio | Hien don vi va dinh dang `mm:ss`/`HH:mm:ss` dung |
| FE-UP-010 | P2 | Trinh duyet ho tro media metadata | Chon media doc duoc va file khong doc duoc | Duration media hop le duoc lay; loi metadata tra duration 0 theo implementation hien tai |
