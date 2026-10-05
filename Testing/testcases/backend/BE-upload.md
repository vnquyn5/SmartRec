# Backend - Upload

## E. Upload file don va presigned URL

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| BE-UP-001 | P1 | Token A; MinIO san sang; file media hop le | POST `/meetings/upload` multipart voi file va title tuy chon | HTTP 201; file len MinIO va media/meeting record duoc tao |
| BE-UP-002 | P1 | Token A | Upload file rong, null/khong ten hoac lon hon gioi han 2 GiB | Request bi validation tu choi; khong tao record/object thanh cong |
| BE-UP-003 | P1 | Token A | POST `/upload/presign` voi fileName, fileSize duong va mimeType hop le | HTTP 200; tra URL, objectKey va thoi han 1200 giay |
| BE-UP-004 | P1 | Token A | Presign voi metadata bat buoc rong, size null/khong duong hoac MIME/extension khong ho tro | Validation/upload metadata bi tu choi; khong cap URL su dung duoc |
| BE-UP-005 | P1 | Token A; MinIO tam dung | Goi presign va multipart upload truc tiep | Loi dich vu MinIO duoc tra ro rang; khong tra ket qua thanh cong |
| BE-UP-006 | P1 | Token A; presign va PUT object thanh cong, kich thuoc dung | POST `/upload/complete` dung objectKey/metadata | HTTP 200; media va meeting record duoc tao |
| BE-UP-007 | P1 | Token A; object da duoc PUT | Complete voi objectKey khong thuoc user/filename hien tai | Tu choi voi `INVALID_OBJECT_KEY`; khong ghi nhan object |
| BE-UP-008 | P1 | Token A; object khong ton tai tren MinIO | Complete metadata hop le | Tu choi voi `OBJECT_NOT_FOUND` |
| BE-UP-009 | P1 | Token A; object ton tai | Complete voi `fileSize` khac kich thuoc object | Tu choi voi `OBJECT_SIZE_MISMATCH`; khong tao record |
| BE-UP-010 | P1 | Token A; complete da thanh cong | Gui lai dung request complete | Tra lai record da tao (idempotent); khong tao duplicate media/meeting |
| BE-UP-011 | P1 | Token B; object cua A | B complete voi objectKey cua A | Tu choi truy cap; khong lien ket file vao tai khoan B |
| BE-UP-012 | P1 | Token A; MinIO khong kha dung | Upload multipart hoac complete/presign khi can thao tac MinIO | Loi dich vu duoc bao; khong tra thanh cong gia |
| BE-UP-013 | P1 | Token A; MinIO san sang | Upload/presign file co extension hop le, dung chinh xac 2 GiB | Metadata duoc chap nhan theo gioi han toi da 2 GiB |
| BE-UP-014 | P1 | Token A | Upload/presign file tren 2 GiB, file size <=0, extension khong phai mp3/mp4/m4a/mkv | Tu choi voi loi gioi han/kieu file; khong tao object hay record |
| BE-UP-015 | P2 | Token A; filename co dau cach, path separator hoac ky tu dac biet nhung extension media hop le | Upload file | Object key va filename duoc sanitize; khong tao path traversal; file van nam trong namespace user/thang-nam |
| BE-UP-016 | P2 | Token A; mimeType bi thieu | Presign/complete file metadata hop le khac | MIME duoc normalize thanh `application/octet-stream` |

## F. Chunked upload

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| BE-CHUNK-001 | P1 | Token A | POST `/upload/init` voi ten `.mp3/.mp4/.m4a/.mkv`, fileSize >0, totalChunks >0 | HTTP 200; tra session ID, chunk size 5 MiB, totalChunks va status `INITIATED` |
| BE-CHUNK-002 | P1 | Token A | Init voi ten rong, extension khong ho tro, size null/<=0, totalChunks null/<=0 | Bi tu choi voi loi validation/business code tuong ung; khong tao session hop le |
| BE-CHUNK-003 | P1 | Token A; DB khong luu duoc session | Init upload | Loi `UPLOAD_SESSION_DB_SAVE_FAILED`; khong tra session thanh cong |
| BE-CHUNK-004 | P1 | Token A; session `INITIATED` va Redis hoat dong | Gui chunk co session ID, index hop le, file va checksum MD5 dung | Chunk duoc ghi nhan; response thong bao index/session hop le |
| BE-CHUNK-005 | P1 | Token A; session hop le | Gui chunk voi checksum sai | Chunk bi tu choi; khong danh dau la chunk da upload |
| BE-CHUNK-006 | P1 | Token A; session hop le | Gui lai cung chunk index dung checksum | Khong lam tang so chunk da nhan hai lan; phan hoi phu hop chunk da nhan |
| BE-CHUNK-007 | P1 | Token A; session hop le | Gui chunk index am/ngoai totalChunks, session khong ton tai, file chunk rong | Request bi tu choi; trang thai session khong bi danh dau hoan tat |
| BE-CHUNK-008 | P1 | Token A; session dang upload | POST `/upload/pause` | HTTP 204; session tam dung; chunk/merge tiep theo tuan theo state machine cua service |
| BE-CHUNK-009 | P1 | Token A; session dang pause | POST `/upload/resume` | HTTP 204; session tiep tuc nhan chunk |
| BE-CHUNK-010 | P1 | Token A; session hop le, co the dang pause | POST `/upload/cancel` | HTTP 204; session bi huy va khong the merge thanh cong |
| BE-CHUNK-011 | P1 | Token A; session con thieu chunk | POST `/upload/merge` | Khong tao file hoan chinh; response/error phan anh cac chunk con thieu |
| BE-CHUNK-012 | P1 | Token A; da upload du tat ca chunk hop le | POST `/upload/merge` | Tra status dang merge/da merge theo xu ly service; file ghép dung thu tu va record duoc tao khi hoan tat |
| BE-CHUNK-013 | P1 | Token A; merge co the chay async | GET `/upload/status?uploadSessionId=...` trong qua trinh va sau merge | Tra dung session/status/receivedChunks/totalChunks; missingChunks phan anh chunk thieu neu co |
| BE-CHUNK-014 | P1 | Token B; session cua A | B upload chunk, pause/resume/cancel/status/merge voi session ID cua A | Request bi tu choi/khong lo thong tin session; session cua A khong bi thay doi |
| BE-CHUNK-015 | P2 | Token A; session da cancel/merge hoan tat | Thu gui chunk hoac merge lai sau terminal state | Service khong tao file hoan chinh bi lap; terminal-state behavior duoc ghi nhan theo response hien thuc |
| BE-CHUNK-016 | P1 | Token A; upload dang thuc hien | Ngat ket noi Redis/MinIO/DB tai tung buoc chunk/merge | Loi duoc bao ro; status khong bao da hoan tat neu merge/ghi du lieu that bai |
