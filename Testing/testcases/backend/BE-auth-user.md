# Backend - Auth va user

## A. Dang ky, dang nhap va bao mat

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| BE-AUTH-001 | P1 | Email va phone chua ton tai | POST `/api/auth/register` voi ho ten hop le, email `.com`, phone 10 so dau `0`, mat khau 8-16 ky tu co chu hoa va ky tu dac biet | HTTP 201; tai khoan duoc luu active; response thong bao dang ky thanh cong |
| BE-AUTH-002 | P1 | Email da duoc dung | Dang ky voi email trung, phone moi | Request bi tu choi voi loi `EMAIL_ALREADY_EXISTS`; khong tao tai khoan moi |
| BE-AUTH-003 | P1 | Phone da duoc dung | Dang ky voi phone trung, email moi | Request bi tu choi voi loi `PHONE_ALREADY_EXISTS`; khong tao tai khoan moi |
| BE-AUTH-004 | P1 | Khong can dang nhap | Gui cac request register lan luot voi email/phone sai dinh dang, truong bat buoc rong, ho ten qua 30 ky tu/co so, password ngan hon 8/dai hon 16/thieu chu hoa/ky tu dac biet | Moi payload khong hop le bi validation tu choi; khong tao tai khoan |
| BE-AUTH-005 | P1 | Tai khoan active da ton tai | POST `/api/auth/login` voi email va password dung | HTTP 200; co access token va thong tin user dung |
| BE-AUTH-006 | P1 | Tai khoan active da ton tai | POST `/api/auth/login` voi phone va password dung | HTTP 200; co access token va thong tin user dung cua tai khoan |
| BE-AUTH-007 | P1 | Khong can dang nhap | Dang nhap voi identifier khong ton tai, sau do identifier dung nhung password sai | Ca hai deu that bai; khong tra access token |
| BE-AUTH-008 | P1 | Tai khoan inactive da ton tai | Dang nhap voi credential dung cua tai khoan inactive | Request bi tu choi voi `ACCOUNT_LOCKED`; khong cap token |
| BE-AUTH-009 | P1 | Co endpoint bao ve va endpoint auth cong khai | Goi endpoint bao ve khong co token, token sai/het han, sau do token hop le | Request khong co token/token khong hop le bi tu choi; token hop le duoc chap nhan; register/login van truy cap duoc khi chua dang nhap |
| BE-AUTH-010 | P1 | Backend cau hinh allowed origins | Gui CORS preflight tu origin duoc cho phep va origin khong nam trong danh sach | Origin cho phep nhan CORS headers da cau hinh; origin khong duoc phep khong duoc browser chap nhan |
| BE-AUTH-011 | P2 | JWT secret/expiration duoc cau hinh | Dung token bi sua signature, token het han va token hop le nhung subject khong khop user | Token khong hop le/het han/subject khong khop khong duoc coi la authenticated |

## B. Ho so va mat khau

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| BE-USER-001 | P1 | Token user A hop le | GET `/api/user/me` | HTTP 200; tra dung id, userCode, email, phone, full name, department, position, role va createdAt cua A |
| BE-USER-002 | P1 | Token user A hop le | PUT `/api/user/me` voi fullName/email/phone hop le, email/phone moi chua dung | HTTP 200; thong tin tra ve va du lieu luu duoc cap nhat |
| BE-USER-003 | P1 | Token user A hop le | Cap nhat profile, giu nguyen email va phone hien tai | Cap nhat thanh cong; khong tu bao trung chinh thong tin cua minh |
| BE-USER-004 | P1 | Token user A hop le; email cua B da ton tai | Cap nhat email thanh email cua B | Tu choi voi `EMAIL_ALREADY_EXISTS`; profile A khong bi thay doi |
| BE-USER-005 | P1 | Token user A hop le; phone cua B da ton tai | Cap nhat phone thanh phone cua B | Tu choi voi `PHONE_ALREADY_EXISTS`; profile A khong bi thay doi |
| BE-USER-006 | P1 | Token user A hop le | Gui profile co ten rong, ten >50 ky tu/co ky tu khong phai chu va khoang trang, email sai dinh dang, hoac phone khong dung 10 chu so bat dau bang 0 | Moi gia tri khong hop le bi tu choi; khong luu thay doi |
| BE-USER-007 | P1 | Token user A hop le | PUT `/api/user/change-password` voi mat khau cu dung, mat khau moi hop le va khac mat khau cu | HTTP 200; mat khau moi dang nhap duoc; mat khau cu khong con dang nhap duoc |
| BE-USER-008 | P1 | Token user A hop le | Doi password voi mat khau cu sai, sau do thu password moi trung password cu | Moi request bi tu choi (`INVALID_CURRENT_PASSWORD`/`SAME_PASSWORD`); password khong thay doi |
| BE-USER-009 | P1 | Token user A hop le | Doi password voi password moi rong, ngoai do dai 8-16 hoac thieu chu hoa/chu thuong/so/ky tu dac biet | Validation tu choi; password hien tai van con hieu luc |
| BE-USER-010 | P1 | Khong co token | Goi GET `/api/user/me`, PUT `/api/user/me`, PUT `/api/user/change-password` | Tat ca endpoint bao ve deu tu choi truy cap |
