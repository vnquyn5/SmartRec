# Frontend - Auth va form validation

Automation test: chay `npm test` trong `Frontend/smartrec-frontend`. Tat ca test duoc gom trong `Frontend/smartrec-frontend/tests/`, gom `unit/validators.test.js`, `components/AuthForms.test.jsx` va `features/RequireAuth.test.jsx`.

## A. Route, dang nhap va phan quyen

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| FE-ROUTE-001 | P1 | Chua dang nhap | Mo `/`, `/meeting/{id}`, `/upload`, `/history`, `/workspace`, `/trash`, `/profile` | Route bao ve chuyen ve `/login`, luu route ban dau de tiep tuc theo xu ly auth |
| FE-ROUTE-002 | P1 | Dang o trang login | Mo `/register` va `/forgot-password` | Hien dung trang dang ky/quen mat khau, khong bi guard chan |
| FE-ROUTE-003 | P1 | Dang nhap hop le | Mo tung route bao ve trong AppRoutes | Trang tuong ung hien thi va dung DashboardLayout neu duoc khai bao trong layout |
| FE-ROUTE-004 | P2 | Dang nhap; duong dan `/upload/large` | Truy cap `/upload/large` | Chuyen huong replace ve `/upload` |
| FE-ROUTE-005 | P2 | AuthProvider dang bootstrap/logout | Tai lai trang khi token/user duoc luu; sau do logout/het han | Hien trang bootstrapping trong luc khoi tao; khi khong con auth thi route bao ve yeu cau dang nhap |

## B. Validator form

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| FE-VAL-001 | P1 | Mo form co dung validator | Email hop le co whitespace dau/cuoi; email sai, thieu `@`/domain | Email hop le sau trim duoc chap nhan; email sai bi bao loi |
| FE-VAL-002 | P1 | Mo form co phone validator | Nhap `0` + 9 chu so; nhap thieu/thua so, ky tu chu hoac khong bat dau bang 0 | Chi phone dung 10 chu so theo pattern duoc chap nhan |
| FE-VAL-003 | P1 | Mo form dang ky/profile | Nhap ho ten 3-50 ky tu co chu va khoang trang; nhap rong, qua gioi han hoac co so/ky tu dac biet | Ten hop le duoc chap nhan; cac truong hop con lai hien thong bao tuong ung |
| FE-VAL-004 | P2 | Mo form co formatFullName | Nhap chu hoa/thuong lan lon, nhieu khoang trang, so va ky tu dac biet | Gia tri duoc bo ky tu ngoai chu/khoang trang, gom khoang trang lap va viet hoa dau moi tu |
| FE-VAL-005 | P1 | Mo form password | Kiem tra password 8-16 ky tu co chu hoa, chu thuong, so, ky tu dac biet va lan luot bo tung dieu kien | Password chi valid khi tat ca 5 requirement trong frontend dung |
| FE-VAL-006 | P1 | Mo form xac nhan password | De trong, khac password, sau do nhap khop | Hien dung loi cho rong/khong khop; gia tri khop khong loi |
| FE-VAL-007 | P1 | Mo form OTP | De trong, nhap 5/7 ky tu, chu cai, sau do nhap dung 6 chu so | Chi chuoi 6 chu so duoc chap nhan |
| FE-VAL-008 | P2 | Mo form co required validator | Gui chuoi rong, whitespace va chuoi co noi dung | Rong/whitespace bi bao required; chuoi co noi dung khong loi |

## C. Form dang nhap, dang ky va quen mat khau

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| FE-AUTH-001 | P1 | Backend auth dang hoat dong | Dang nhap bang email/password dung, sau do thu bang phone/password dung | Login thanh cong va chuyen den `/`; session/auth state duoc cap nhat |
| FE-AUTH-002 | P1 | Dang o login | Submit form rong, email/phone sai dinh dang hoac password khong dat validator | Khong gui login request; hien loi truong tuong ung |
| FE-AUTH-003 | P1 | Backend tra loi credential sai | Submit login voi thong tin khong dung | Hien loi dang nhap; khong chuyen den dashboard; loading duoc tat sau response |
| FE-AUTH-004 | P2 | Dang o login | Bam nut hien/ an mat khau va checkbox ghi nho | Mat khau doi type hien/an; checkbox co the bat/tat |
| FE-AUTH-005 | P1 | Backend dang ky hoat dong | Dang ky voi thong tin hop le va password dap ung validator frontend | Goi register va chuyen den `/login` voi thong bao dang ky thanh cong |
| FE-AUTH-006 | P1 | Backend tra email/phone trung | Dang ky voi email hoac phone da ton tai | Loi backend duoc gan vao dung field; form khong hien success |
| FE-AUTH-007 | P1 | Dang o forgot password | Nhap email/identifier va submit | Chuyen sang buoc OTP theo state giao dien |
| FE-AUTH-008 | P1 | Dang o buoc OTP | Nhap 6 chu so bat ky va xac nhan | Frontend validator chap nhan du 6 chu so va chuyen buoc; luu y source khong goi API xac minh OTP |
| FE-AUTH-009 | P2 | Dang o buoc OTP | Bam "Gửi lại" / quay lai | Quay ve buoc nhap email; source khong co API gui lai ma OTP |
| FE-AUTH-010 | P1 | Dang o buoc tao password moi | Nhap password hop validator va confirm khop, submit | Chuyen sang man success sau delay; luu y source hien tai khong cap nhat password tren backend |
| FE-AUTH-011 | P2 | Dang o man success forgot-password | Bam quay lai dang nhap | Chuyen den `/login` |
