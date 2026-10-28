# Bàn giao: Local LLM / Gemini Fallback, bảo vệ PII và giới hạn request

## 1. Luồng xử lý

1. `LLMGuard.check_and_increment_request` – chặn khi job vượt số request tối đa.
2. Gọi **Local LLM** (mặc định). Thành công → trả kết quả, `fallback_used=false`, cost = 0.
3. Local **timeout** hoặc **lỗi kết nối/HTTP ≥ 400** → xét fallback:
   - `FALLBACK_ENABLED=false` → ném `FallbackDisabledError` (HTTP 503), **không gọi Gemini**.
   - `check_cost_ceiling` – job đã chạm trần chi phí → `CostLimitExceededError` (HTTP 429).
   - Che PII (bắt buộc theo `PII_REDACTION_ENFORCED=true`, client không tắt được).
   - Gọi Gemini qua throttle `GEMINI_RPM_LIMIT`, retry 429/503 với exponential backoff + jitter.
   - Ghi nhận cost; vượt trần → `CostLimitExceededError`.
4. Kết quả gồm `fallback_used`, `fallback_reason` (`LOCAL_TIMEOUT` | `LOCAL_CONNECTION_ERROR`), token, cost.
   Lý do chọn model **không chứa nội dung prompt**.
5. `dispatch_usage_callback` chống gửi lặp theo `(job_id, execution_id)`; payload phẳng `aiUsage` gửi tới
   Backend `POST /api/v1/jobs/{jobId}/ai-usage` (header `X-Internal-Token`, `X-Execution-Id`).

## 1.1 Workflow tích hợp

```
Backend/Worker (có transcript)
   └─ POST ai-engine /api/v1/nlp/summary   [X-Internal-Token]
        {job_id, transcript_text, meeting_title?, execution_id?}
        ├─ NLPPipelineOrchestrator.run_summary → LLMOrchestrator.generate (Local → Gemini fallback)
        ├─ ghi AIUsageRecord vào nhật ký ai_usage cục bộ (app.tracking, fail-safe)
        └─ nếu có execution_id: callback aiUsage → Backend POST /jobs/{jobId}/ai-usage
                                         └─ AiUsageService.record → bảng ai_usage (idempotent theo job+execution)
```

- URL callback luôn dựng từ `BACKEND_BASE_URL` (không nhận từ client để tránh SSRF).
- Callback thất bại **không** làm hỏng kết quả tóm tắt; response có `callbackDispatched`.
- Worker âm thanh hiện tại (`redis_job_worker.py`: FFMPEG → WEBRTC → PYANNOTE → OUTPUT) chưa sinh transcript nên
  chưa có stage NLP tự động; khi có bước ASR, chỉ cần gọi endpoint `/nlp/summary` ở trên.

## 2. Cấu hình (`.env` của ai-engine)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `LOCAL_LLM_ENDPOINT` / `LOCAL_LLM_MODEL` / `LOCAL_LLM_TIMEOUT_SECONDS` | `http://localhost:11434/api/generate` / `qwen2.5:7b` / `30` | Local LLM (Ollama) |
| `FALLBACK_ENABLED` | `true` | Bật/tắt gọi Gemini |
| `GEMINI_API_KEY` / `GEMINI_MODEL` / `GEMINI_TIMEOUT_SECONDS` | – / `gemini-1.5-flash` / `30` | Gemini (key gửi qua header `x-goog-api-key`, không nằm trong URL) |
| `PII_REDACTION_ENFORCED` | `true` | Luôn che PII khi gửi ra ngoài |
| `JOB_MAX_REQUESTS_LIMIT` | `5` | Số request tối đa / job |
| `JOB_MAX_COST_LIMIT_USD` | `0.50` | Trần chi phí / job |
| `GEMINI_RPM_LIMIT` | `12` | Throttle request/phút (trong một tiến trình) |
| `GEMINI_MAX_RETRIES` | `3` | Retry khi HTTP 429/503 |
| `LLM_GUARD_BACKEND` | `auto` | `redis` / `memory` / `auto` (Redis nếu kết nối được) |
| `SMARTREC_INTERNAL_TOKEN` | – | **Bắt buộc** để gọi `/api/v1/nlp/*` (thiếu/sai token → HTTP 401) |
| `BACKEND_BASE_URL` | `http://host.docker.internal:8082/api/v1` | Đích callback `ai-usage` |

## 3. Cách kiểm tra

### 3.1 Test tự động
```powershell
cd ai-engine
python -m pytest tests/test_llm_fallback_and_pii.py tests/test_llm_hardening.py tests/test_api_nlp.py -q
```

### 3.2 Kiểm thử thủ công qua API (`POST /api/v1/nlp/generate`, header `X-Internal-Token: <SMARTREC_INTERNAL_TOKEN>`)
Không có/sai token → HTTP 401. Luồng tích hợp: `POST /api/v1/nlp/summary` với
`{"job_id":"<uuid job có trong DB>","transcript_text":"...","execution_id":"<uuid>"}` → response có `aiUsage` và
`callbackDispatched=true`; kiểm tra bảng `ai_usage` phía Backend có 1 dòng (gọi lại cùng `execution_id` không tạo dòng mới).
Body mẫu cho `/generate`:
```json
{"job_id":"demo-1","prompt":"SĐT 0912345678, email a@b.com cần tóm tắt"}
```

| Kịch bản | Cách tạo | Kết quả mong đợi |
|---|---|---|
| Local chạy được | Bật Ollama | `fallback_used=false`, `estimated_cost_usd=0` |
| Local timeout/lỗi | Tắt Ollama, `FALLBACK_ENABLED=true`, có `GEMINI_API_KEY` | `fallback_used=true`, `fallback_reason=LOCAL_CONNECTION_ERROR` |
| Khóa fallback | Tắt Ollama, `FALLBACK_ENABLED=false` | HTTP 503 `FALLBACK_DISABLED`, log không có lời gọi Gemini |
| Quá số request | Gọi cùng `job_id` quá `JOB_MAX_REQUESTS_LIMIT` lần | HTTP 429 `QUOTA_EXCEEDED` |
| Quá chi phí | Đặt `JOB_MAX_COST_LIMIT_USD=0.000001` | HTTP 429 `COST_LIMIT_EXCEEDED` |
| Mất mạng ngoài | Ngắt Internet, tắt Ollama | HTTP 502 `EXTERNAL_LLM_ERROR`, thông báo không chứa API key |

Kiểm tra log: không thấy số điện thoại, email, CCCD, token, `AIza...`; fallback có dòng
`Kích hoạt Fallback sang Gemini ... Lý do: ...`.

### 3.3 Kiểm tra Redis backend
Chạy Redis, đặt `LLM_GUARD_BACKEND=redis`, gọi API quá hạn mức, restart ai-engine rồi gọi lại cùng `job_id`:
vẫn bị `QUOTA_EXCEEDED` (trạng thái nằm trên Redis, key `smartrec:llm_guard:*`).

## 4. Giới hạn đã biết

- Throttle `GEMINI_RPM_LIMIT` là theo từng tiến trình; chạy N worker thì tổng có thể tới N × giới hạn.
- Chưa che **tên người** (chỉ che email, SĐT, CCCD/CMND, số tài khoản/thẻ, secret).
- Test tự động dùng mock ở tầng `requests`; chưa có lần chạy với Ollama/Gemini thật trong môi trường CI.
- Chưa cài `celery` trong môi trường dev nên `test_audio_job_retry_policy.py` không chạy được (không liên quan module này).
