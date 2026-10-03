import sys
import traceback
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.adapters import (
    BaseModelAdapter,
    LocalModelAdapter,
    ExternalApiModelAdapter,
    ModelType,
    ModelStatus,
    ModelAdapterError,
    ModelInitializationError,
    ModelNotReadyError,
    ModelInferenceError,
    ModelConnectionError,
    ModelCleanupError,
)


# ======================================================================
# 1. KIỂM THỬ TÍNH TRỪU TƯỢNG VÀ PROPERTIES READ-ONLY
# ======================================================================

def test_abstract_class_and_readonly_properties():
    try:
        BaseModelAdapter("test-abc", ModelType.LOCAL)
        assert False, "Phải ném TypeError khi khởi tạo BaseModelAdapter trực tiếp"
    except TypeError as e:
        assert "abstract" in str(e).lower()

    class FakePredictor:
        def predict(self, data, **kw): return data

    adapter = LocalModelAdapter("readonly-test", loader_fn=lambda dev: FakePredictor())

    for prop_name, new_val in [
        ("model_name", "hacked-name"),
        ("model_type", ModelType.EXTERNAL_API),
        ("version", "2.0.0"),
        ("status", ModelStatus.READY),
        ("is_ready", True),
    ]:
        try:
            setattr(adapter, prop_name, new_val)
            assert False, f"Thuộc tính '{prop_name}' phải là read-only"
        except AttributeError:
            pass


# ======================================================================
# 2. KIỂM THỬ LOCAL MODEL ADAPTER
# ======================================================================

def test_local_adapter_lifecycle_and_single_loader_call():
    """Kiểm thử loader chỉ được gọi đúng 1 lần khi có lỗi và nạp model nhận device."""
    loader_calls = 0

    def failing_loader(dev):
        nonlocal loader_calls
        loader_calls += 1
        raise RuntimeError("Load weights error inside loader")

    adapter_fail = LocalModelAdapter("local-fail", loader_fn=failing_loader)
    try:
        adapter_fail.load()
        assert False
    except ModelInitializationError:
        assert adapter_fail.status == ModelStatus.ERROR
        assert loader_calls == 1, f"Loader phải được gọi DUY NHẤT 1 lần, thực tế: {loader_calls}"

    class OkPredictor:
        def __init__(self, dev): self.dev = dev
        def predict(self, d, **kw): return f"{d}_on_{self.dev}"

    adapter_ok = LocalModelAdapter("local-ok", loader_fn=lambda dev: OkPredictor(dev), device="cpu")
    adapter_ok.load()
    assert adapter_ok.is_ready
    assert adapter_ok.predict("audio") == "audio_on_cpu"
    adapter_ok.unload()
    assert not adapter_ok.is_ready


# ======================================================================
# 3. KIỂM THỬ EXTERNAL API ADAPTER: STRICT CONTRACT VÀ SECRET SANITIZATION
# ======================================================================

def test_external_api_strict_contract_and_single_factory_call():
    """Client bắt buộc phải có close(); Factory chỉ được gọi 1 lần khi lỗi."""
    factory_calls = 0

    def failing_factory(k, u, t):
        nonlocal factory_calls
        factory_calls += 1
        raise ConnectionRefusedError("Initial connection failed")

    adapter_fail = ExternalApiModelAdapter(
        "api-fail",
        api_key="sk-test",
        client_factory=failing_factory
    )
    try:
        adapter_fail.load()
        assert False
    except ModelInitializationError:
        assert adapter_fail.status == ModelStatus.ERROR
        assert factory_calls == 1, f"client_factory phải được gọi DUY NHẤT 1 lần, thực tế: {factory_calls}"

    class MissingCloseClient:
        def predict(self, d, **kw): return "ok"

    adapter_no_close = ExternalApiModelAdapter(
        "api-no-close",
        api_key="sk-test",
        client_factory=lambda *a: MissingCloseClient()
    )
    try:
        adapter_no_close.load()
        assert False, "Client thiếu close() phải bị từ chối"
    except ModelInitializationError as e:
        assert "close()" in str(e)


def test_external_api_cleanup_failure_handling():
    """unload() ném ModelCleanupError và đặt trạng thái ERROR nếu close() thất bại."""
    class FailingCloseClient:
        def predict(self, d, **kw): return "ok"
        def close(self): raise OSError("Socket cleanup failure")

    adapter = ExternalApiModelAdapter(
        "api-cleanup-fail",
        api_key="sk-test",
        client_factory=lambda *a: FailingCloseClient()
    )
    adapter.load()
    assert adapter.is_ready

    try:
        adapter.unload()
        assert False, "Phải ném ModelCleanupError khi close() thất bại"
    except ModelCleanupError as ce:
        assert adapter.status == ModelStatus.ERROR
        assert "Socket cleanup failure" in str(ce)


def test_external_api_secret_sanitization_in_traceback_cause_and_context():
    """
    Xác nhận tuyệt đối không rò rỉ raw API key trong thông báo, __cause__, __context__ và traceback
    cho cả 3 giai đoạn: predict, load, và unload.
    """
    raw_secret = "sk-live-super-secret-key-ABC123456789XYZ"

    # 1. Kiểm tra rò rỉ trong predict()
    class LeakyInferenceClient:
        def predict(self, d, **kw):
            raise RuntimeError(f"Connection failed for Authorization: Bearer {raw_secret}")
        def close(self): pass

    adapter_infer = ExternalApiModelAdapter(
        "api-leak-predict",
        api_key=raw_secret,
        client_factory=lambda *a: LeakyInferenceClient()
    )
    adapter_infer.load()

    try:
        adapter_infer.predict("payload")
        assert False, "Phải ném ModelInferenceError"
    except ModelInferenceError as err:
        assert raw_secret not in str(err), f"Raw secret lộ trong str(err): {str(err)}"
        assert raw_secret not in repr(err), f"Raw secret lộ trong repr(err): {repr(err)}"
        assert raw_secret not in str(err.__cause__), f"Raw secret lộ trong str(err.__cause__): {str(err.__cause__)}"
        assert raw_secret not in repr(err.__cause__), f"Raw secret lộ trong repr(err.__cause__): {repr(err.__cause__)}"
        assert raw_secret not in str(err.__context__), f"Raw secret lộ trong str(err.__context__): {str(err.__context__)}"
        assert raw_secret not in repr(err.__context__), f"Raw secret lộ trong repr(err.__context__): {repr(err.__context__)}"
        tb_infer = "".join(traceback.format_exception(type(err), err, err.__traceback__))
        assert raw_secret not in tb_infer, f"Raw secret lộ trong traceback:\n{tb_infer}"

        # Xác nhận đã được che giấu đúng chuẩn
        assert "sk-...XYZ" in str(err)
        assert "sk-...XYZ" in str(err.__cause__)

    # 2. Kiểm tra rò rỉ trong load()
    def leaky_load_factory(k, u, t):
        raise ConnectionRefusedError(f"Handshake failed with secret token: {raw_secret}")

    adapter_load = ExternalApiModelAdapter(
        "api-leak-load",
        api_key=raw_secret,
        client_factory=leaky_load_factory
    )
    try:
        adapter_load.load()
        assert False, "Phải ném ModelInitializationError"
    except ModelInitializationError as err:
        assert raw_secret not in str(err)
        assert raw_secret not in repr(err)
        assert raw_secret not in str(err.__cause__)
        assert raw_secret not in repr(err.__cause__)
        assert raw_secret not in str(err.__context__)
        assert raw_secret not in repr(err.__context__)
        tb_load = "".join(traceback.format_exception(type(err), err, err.__traceback__))
        assert raw_secret not in tb_load

    # 3. Kiểm tra rò rỉ trong unload()
    class LeakyCloseClient:
        def predict(self, d, **kw): return "ok"
        def close(self):
            raise OSError(f"Cleanup socket error for key: {raw_secret}")

    adapter_close = ExternalApiModelAdapter(
        "api-leak-close",
        api_key=raw_secret,
        client_factory=lambda *a: LeakyCloseClient()
    )
    adapter_close.load()
    try:
        adapter_close.unload()
        assert False, "Phải ném ModelCleanupError"
    except ModelCleanupError as err:
        assert raw_secret not in str(err)
        assert raw_secret not in repr(err)
        assert raw_secret not in str(err.__cause__)
        assert raw_secret not in repr(err.__cause__)
        assert raw_secret not in str(err.__context__)
        assert raw_secret not in repr(err.__context__)
        tb_close = "".join(traceback.format_exception(type(err), err, err.__traceback__))
        assert raw_secret not in tb_close


def test_external_api_http_status_codes():
    """Kiểm tra phân loại mã lỗi HTTP: 401, 403, 429, 503, 422."""
    class FakeHttpError(Exception):
        def __init__(self, message, status_code):
            super().__init__(message)
            self.status_code = status_code

    def make_adapter(status_code):
        class FailingClient:
            def predict(self, d, **kw): raise FakeHttpError(f"HTTP {status_code} Error", status_code)
            def close(self): pass
        a = ExternalApiModelAdapter(f"api-{status_code}", api_key="sk-valid", client_factory=lambda *a: FailingClient())
        a.load()
        return a

    for code in (401, 403):
        try:
            make_adapter(code).predict("d")
            assert False
        except ModelConnectionError as e:
            assert str(code) in str(e)

    for code in (429, 503):
        try:
            make_adapter(code).predict("d")
            assert False
        except ModelConnectionError as e:
            assert str(code) in str(e)

    try:
        make_adapter(422).predict("d")
        assert False
    except ModelInferenceError as e:
        assert "422" in str(e)


# ======================================================================
# 4. KIỂM THỬ CONTEXT MANAGER AN TOÀN
# ======================================================================

def test_context_manager_behavior():
    class DummyClientOk:
        def __init__(self): self.closed = False
        def predict(self, d, **kw): return "ok"
        def close(self): self.closed = True

    c1 = DummyClientOk()
    adapter1 = ExternalApiModelAdapter("ctx-1", api_key="sk-ok", client_factory=lambda *a: c1)
    try:
        with adapter1:
            raise KeyError("Original body error")
    except KeyError as e:
        assert str(e) == "'Original body error'"
        assert c1.closed

    class DummyClientFail:
        def predict(self, d, **kw): return "ok"
        def close(self): raise OSError("Cleanup crash")

    adapter2 = ExternalApiModelAdapter("ctx-2", api_key="sk-ok", client_factory=lambda *a: DummyClientFail())
    try:
        with adapter2:
            raise ValueError("Original body error should NOT be suppressed")
    except ValueError as e:
        assert str(e) == "Original body error should NOT be suppressed"

    try:
        with adapter2:
            pass
        assert False, "Phải cho ModelCleanupError nổi lên khi thân with chạy êm"
    except ModelCleanupError as ce:
        assert "Cleanup crash" in str(ce)


# ======================================================================
# 5. KIỂM THỬ TÍNH ĐA HÌNH (POLYMORPHISM / DEPENDENCY INVERSION)
# ======================================================================

def execute_pipeline(adapter: BaseModelAdapter, data: Any) -> Any:
    assert isinstance(adapter, BaseModelAdapter)
    if not adapter.is_ready:
        adapter.load()
    return adapter.predict(data)


def test_polymorphic_pipeline():
    class SimpleLocal:
        def predict(self, d, **kw): return f"local_{d}"

    class SimpleApi:
        def predict(self, d, **kw): return f"api_{d}"
        def close(self): pass

    loc = LocalModelAdapter("local", loader_fn=lambda dev: SimpleLocal())
    api = ExternalApiModelAdapter("api", api_key="sk-k", client_factory=lambda *a: SimpleApi())

    assert execute_pipeline(loc, "audio") == "local_audio"
    assert execute_pipeline(api, "audio") == "api_audio"

    loc.unload()
    api.unload()


def run_all():
    test_abstract_class_and_readonly_properties()
    test_local_adapter_lifecycle_and_single_loader_call()
    test_external_api_strict_contract_and_single_factory_call()
    test_external_api_cleanup_failure_handling()
    test_external_api_secret_sanitization_in_traceback_cause_and_context()
    test_external_api_http_status_codes()
    test_context_manager_behavior()
    test_polymorphic_pipeline()


if __name__ == "__main__":
    run_all()
    print("ALL_ENHANCED_MODEL_ADAPTER_TESTS_EXECUTED_SUCCESSFULLY")
