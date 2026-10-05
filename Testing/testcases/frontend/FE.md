# Frontend - Test Cases

File tong hop danh muc testcase frontend. Cac testcase duoc chia theo chuc nang:

| File | Pham vi |
|---|---|
| [FE-auth.md](./FE-auth.md) | Route, auth, form validation, dang nhap/dang ky/quen mat khau |
| [FE-upload.md](./FE-upload.md) | Upload don/chunked, chia chunk, progress va cancel |
| [FE-meetings-profile-trash.md](./FE-meetings-profile-trash.md) | Meeting, ho so, download va thung rac |

## Quy uoc chung

- Kiem thu tren trinh duyet voi backend dang chay va tai khoan duoc chuan bi theo testcase.
- Chay automation test bang `cd Frontend/smartrec-frontend` va `npm test`; dung `npm run test:watch` khi phat trien test.
- Tat ca frontend automation test duoc dat tap trung trong [tests/](/D:/SMART_REC/SmartRec/Frontend/smartrec-frontend/tests), tach thanh `unit/`, `components/` va `features/`.
- Moi lan chay `npm test` tu dong cap nhat [latest.md](/D:/SMART_REC/SmartRec/Frontend/smartrec-frontend/tests/reports/latest.md), gom tong ket pass/fail, ket qua tung file va chi tiet loi.
- Automation hien tai bao phu validator, auth form va route guard. Cac luong upload/meeting/profile/trash van la manual, se duoc bo sung theo tung nhom.
- Validator password frontend yeu cau chu hoa, chu thuong, so va ky tu dac biet; validator register backend hien yeu cau chu hoa va ky tu dac biet (ngoai do dai). Mot password co the hop le mot ben nhung khong hop le ben kia; ghi lai dung behavior khi test.
- Luong forgot-password/OTP/new-password hien chi chuyen buoc giao dien bang timeout, khong goi API de gui/xac minh OTP hay doi password. Cac testcase chi xac nhan UI hien tai, khong khang dinh reset password backend da hoat dong.
- Khong danh dau PASS cho hanh vi chua duoc source/API ho tro.
