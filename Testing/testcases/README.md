# SmartRec - Test Cases

Bo testcase duoc chia theo he thong va chuc nang de de them testcase khi pham vi mo rong.

Huong dan chay automation: [HUONG-DAN-CHAY-AUTOMATION.md](./HUONG-DAN-CHAY-AUTOMATION.md).

## Thu muc

| Nhom | File tong | Pham vi |
|---|---|---|
| Frontend | [FE.md](./frontend/FE.md) | Quy uoc chung va danh muc testcase giao dien |
| Backend | [BE.md](./backend/BE.md) | Quy uoc chung va danh muc testcase API/service |
| AI Engine | [AI.md](./ai/AI.md) | Quy uoc chung va danh muc testcase AI service |

## Cach dung

- Bat dau tu file tong cua nhom (`FE.md`, `BE.md`, `AI.md`), sau do mo file theo chuc nang.
- Moi testcase co ID rieng theo prefix `FE-`, `BE-` hoac `AI-`; giu ID hien tai khi chinh sua, tao ID moi khi them testcase.
- Thuc hien theo cot **Buoc thuc hien** va ghi ket qua thuc te, `PASS`/`FAIL` vao cong cu quan ly test cua nhom.
- Phan lon testcase trong tai lieu la kich ban manual; nhom frontend da co mot so automation test cho auth, route guard va validator.
- Chay frontend automation test bang `cd Frontend/smartrec-frontend` va `npm test`.
