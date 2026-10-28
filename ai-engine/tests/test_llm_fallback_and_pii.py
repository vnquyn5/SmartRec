import pytest
import logging
from unittest.mock import MagicMock, patch

from app.schemas.llm_schemas import LLMRequest, LLMResponse
from app.services.pii_sanitizer import PIISanitizer, LogSanitizerFilter
from app.services.llm_guard import (
    LLMGuard,
    QuotaExceededError,
    CostLimitExceededError,
    DuplicateCallbackError
)
from app.services.llm_clients import (
    LocalLLMClient,
    GeminiClient,
    LocalLLMTimeoutError,
    LocalLLMConnectionError,
    GeminiAPIError,
    FallbackDisabledError
)
from app.services.llm_orchestrator import LLMOrchestrator
from app.pipelines.nlp_pipeline import NLPPipelineOrchestrator


@pytest.fixture
def pii_sanitizer():
    return PIISanitizer()


@pytest.fixture
def mock_local_client():
    client = MagicMock(spec=LocalLLMClient)
    client.model = "qwen2.5:7b"
    return client


@pytest.fixture
def mock_gemini_client():
    client = MagicMock(spec=GeminiClient)
    client.model = "gemini-1.5-flash"
    return client


@pytest.fixture
def mock_callback_client():
    client = MagicMock()
    client.send_callback.return_value = True
    return client


@pytest.fixture
def orchestrator(mock_local_client, mock_gemini_client, mock_callback_client, pii_sanitizer):
    guard = LLMGuard(max_requests_per_job=3, max_cost_per_job=0.05)
    return LLMOrchestrator(
        local_client=mock_local_client,
        gemini_client=mock_gemini_client,
        pii_sanitizer=pii_sanitizer,
        llm_guard=guard,
        callback_client=mock_callback_client,
        fallback_enabled=True
    )


# ============================================================================
# TC1: Tuyến Local LLM mặc định chạy thành công (No fallback, Cost = 0)
# ============================================================================
def test_local_llm_primary_success(orchestrator, mock_local_client, mock_gemini_client):
    mock_local_client.generate.return_value = {
        "text": "Tóm tắt cuộc họp từ mô hình Local",
        "model_name": "qwen2.5:7b",
        "model_version": "local-v1",
        "input_tokens": 150,
        "output_tokens": 80,
        "total_tokens": 230,
        "processing_time_ms": 450,
        "estimated_cost_usd": 0.0
    }

    req = LLMRequest(job_id="job-101", prompt="Nội dung cuộc họp cần tóm tắt")
    res = orchestrator.generate(req)

    assert res.job_id == "job-101"
    assert res.text == "Tóm tắt cuộc họp từ mô hình Local"
    assert res.fallback_used is False
    assert res.fallback_reason is None
    assert res.estimated_cost_usd == 0.0
    assert res.model_name == "qwen2.5:7b"

    mock_local_client.generate.assert_called_once()
    mock_gemini_client.generate.assert_not_called()


# ============================================================================
# TC2: Local LLM Timeout -> Tự động Fallback sang Gemini có log lý do
# ============================================================================
def test_local_llm_timeout_triggers_gemini_fallback(orchestrator, mock_local_client, mock_gemini_client):
    mock_local_client.generate.side_effect = LocalLLMTimeoutError("Local LLM timeout sau 30s")
    mock_gemini_client.generate.return_value = {
        "text": "Tóm tắt dự phòng từ Gemini 1.5 Flash",
        "model_name": "gemini-1.5-flash",
        "model_version": "gemini-1.5",
        "input_tokens": 160,
        "output_tokens": 90,
        "total_tokens": 250,
        "processing_time_ms": 320,
        "estimated_cost_usd": 0.000039
    }

    req = LLMRequest(job_id="job-102", prompt="Họp bàn tính năng mới")
    res = orchestrator.generate(req)

    assert res.job_id == "job-102"
    assert res.fallback_used is True
    assert res.fallback_reason == "LOCAL_TIMEOUT"
    assert res.model_name == "gemini-1.5-flash"
    assert res.estimated_cost_usd > 0.0
    assert res.text == "Tóm tắt dự phòng từ Gemini 1.5 Flash"

    mock_local_client.generate.assert_called_once()
    mock_gemini_client.generate.assert_called_once()


# ============================================================================
# TC3: Local LLM Lỗi kết nối (500/Connection Refused) -> Fallback Gemini
# ============================================================================
def test_local_llm_connection_error_triggers_gemini_fallback(orchestrator, mock_local_client, mock_gemini_client):
    mock_local_client.generate.side_effect = LocalLLMConnectionError("Connection refused: 11434")
    mock_gemini_client.generate.return_value = {
        "text": "Kết quả từ Gemini khi Local sập",
        "model_name": "gemini-1.5-flash",
        "model_version": "gemini-1.5",
        "input_tokens": 100,
        "output_tokens": 50,
        "total_tokens": 150,
        "processing_time_ms": 280,
        "estimated_cost_usd": 0.000022
    }

    req = LLMRequest(job_id="job-103", prompt="Đánh giá tiến độ dự án")
    res = orchestrator.generate(req)

    assert res.fallback_used is True
    assert res.fallback_reason == "LOCAL_CONNECTION_ERROR"
    assert res.model_name == "gemini-1.5-flash"
    mock_gemini_client.generate.assert_called_once()


# ============================================================================
# TC4: Khóa Fallback (FALLBACK_ENABLED=False) -> Báo lỗi, tuyệt đối không gọi Gemini
# ============================================================================
def test_fallback_disabled_rejects_external_call(orchestrator, mock_local_client, mock_gemini_client):
    orchestrator.fallback_enabled = False
    mock_local_client.generate.side_effect = LocalLLMTimeoutError("Local timeout")

    req = LLMRequest(job_id="job-104", prompt="Prompt bảo mật không được gửi ra ngoài")
    
    with pytest.raises(FallbackDisabledError) as exc_info:
        orchestrator.generate(req)

    assert "cơ chế fallback đang bị tắt" in str(exc_info.value)
    mock_local_client.generate.assert_called_once()
    mock_gemini_client.generate.assert_not_called()


# ============================================================================
# TC5: Bảo vệ PII (Redaction) trước khi gửi ra Gemini
# ============================================================================
def test_pii_redaction_before_gemini_call(orchestrator, mock_local_client, mock_gemini_client, pii_sanitizer):
    raw_prompt = (
        "Anh Hoàng (SĐT: 0912345678, email: hoang.nguyen@smartrec.vn, CCCD: 001201009999) "
        "đã chuyển khoản từ thẻ 9704220011223344 với token Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token"
    )

    mock_local_client.generate.side_effect = LocalLLMConnectionError("Local offline")
    mock_gemini_client.generate.return_value = {
        "text": "Action Item: Xác nhận chuyển tiền",
        "model_name": "gemini-1.5-flash",
        "input_tokens": 80,
        "output_tokens": 20,
        "total_tokens": 100,
        "processing_time_ms": 200,
        "estimated_cost_usd": 0.00001
    }

    req = LLMRequest(job_id="job-105", prompt=raw_prompt, apply_pii_redaction=True)
    orchestrator.generate(req)

    # Lấy prompt thực tế mà gemini_client nhận được
    call_args = mock_gemini_client.generate.call_args
    sanitized_prompt_sent = call_args.kwargs["prompt"]

    # Xác thực: Dữ liệu gửi ra dịch vụ ngoài đã bị che hoàn toàn các thông tin PII
    assert "0912345678" not in sanitized_prompt_sent
    assert "[PHONE_REDACTED]" in sanitized_prompt_sent
    assert "hoang.nguyen@smartrec.vn" not in sanitized_prompt_sent
    assert "[EMAIL_REDACTED]" in sanitized_prompt_sent
    assert "001201009999" not in sanitized_prompt_sent
    assert "[ID_REDACTED]" in sanitized_prompt_sent
    assert "9704220011223344" not in sanitized_prompt_sent
    assert "[BANK_ACCOUNT_REDACTED]" in sanitized_prompt_sent
    assert "eyJhbGciOiJIUzI1Ni" not in sanitized_prompt_sent
    assert "[SECRET_REDACTED]" in sanitized_prompt_sent


# ============================================================================
# TC6: Kiểm tra Logging Sanitizer không để lộ PII và Token ra log
# ============================================================================
def test_logging_sanitizer_filter_scrubs_pii():
    sanitizer = PIISanitizer()
    log_filter = LogSanitizerFilter(sanitizer)

    record = logging.LogRecord(
        name="test_logger",
        level=logging.INFO,
        pathname="test.py",
        lineno=10,
        msg="User email: test@gmail.com, Phone: 0988776655, Token: sk-123456789012345678901234",
        args=(),
        exc_info=None
    )

    log_filter.filter(record)

    assert "test@gmail.com" not in record.msg
    assert "[EMAIL_REDACTED]" in record.msg
    assert "0988776655" not in record.msg
    assert "[PHONE_REDACTED]" in record.msg
    assert "sk-123456789012345678901234" not in record.msg
    assert "[SECRET_REDACTED]" in record.msg


# ============================================================================
# TC7: Vượt quá giới hạn số lượng request trên mỗi Job (Rate/Quota limit)
# ============================================================================
def test_job_max_requests_quota_exceeded(orchestrator, mock_local_client):
    mock_local_client.generate.return_value = {
        "text": "OK",
        "model_name": "qwen2.5:7b",
        "input_tokens": 10,
        "output_tokens": 5,
        "total_tokens": 15,
        "processing_time_ms": 100,
        "estimated_cost_usd": 0.0
    }

    job_id = "job-quota-test"
    # Ngưỡng cấu hình fixture là max_requests_per_job = 3
    orchestrator.generate(LLMRequest(job_id=job_id, prompt="Req 1"))
    orchestrator.generate(LLMRequest(job_id=job_id, prompt="Req 2"))
    orchestrator.generate(LLMRequest(job_id=job_id, prompt="Req 3"))

    # Lần thứ 4 phải bị chặn với QuotaExceededError
    with pytest.raises(QuotaExceededError) as exc_info:
        orchestrator.generate(LLMRequest(job_id=job_id, prompt="Req 4"))

    assert "vượt quá giới hạn request" in str(exc_info.value)


# ============================================================================
# TC8: Vượt giới hạn chi phí tối đa của Job (Cost Limit Guard)
# ============================================================================
def test_cost_limit_exceeded_rejects_subsequent_calls(mock_local_client, mock_gemini_client, mock_callback_client, pii_sanitizer):
    # Cấu hình trần chi phí thấp: 0.0001 USD
    strict_guard = LLMGuard(max_requests_per_job=10, max_cost_per_job=0.0001)
    orchestrator = LLMOrchestrator(
        local_client=mock_local_client,
        gemini_client=mock_gemini_client,
        pii_sanitizer=pii_sanitizer,
        llm_guard=strict_guard,
        callback_client=mock_callback_client,
        fallback_enabled=True
    )

    mock_local_client.generate.side_effect = LocalLLMTimeoutError("Timeout")
    # Lần 1: Trả về chi phí 0.00015 (vượt trần 0.0001)
    mock_gemini_client.generate.return_value = {
        "text": "Gemini response",
        "model_name": "gemini-1.5-flash",
        "input_tokens": 1000,
        "output_tokens": 500,
        "total_tokens": 1500,
        "processing_time_ms": 500,
        "estimated_cost_usd": 0.00015
    }

    job_id = "job-cost-test"
    # Lần 1: record_and_check_cost sẽ ném CostLimitExceededError sau khi Gemini trả về kết quả vượt ngưỡng
    with pytest.raises(CostLimitExceededError) as exc_info:
        orchestrator.generate(LLMRequest(job_id=job_id, prompt="Prompt 1"))

    assert "vượt giới hạn chi phí tối đa" in str(exc_info.value)

    # Lần 2: check_cost_ceiling chặn NGAY TỪ ĐẦU trước khi kịp gọi Gemini lần nữa
    mock_gemini_client.generate.reset_mock()
    with pytest.raises(CostLimitExceededError):
        orchestrator.generate(LLMRequest(job_id=job_id, prompt="Prompt 2"))

    mock_gemini_client.generate.assert_not_called()


# ============================================================================
# TC9: Lỗi Gemini / Mất mạng ngoài -> Bắt ngoại lệ gracefully
# ============================================================================
def test_gemini_error_network_loss_handled(orchestrator, mock_local_client, mock_gemini_client):
    mock_local_client.generate.side_effect = LocalLLMConnectionError("Local down")
    mock_gemini_client.generate.side_effect = GeminiAPIError("Mất kết nối Internet tới Google Cloud")

    with pytest.raises(GeminiAPIError) as exc_info:
        orchestrator.generate(LLMRequest(job_id="job-109", prompt="Kiểm thử mất mạng"))

    assert "Mất kết nối Internet" in str(exc_info.value)


# ============================================================================
# TC10: Callback bị lặp (Idempotency Guard) -> Ngăn chặn gửi trùng
# ============================================================================
def test_duplicate_callback_prevented(orchestrator, mock_callback_client):
    response = LLMResponse(
        job_id="job-callback-1",
        text="Kết quả tóm tắt",
        model_name="qwen2.5:7b",
        fallback_used=False,
        input_tokens=100,
        output_tokens=50,
        total_tokens=150,
        processing_time_ms=200,
        estimated_cost_usd=0.0
    )

    job_id = "job-callback-1"
    execution_id = "exec-uuid-999"
    callback_url = "http://backend.internal/api/v1/jobs/callback"

    # Lần 1: Gửi thành công
    first_send = orchestrator.dispatch_usage_callback(
        job_id=job_id,
        execution_id=execution_id,
        response=response,
        callback_url=callback_url
    )
    assert first_send is True
    assert mock_callback_client.send_callback.call_count == 1

    # Lần 2: Gửi lặp lại cùng job_id và execution_id
    second_send = orchestrator.dispatch_usage_callback(
        job_id=job_id,
        execution_id=execution_id,
        response=response,
        callback_url=callback_url
    )
    # Vẫn trả True (coi như hoàn tất thành công) nhưng KHÔNG gọi lại callback_client
    assert second_send is True
    assert mock_callback_client.send_callback.call_count == 1  # Không tăng lên 2


# ============================================================================
# TC11: Tích hợp NLPPipelineOrchestrator với summary & action items
# ============================================================================
def test_nlp_pipeline_orchestrator_integration(orchestrator, mock_local_client):
    mock_local_client.generate.return_value = {
        "text": "- Tóm tắt: Cuộc họp thống nhất kế hoạch Q4.\n- Action Item: Hoàng chuẩn bị hạ tầng trước thứ Sáu.",
        "model_name": "qwen2.5:7b",
        "model_version": "2.5.0",
        "input_tokens": 300,
        "output_tokens": 120,
        "total_tokens": 420,
        "processing_time_ms": 650,
        "estimated_cost_usd": 0.0
    }

    usage_repo = MagicMock()
    pipeline = NLPPipelineOrchestrator(orchestrator=orchestrator, usage_repository=usage_repo)
    result = pipeline.generate_meeting_summary(
        job_id="job-pipeline-1",
        transcript_text="Hoàng: Chúng ta cần chốt kế hoạch Q4...",
        meeting_title="Họp Kế Hoạch Sprint"
    )

    assert result["jobId"] == "job-pipeline-1"
    assert "Cuộc họp thống nhất kế hoạch Q4" in result["summaryText"]
    assert result["aiUsage"]["modelName"] == "qwen2.5:7b"
    assert result["aiUsage"]["fallbackUsed"] is False
    assert result["aiUsage"]["estimatedCostUsd"] == 0.0

    # Usage được ghi vào nhật ký ai_usage
    usage_repo.save.assert_called_once()
    saved = usage_repo.save.call_args.args[0]
    assert saved.job_id == "job-pipeline-1"
    assert saved.model_name == "qwen2.5:7b"
    assert saved.total_tokens == 420
    assert saved.fallback_used is False


def test_pipeline_usage_persistence_failure_does_not_break_summary(orchestrator, mock_local_client):
    mock_local_client.generate.return_value = {
        "text": "OK", "model_name": "qwen2.5:7b", "input_tokens": 1,
        "output_tokens": 1, "total_tokens": 2, "processing_time_ms": 10,
    }
    broken_repo = MagicMock()
    broken_repo.save.side_effect = RuntimeError("disk full")

    pipeline = NLPPipelineOrchestrator(orchestrator=orchestrator, usage_repository=broken_repo)
    result, response = pipeline.run_summary("job-pipeline-2", "transcript")

    assert result["summaryText"] == "OK"
    assert response.job_id == "job-pipeline-2"


def test_usage_callback_payload_is_flat_and_carries_execution_id(orchestrator, mock_callback_client):
    response = LLMResponse(
        job_id="job-cb-flat", text="t", model_name="gemini-1.5-flash", model_version="gemini-1.5",
        fallback_used=True, fallback_reason="LOCAL_TIMEOUT", input_tokens=10, output_tokens=5,
        total_tokens=15, processing_time_ms=120, estimated_cost_usd=0.00002,
    )
    orchestrator.dispatch_usage_callback(
        job_id="job-cb-flat", execution_id="exec-7", response=response,
        callback_url="http://backend/api/v1/jobs/job-cb-flat/ai-usage", internal_token="tok",
    )

    kwargs = mock_callback_client.send_callback.call_args.kwargs
    assert kwargs["execution_id"] == "exec-7"
    assert kwargs["internal_token"] == "tok"
    payload = kwargs["payload"]
    assert payload["jobId"] == "job-cb-flat"
    assert payload["fallbackUsed"] is True
    assert payload["fallbackReason"] == "LOCAL_TIMEOUT"
    assert payload["estimatedCost"] == 0.00002
    assert "aiUsage" not in payload
