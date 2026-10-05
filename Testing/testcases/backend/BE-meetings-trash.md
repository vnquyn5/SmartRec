# Backend - Meetings va trash

## C. Meeting va file

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| BE-MTG-001 | P1 | Token A; A co nhieu meeting | GET `/meetings` khong truyen filter | Tra page mac dinh, records chi thuoc A; metadata trang khop content |
| BE-MTG-002 | P1 | Token A; co meeting o nhieu trang | Goi `/meetings?page=0&size=1`, tiep tuc trang ke | Moi trang khong vuot size; pageNumber/totalElements/totalPages nhat quan |
| BE-MTG-003 | P1 | Token A; co meeting voi nhieu status/ten | Loc theo status va keyword, sau do keyword co khoang trang dau/cuoi | Ket qua khop filter; keyword duoc trim; keyword rong duoc xu ly nhu khong loc |
| BE-MTG-004 | P1 | Token A | Goi list voi page am, size 0, size >100; thu status/sort khong hop le | Pagination sai bi tu choi voi `INVALID_PAGINATION`; status/sort sai duoc xu ly theo quy tac parse cua service, khong lam lo meeting tai khoan khac |
| BE-MTG-005 | P1 | Token A; meeting/file dang hoat dong thuoc A | PATCH `/meetings/{id}/name` voi ten hop le co duoi `.mp3`, `.mp4`, `.m4a` hoac `.mkv` | HTTP 200; ten file duoc cap nhat va tra ve |
| BE-MTG-006 | P1 | Token A; meeting thuoc A | Rename voi ten rong, >500 ky tu, co dau cach/ky tu ngoai `[A-Za-z0-9._-]`, hoac duoi khong ho tro | Tu choi voi `INVALID_FILENAME`; ten cu khong doi |
| BE-MTG-007 | P1 | Token A; meeting thuoc A va media chua o trash | DELETE `/meetings/{id}` | HTTP 204; media duoc chuyen sang `TRASHED`, co deletedAt/purgeAt/deletedBy; object van con trong MinIO |
| BE-MTG-008 | P1 | Token A; meeting da o trash | DELETE lai meeting do | Request bi tu choi voi `MEDIA_ALREADY_TRASHED`; khong tao thay doi moi |
| BE-MTG-009 | P1 | Token B; meeting thuoc A | B goi download, rename hoac delete meeting cua A | Request bi tu choi nhu khong tim thay/khong co quyen; khong doc, sua hay xoa file |
| BE-MTG-010 | P1 | Token A; meeting va object con ton tai trong MinIO | GET `/meetings/{id}/download` | HTTP 200; content la dung bytes file, Content-Disposition co filename; MIME/Content-Length duoc tra khi co metadata |
| BE-MTG-011 | P1 | Token A; meeting thuoc A | Download id khong ton tai hoac object MinIO khong doc duoc | Request that bai ro rang; khong tra file thanh cong gia |
| BE-MTG-012 | P1 | Token A; co it nhat 2 meeting, co the co ten file trung | POST `/meetings/download` voi danh sach ID | HTTP 200, content-type ZIP; archive co dung cac file duoc chon va ten entry trung duoc tao duy nhat |
| BE-MTG-013 | P1 | Token A | POST `/meetings/download` voi danh sach rong/null hoac ID khong thuoc A | Selection rong bi tu choi `EMPTY_DOWNLOAD_SELECTION`; ID khong co quyen khong duoc tai |
| BE-MTG-014 | P2 | Token A; meeting co media | Download/ZIP voi media nam trong trash | File trong trash khong duoc xem/tai qua meeting; response loi theo service |

## D. Thung rac

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| BE-TRASH-001 | P1 | Token A; A co file trong trash | GET `/media/trash` | Chi tra file trash cua A; co metadata phan trang |
| BE-TRASH-002 | P1 | Token A; co file trash nhieu trang | Goi trash voi page/size hop le, keyword khop va keyword co whitespace | Pagination dung; tim kiem theo keyword; keyword duoc trim |
| BE-TRASH-003 | P1 | Token A | Goi trash voi page am, size 0 hoac size >100 | Bi tu choi voi `INVALID_PAGINATION` |
| BE-TRASH-004 | P1 | Token A; file active cua A | DELETE `/media/{id}` | HTTP 200; status chuyen `TRASHED`, luu previous status va han purge theo retention-days |
| BE-TRASH-005 | P1 | Token A; file da trong trash | DELETE lai `/media/{id}` | Bi tu choi voi `MEDIA_ALREADY_TRASHED` |
| BE-TRASH-006 | P1 | Token A; file trong trash va previous status hop le | POST `/media/{id}/restore` | HTTP 200; status duoc khoi phuc; cac truong deletedAt/purgeAt/deletedBy/previousStatus duoc xoa |
| BE-TRASH-007 | P1 | Token A; file active | Restore file khong nam trong trash | Bi tu choi voi `MEDIA_NOT_IN_TRASH` |
| BE-TRASH-008 | P1 | Token A; file trong trash | DELETE `/media/{id}/permanent` | HTTP 204; object MinIO, meeting lien quan va media record duoc xoa |
| BE-TRASH-009 | P1 | Token A; file active | Xoa vinh vien file chua vao trash | Bi tu choi voi `MEDIA_NOT_IN_TRASH`; object/record van con |
| BE-TRASH-010 | P1 | Token B; file thuoc A | B move/restore/permanent-delete file cua A | Bi tu choi voi `MEDIA_NOT_FOUND`; file cua A khong thay doi |
| BE-TRASH-011 | P1 | Token A; file trong trash; MinIO khong kha dung | Xoa vinh vien | Loi MinIO duoc bao ro; khong xoa record DB khi xoa object that bai |
