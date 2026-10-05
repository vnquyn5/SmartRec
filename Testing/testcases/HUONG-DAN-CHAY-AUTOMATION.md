# Huong dan chay automation test

Tai lieu nay huong dan chay cac automation test hien co cho Frontend, Backend va AI Engine tren Windows/PowerShell.

## 1. Frontend

**Thu muc:** `Frontend\smartrec-frontend`

```powershell
cd D:\SMART_REC\SmartRec\Frontend\smartrec-frontend
npm install
npm test
```

- `npm test` chay Vitest mot lan va tra exit code khac 0 neu co test that bai.
- Moi lan chay se tao/cap nhat report de chia se voi quan ly tai `tests\reports\latest.md`.
- Xem report nay de biet tong pass/fail/skip, ket qua theo tung file va noi dung loi.
- Khi dang viet test, co the dung `npm run test:watch` de chay lai khi file thay doi. Watch mode khong tao report Markdown; dung `npm test` de tao report cuoi cung.
- Test duoc tap trung trong `Frontend\smartrec-frontend\tests`:
  - `unit\` - unit test cho validator/utilities.
  - `components\` - test React components/forms.
  - `features\` - test auth va feature behavior.

## 2. Backend

**Thu muc:** repository root `D:\SMART_REC\SmartRec`

Chay toan bo JUnit test:

```powershell
cd D:\SMART_REC\SmartRec
.\mvnw.cmd test
```

Chay rieng test hien co:

```powershell
.\mvnw.cmd -Dtest=UserServiceImplTest test
```

- Maven tra exit code khac 0 neu build/test that bai.
- Ket qua chi tiet cua Maven Surefire nam trong `target\surefire-reports` (file `.txt` va `.xml`).
- Test service hien tai la unit test Mockito, khong can khoi dong PostgreSQL/Redis/MinIO.
- Khi them test class moi, dat file trong `src\test\java` va ten class theo quy uoc `*Test` de Maven Surefire tu tim thay.

## 3. AI Engine

**Thu muc:** `D:\SMART_REC\SmartRec\ai-engine`

Tao va kich hoat Python virtual environment (chi can lam mot lan):

```powershell
cd D:\SMART_REC\SmartRec\ai-engine
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Chay cac test script hien co:

```powershell
python .\tests\test_audio_aec.py
python .\tests\test_audio_ans.py
python .\tests\test_audio_chunker.py
python .\tests\test_ffmpeg_wrapper.py
```

- Cac script tu kiem tra assertion va tra exit code khac 0 neu that bai; chay tung lenh de biet chinh xac script nao loi.
- Can cai FFmpeg va FFprobe, dong thoi dam bao co the goi bang lenh `ffmpeg` va `ffprobe` trong PATH.
- Mot so script can media mau trong `poc\data\input`; neu thieu fixture, script co the that bai hoac bo qua phan kiem tra media that tuy script.
- `test_audio_ans.py` va `test_audio_chunker.py` tao/xoa fixture tam trong `tests\output`. Khong dong thoi chay cac script nay tren cung thu muc output.
- Cac file hien tai la script doc lap, chua duoc viet theo pytest va chua co report tong hop tu dong. Ket qua duoc in ra terminal; luu log neu can gui bao cao:

```powershell
python .\tests\test_audio_aec.py 2>&1 | Tee-Object .\tests\audio-aec-run.log
```

Thay ten script va ten log tuong ung khi chay cac bai con lai. Kiem tra dong ket qua cuoi va exit code truoc khi gui log.

## 4. Thu tu de tao ket qua gui quan ly

1. Chay `npm test`; dinh kem `Frontend\smartrec-frontend\tests\reports\latest.md`.
2. Chay `.\mvnw.cmd test`; neu can, dinh kem cac bao cao tu `target\surefire-reports`.
3. Chay tung AI script; luu log terminal va ghi ro script nao pass/fail, fixture/moi truong da su dung.
4. Khong danh dau ca nhom pass neu mot lenh co exit code khac 0 hoac con bai test chua duoc chay.

## Luu y pham vi

- Frontend automation hien bao phu validator, auth forms va route guard; chua bao phu toan bo upload/meeting/profile/trash.
- Backend hien co JUnit test cho `UserServiceImpl`; cac testcase API khac trong thu muc tai lieu chua tu dong hoa.
- AI Engine hien co mot so script test audio/FFmpeg. Cac pipeline inference chua co automation test cho ket qua AI.
