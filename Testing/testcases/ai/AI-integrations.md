# AI - Celery va integrations

## C. Celery va cac integration client

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| AI-CEL-001 | P1 | Celery app load duoc | Goi task `smartrec.ping` truc tiep | Task tra `"pong"` |
| AI-CEL-002 | P2 | Redis broker/backend duoc cau hinh | Gui task `smartrec.ping` qua worker | Task duoc worker nhan va ket qua la `"pong"` |
| AI-INT-001 | P2 | Cau hinh endpoint MinIO HTTP | Goi `get_minio_client()` | Client duoc tao voi endpoint bo scheme va `secure=False` |
| AI-INT-002 | P2 | Cau hinh endpoint MinIO HTTPS | Goi `get_minio_client()` | Client duoc tao voi endpoint bo scheme va `secure=True` |
| AI-INT-003 | P2 | ChromaDB reachable | Goi `get_chroma_client()` va thuc hien ping/query neu duoc expose trong harness | HttpClient dung host/port tu settings; loi ket noi duoc ghi nhan ro |
| AI-INT-004 | P2 | Set env `APP_NAME`, Redis/MinIO/Chroma settings | Khoi dong app/module | Settings doc gia tri moi; gia tri khong override dung default khai bao |
