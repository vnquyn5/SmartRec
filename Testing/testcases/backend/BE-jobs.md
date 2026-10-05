# Backend - Jobs va cleanup

## G. Job va cleanup theo lich

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| BE-JOB-001 | P1 | Co file TRASHED qua han purge va scheduler duoc bat | Chay `TrashPurgeScheduler.purgeExpiredTrash()` | Object MinIO, meeting (neu co) va media record het han duoc xoa |
| BE-JOB-002 | P1 | Co file TRASHED chua den han purge | Chay job purge | File chua het han duoc giu lai |
| BE-JOB-003 | P1 | Co nhieu file het han; MinIO loi voi mot object | Chay job purge | File bi loi MinIO duoc log; cac file het han khac van duoc xu ly; record loi khong bi xoa khoi DB |
