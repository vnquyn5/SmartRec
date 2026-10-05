# AI - HTTP health

## A. HTTP health

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| AI-HTTP-001 | P1 | AI Engine dang chay | GET `/` | HTTP 200; JSON co `service` theo setting `app_name` va `status: UP` |
| AI-HTTP-002 | P1 | AI Engine dang chay va FFmpeg co trong PATH | GET `/health` | HTTP 200; JSON co `service`, `status: UP` va dong version FFmpeg |
| AI-HTTP-003 | P1 | AI Engine dang chay nhung FFmpeg khong co trong PATH/khong chay duoc | GET `/health` | Health request that bai thay vi bao health thanh cong khi khong doc duoc version |
