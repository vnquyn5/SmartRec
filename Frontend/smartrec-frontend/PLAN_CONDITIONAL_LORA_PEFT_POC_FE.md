# Kế hoạch triển khai FE — Conditional LoRA/PEFT PoC (Sprint 5)

> **Phạm vi:** Chỉ thực hiện phía **Frontend (`Frontend/smartrec-frontend`)**, bám sát mục tiêu **Conditional LoRA/PEFT PoC** của Sprint 5.  
> **Nguyên tắc cốt lõi:** Không tạo module/luồng lưu trữ song song (TR01), không mở training production (Mục 2.2), không tạo kết quả Precision/Recall giả khi thiếu dữ liệu hoặc API từ BE/AI (BR03).

---

## 1. Kiểm kê hiện trạng (Mục 2.1)

Qua rà soát trực tiếp codebase SmartRec hiện tại:

| Thành phần | Hiện trạng | Ghi chú |
| :--- | :--- | :--- |
| **FE Governance** (`src/pages/governance/ModelGovernancePage.jsx`) | Đã có 2 tab: `Model Governance` và `AI Usage Dashboard` | Có thể tái sử dụng trực tiếp để tích hợp khu vực **LoRA/PEFT Gate (PoC)** mà không tạo route/module mới. |
| **FE Governance Service** (`src/services/modelGovernanceService.js`) | Đã có chuẩn hóa model (`model_name`, `version`, `runtime`, `device`, `status`, `stage`, `costPer1kTokens`, `maxConcurrency`, `isCore`, `description`) và gọi `/admin/models`, `/admin/models/policy`, `/admin/ai-usage` | Chưa có contract hoặc hàm đánh giá điều kiện **Task Precision/Recall**, **Prompt/Context Baseline**, **Ground Truth Dataset**, và **LoRA/PEFT PoC Gate**. |
| **FE Auth / Role** (`src/features/auth/AuthProvider.jsx`) | Đã có `user?.role` | Cần tái sử dụng để chặn thao tác thay đổi policy/đề xuất PoC nếu user không đủ quyền (TR02). |
| **BE / AI Engine (`ai-engine`, `src/`)** | **Chưa có** file/dataset/endpoint đánh giá `*lora*`, `*peft*`, `*eval*`, `*benchmark*` | **Dependency / Blocker cần ghi rõ:** FE không có nguồn dữ liệu ground truth & kết quả benchmark thật → bắt buộc hiển thị trạng thái `UNVERIFIED / BLOCKED` thay vì giả lập kết quả PASS (BR03). |

---

## 2. Phân tách trách nhiệm & Giới hạn phạm vi FE (Mục 1.2 & 2.2)

- **Minh (FE — phạm vi kế hoạch này):**
  - Thiết kế & xây dựng logic đánh giá cổng điều kiện (**Conditional LoRA/PEFT Gate Evaluator**) thuần client dựa trên contract chuẩn hóa.
  - Bổ sung giao diện **LoRA/PEFT Readiness & Gate (PoC)** tái sử dụng ngay trong `ModelGovernancePage.jsx` (`/governance`).
  - Bổ sung lớp bảo vệ trong `modelGovernanceService.js` để model gắn nhãn PoC chưa được phê duyệt **không thể** bị kích hoạt nhầm thành Active Production Model (TR03).
  - Xử lý đầy đủ các trạng thái biên: thiếu dataset, thiếu baseline prompt/context, lỗi API (`404`/`500`/`501`), không đủ quyền (`403` / non-admin), và trạng thái `NOT_REQUIRED` khi Precision/Recall đã đạt.
  - Viết unit test kiểm thử logic gate + tài liệu contract bàn giao cho BE/AI.
- **Nam (BE — ngoài phạm vi code của plan này):** Cung cấp API lưu/đọc kết quả đánh giá baseline, chính sách retention/approval, authorization (`ADMIN`) và audit log.
- **Khoa (AI — ngoài phạm vi code của plan này):** Chuẩn bị labeled ground truth dataset, chạy thực nghiệm tối ưu context/prompt, tính Task Precision/Recall thật và chỉ triển khai PoC nhỏ nếu gate trả về `ELIGIBLE` và đã được duyệt.

---

## 3. Thiết kế Contract dữ liệu FE ↔ BE ↔ AI (BR01–BR03, TR01–TR03)

FE sẽ gọi endpoint đề xuất (read-only trước, có xử lý graceful khi BE chưa triển khai):
- `GET /admin/models/lora-poc-gate` (lấy trạng thái đánh giá điều kiện LoRA/PEFT hiện tại)
- `POST /admin/models/lora-poc-proposal` (chỉ mở khi đủ cả 4 điều kiện + user có quyền Admin + chưa chạy training production)

### Schema chuẩn FE kỳ vọng (`LoRaPocGateReport`)

```json
{
  "evaluationId": "eval-2026-11-25-01",
  "targetStage": "LLM Summary",
  "dataset": {
    "verified": false,
    "name": null,
    "sampleCount": 0,
    "retentionPolicyApproved": false
  },
  "thresholds": {
    "minTaskPrecision": 0.85,
    "minTaskRecall": 0.80
  },
  "baselinePromptEval": {
    "completed": false,
    "promptVersion": null,
    "precision": null,
    "recall": null,
    "evaluatedAt": null
  },
  "contextPromptOptimizedEval": {
    "completed": false,
    "promptVersion": null,
    "precision": null,
    "recall": null,
    "evaluatedAt": null
  },
  "approval": {
    "policyApproved": false,
    "approvedBy": null,
    "approvedAt": null,
    "trainingScope": "POC_ONLY"
  },
  "blockers": [
    "Chưa có labeled ground truth dataset được xác minh.",
    "Chưa có kết quả đo Task Precision/Recall sau tối ưu context/prompt."
  ]
}
```

### Quy tắc tính trạng thái Gate (Pure Function trên FE)

| Trạng thái Gate (`gateStatus`) | Điều kiện kích hoạt | Hành vi UI trên FE |
| :--- | :--- | :--- |
| **`UNVERIFIED`** | API không khả dụng (`404`/`501`/network) hoặc chưa có dữ liệu baseline | Hiển thị banner cảnh báo rõ *"Chưa xác minh — thiếu API/dữ liệu đánh giá từ BE/AI"*; **không** hiển thị số liệu giả; khóa toàn bộ nút đề xuất PoC. |
| **`BLOCKED`** | Thiếu labeled ground truth (`verified !== true`), thiếu `retentionPolicyApproved`, hoặc chưa chạy tối ưu context/prompt (`contextPromptOptimizedEval.completed !== true`) | Liệt kê chi tiết từng `blocker`; khóa nút đề xuất PoC. |
| **`NOT_REQUIRED`** | Đã có đủ dữ liệu xác minh **và** `precision >= minTaskPrecision` **và** `recall >= minTaskRecall` sau tối ưu context/prompt | Hiển thị thông báo *"Task Precision/Recall đã đạt chuẩn sau tối ưu prompt/context — KHÔNG cần thử nghiệm LoRA/PEFT"* (đúng BR01). Khóa nút đề xuất PoC. |
| **`ELIGIBLE_PENDING_APPROVAL`** | Đủ dữ liệu xác minh, đã tối ưu context/prompt nhưng `precision < minTaskPrecision` hoặc `recall < minTaskRecall`, và chưa có `policyApproved` | Cho phép Admin xem báo cáo so sánh Baseline vs Prompt-tuned và nhấn **Gửi đề xuất PoC có điều kiện** (chỉ ghi nhận đề xuất, **không** trigger training). |
| **`APPROVED_POC_READY`** | Đủ điều kiện `ELIGIBLE` **và** `policyApproved === true` (`trainingScope === 'POC_ONLY'`) | Hiển thị trạng thái sẵn sàng bàn giao cho Khoa (AI) chạy PoC giới hạn; vẫn **chặn** bật lên Production Active Model. |

---

## 4. Kế hoạch thay đổi mã nguồn FE chi tiết

> **Tất cả thay đổi chỉ nằm trong `Frontend/smartrec-frontend/` — không chạm BE/AI.**

### Bước 1 — Tạo module evaluator & service contract (tái sử dụng `src/services/`)
1. **Tạo `src/services/loraPocGateService.js`:**
   - Định nghĩa hằng số trạng thái (`LORA_GATE_STATUS`: `UNVERIFIED`, `BLOCKED`, `NOT_REQUIRED`, `ELIGIBLE_PENDING_APPROVAL`, `APPROVED_POC_READY`).
   - Viết pure function `evaluateLoRaPocGate(report)` kiểm tra đầy đủ BR01, BR02, BR03 (trả về `{ status, canProposePoc, checks[], blockers[], gapSummary }`).
   - Viết hàm `getLoRaPocGateStatus()` gọi `GET /admin/models/lora-poc-gate`: nếu lỗi/404/thiếu payload → trả về `{ status: 'UNVERIFIED', source: 'unverified', report: null, error }` (**tuyệt đối không fallback sang mock PASS**).
   - Viết hàm `submitLoRaPocProposal(payload, userRole)` có validation quyền (`ADMIN`) và validation điều kiện trước khi gọi `POST /admin/models/lora-poc-proposal`.
2. **Cập nhật nhỏ `src/services/modelGovernanceService.js` (TR03):**
   - Trong `normalizeModelEntry`, bảo toàn metadata tùy chọn `isPocOnly` / `adapterType` (không làm hỏng schema cũ).
   - Trong `setActiveModel`, chặn kích hoạt model có `isPocOnly === true` làm Active Production Model (ném lỗi rõ ràng).

### Bước 2 — Tích hợp UI vào `ModelGovernancePage.jsx` (TR01 — không tạo route mới)
1. **Tạo `src/components/governance/LoRaPocGatePanel.jsx`:**
   - **Header & Status Badge:** Hiển thị rõ trạng thái hiện tại (`UNVERIFIED` / `BLOCKED` / `NOT_REQUIRED` / `ELIGIBLE_PENDING_APPROVAL` / `APPROVED_POC_READY`) và nguồn dữ liệu.
   - **Bảng so sánh Metrics (Baseline vs Prompt/Context Optimized vs Target Threshold):** Hiển thị `— (Chưa xác minh)` khi thiếu số liệu thật (BR03).
   - **4-Gate Checklist (BR01–BR02):**
     1. Labeled Ground Truth Dataset & Retention Policy (`BR02`)
     2. Prompt & Context Optimization Baseline (`BR01`)
     3. Ngưỡng Task Precision / Recall (`BR01`)
     4. Quyền & Phê duyệt phạm vi PoC-only (`TR02`)
   - **Danh sách Blockers & Phụ thuộc liên nhóm:** Ghi rõ đầu mục chờ Nam (BE) và Khoa (AI).
   - **Khu vực hành động có kiểm soát:**
     - Nếu `user?.role` không phải Admin → hiển thị chế độ **Read-only** kèm thông báo quyền.
     - Nếu trạng thái không phải `ELIGIBLE_PENDING_APPROVAL` → nút đề xuất bị `disabled` kèm tooltip giải thích lý do.
     - Tuyệt đối **không có** nút "Start Production Training" hay thao tác phá hủy dữ liệu.
2. **Cập nhật `src/pages/governance/ModelGovernancePage.jsx`:**
   - Bổ sung tab thứ 3 trong Tab Switcher hiện có: `LoRA/PEFT Gate (PoC)` (hỗ trợ `?tab=lora-poc`).
   - Giữ nguyên 100% hành vi của 2 tab `Model Governance` và `AI Usage Dashboard` (không hồi quy).

---

## 5. Kế hoạch kiểm thử & Bằng chứng nghiệm thu (Mục 4 & 5)

### 5.1. Unit Test (chạy tự động bằng `node --test`)
Tạo `src/services/loraPocGateService.test.js` bao phủ đầy đủ các kịch bản:
- **TC01 – Missing / Null report (API 404/empty):** Trả về `UNVERIFIED`, `canProposePoc = false`, không sinh số liệu giả (BR03).
- **TC02 – Thiếu Ground Truth Dataset hoặc Retention Policy chưa duyệt:** Trả về `BLOCKED`, liệt kê đúng blockers (BR02).
- **TC03 – Chưa chạy tối ưu Prompt/Context:** Trả về `BLOCKED`, chặn đề xuất LoRA/PEFT (BR01).
- **TC04 – Prompt/Context đã tối ưu VÀ Task Precision/Recall đạt ngưỡng (`P >= 0.85, R >= 0.80`):** Trả về `NOT_REQUIRED`, `canProposePoc = false` (BR01).
- **TC05 – Prompt/Context đã tối ưu NHƯNG Precision hoặc Recall dưới ngưỡng:** Trả về `ELIGIBLE_PENDING_APPROVAL`, `canProposePoc = true`, tính đúng khoảng chênh lệch (`gapSummary`).
- **TC06 – Không đủ quyền (non-admin) gọi `submitLoRaPocProposal`:** Bị từ chối lỗi authorization (TR02).
- **TC07 – Chặn kích hoạt model `isPocOnly: true` làm Active Model trong `modelGovernanceService`:** Ném lỗi bảo vệ phiên bản model (TR03).

### 5.2. Kiểm thử giao diện & build hồi quy
- Chạy `npm run build` trong `Frontend/smartrec-frontend` đảm bảo không lỗi cú pháp/bundling.
- Kiểm tra trực tiếp trên trình duyệt (`/governance?tab=lora-poc`) các trạng thái hiển thị khi chưa có BE API (`UNVERIFIED` rõ ràng, không fake PASS) và chụp ảnh minh chứng (đã che/loại thông tin bí mật).

---

## 6. Kết quả bàn giao dự kiến (Mục 6)

1. Mã nguồn FE:
   - `src/services/loraPocGateService.js`
   - `src/services/loraPocGateService.test.js`
   - `src/components/governance/LoRaPocGatePanel.jsx`
   - Cập nhật `src/pages/governance/ModelGovernancePage.jsx` & `src/services/modelGovernanceService.js`
2. Báo cáo nghiệm thu & bảng kết quả test **PASS / FAIL / BLOCKED** kèm log chạy test.
3. Tài liệu contract API & danh sách dependencies/blockers gửi Nam (BE) và Khoa (AI) (xác nhận rõ chưa merge `dev`, chưa mở training production).

