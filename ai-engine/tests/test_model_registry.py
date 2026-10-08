import sys
import json
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.model_registry import (
    ModelRegistry,
    ModelRegistryError,
    InvalidRegistrySchemaError,
)


def test_1_json_syntax_error():
    """1. Kiểm tra JSON syntax lỗi."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir) / "registry.json"
        p.write_text("{ corrupt json syntax ...", encoding="utf-8")
        try:
            ModelRegistry(str(p))
            assert False
        except InvalidRegistrySchemaError as e:
            assert "Lỗi cú pháp JSON" in str(e)


def test_2_and_11_schema_and_missing_required_fields():
    """2 & 11. Kiểm tra schema và các field bắt buộc bị thiếu / sai root."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir) / "registry.json"

        # Sai root key
        p.write_text(json.dumps({"wrong_root": []}), encoding="utf-8")
        try:
            ModelRegistry(str(p))
            assert False
        except InvalidRegistrySchemaError as e:
            assert "thiếu khóa gốc 'models'" in str(e)

        # Root 'models' không phải list
        p.write_text(json.dumps({"models": "not_a_list"}), encoding="utf-8")
        try:
            ModelRegistry(str(p))
            assert False
        except InvalidRegistrySchemaError as e:
            assert "phải là danh sách" in str(e)

        # Thiếu field bắt buộc
        p.write_text(json.dumps({"models": [{"model_name": "m1", "version": "1.0"}]}), encoding="utf-8")
        try:
            ModelRegistry(str(p))
            assert False
        except InvalidRegistrySchemaError as e:
            assert "thiếu các trường bắt buộc" in str(e)


def test_field_types_must_be_strict_string():
    """Kiểm tra validator từ chối các trường có kiểu dữ liệu không phải string (float, bool, dict, list)."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir) / "registry.json"

        # 1. version là float (3.1 thay vì '3.1')
        p.write_text(json.dumps({
            "models": [{
                "model_name": "m1", "version": 3.1, "runtime": "local", "device": "cpu", "status": "enabled"
            }]
        }), encoding="utf-8")
        try:
            ModelRegistry(str(p))
            assert False
        except InvalidRegistrySchemaError as e:
            assert "không phải kiểu chuỗi" in str(e)

        # 2. device là bool (True)
        p.write_text(json.dumps({
            "models": [{
                "model_name": "m1", "version": "1.0", "runtime": "local", "device": True, "status": "enabled"
            }]
        }), encoding="utf-8")
        try:
            ModelRegistry(str(p))
            assert False
        except InvalidRegistrySchemaError as e:
            assert "không phải kiểu chuỗi" in str(e)

        # 3. runtime là list
        p.write_text(json.dumps({
            "models": [{
                "model_name": "m1", "version": "1.0", "runtime": ["local"], "device": "cpu", "status": "enabled"
            }]
        }), encoding="utf-8")
        try:
            ModelRegistry(str(p))
            assert False
        except InvalidRegistrySchemaError as e:
            assert "không phải kiểu chuỗi" in str(e)


def test_status_normalization_and_consistency():
    """Kiểm tra chuẩn hóa status hoa thường ('ENABLED' -> 'enabled') và tính nhất quán khi lọc get_enabled_models()."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir) / "registry.json"
        p.write_text(json.dumps({
            "models": [
                {
                    "model_name": "m-upper",
                    "version": "1.0",
                    "runtime": "local",
                    "device": "cpu",
                    "status": "ENABLED"  # Viết hoa
                },
                {
                    "model_name": "m-mixed",
                    "version": "1.0",
                    "runtime": "local",
                    "device": "cpu",
                    "status": "Disabled"  # Mixed case
                }
            ]
        }), encoding="utf-8")

        reg = ModelRegistry(str(p))
        # Status phải được chuẩn hóa thành lowercase
        assert reg.get_model_by_name("m-upper")["status"] == "enabled"
        assert reg.get_model_by_name("m-mixed")["status"] == "disabled"

        # get_enabled_models() PHẢI tìm thấy m-upper
        enabled_list = reg.get_enabled_models()
        assert len(enabled_list) == 1
        assert enabled_list[0]["model_name"] == "m-upper"


def test_3_single_model():
    """3. Kiểm tra 1 model hợp lệ."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir) / "registry.json"
        p.write_text(json.dumps({
            "models": [{
                "model_name": "pyannote/speaker-diarization-3.1",
                "version": "3.1.0",
                "runtime": "local",
                "device": "cpu",
                "status": "enabled"
            }]
        }), encoding="utf-8")
        reg = ModelRegistry(str(p))
        assert len(reg.models) == 1
        m = reg.get_model_by_name("pyannote/speaker-diarization-3.1")
        assert m is not None


def test_4_multiple_models():
    """4. Kiểm tra nhiều model."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir) / "registry.json"
        p.write_text(json.dumps({
            "models": [
                {"model_name": "m1", "version": "1.0", "runtime": "local", "device": "cpu", "status": "enabled"},
                {"model_name": "m2", "version": "2.0", "runtime": "external_api", "device": "gpu", "status": "disabled"}
            ]
        }), encoding="utf-8")
        reg = ModelRegistry(str(p))
        assert len(reg.models) == 2


def test_version_filtering_in_get_model():
    """Kiểm tra tìm kiếm model theo name và theo cả version cụ thể."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir) / "registry.json"
        p.write_text(json.dumps({
            "models": [
                {"model_name": "whisper", "version": "1.0.0", "runtime": "local", "device": "cpu", "status": "disabled"},
                {"model_name": "whisper", "version": "2.0.0", "runtime": "local", "device": "gpu", "status": "enabled"}
            ]
        }), encoding="utf-8")
        reg = ModelRegistry(str(p))

        # Tìm chỉ theo tên -> trả về bản đầu tiên khớp
        m_any = reg.get_model_by_name("whisper")
        assert m_any["version"] == "1.0.0"

        # Tìm chính xác theo version
        m_v2 = reg.get_model_by_name("whisper", version="2.0.0")
        assert m_v2 is not None
        assert m_v2["device"] == "gpu"
        assert m_v2["status"] == "enabled"

        # Version không tồn tại
        assert reg.get_model_by_name("whisper", version="9.9.9") is None


def test_reload_functionality():
    """Kiểm tra reload() đọc lại chính xác cấu hình mới khi file trên đĩa thay đổi."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir) / "registry.json"
        p.write_text(json.dumps({
            "models": [{"model_name": "m1", "version": "1.0", "runtime": "local", "device": "cpu", "status": "enabled"}]
        }), encoding="utf-8")

        reg = ModelRegistry(str(p))
        assert len(reg.models) == 1

        # Cập nhật file trên đĩa thêm model m2
        p.write_text(json.dumps({
            "models": [
                {"model_name": "m1", "version": "1.0", "runtime": "local", "device": "cpu", "status": "enabled"},
                {"model_name": "m2", "version": "1.0", "runtime": "local", "device": "cpu", "status": "disabled"}
            ]
        }), encoding="utf-8")

        reg.reload()
        assert len(reg.models) == 2
        assert reg.get_model_by_name("m2") is not None


def test_10_add_new_model_dynamically():
    """10. Kiểm tra bổ sung model mới động vào registry và chuẩn hóa status."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir) / "registry.json"
        p.write_text(json.dumps({"models": []}), encoding="utf-8")
        reg = ModelRegistry(str(p))
        assert len(reg.models) == 0

        # Thêm model mới với status chữ hoa
        new_model = {
            "model_name": "whisper-base",
            "version": "1.0",
            "runtime": "local",
            "device": "cpu",
            "status": "ENABLED"
        }
        reg.add_model(new_model)
        assert len(reg.models) == 1
        added = reg.get_model_by_name("whisper-base")
        assert added is not None
        assert added["status"] == "enabled"  # Đã được chuẩn hóa

        # Thêm model với kiểu dữ liệu sai (version là int) -> Bắt lỗi
        try:
            reg.add_model({
                "model_name": "bad", "version": 1, "runtime": "local", "device": "cpu", "status": "enabled"
            })
            assert False
        except InvalidRegistrySchemaError:
            pass


def run_all():
    test_1_json_syntax_error()
    test_2_and_11_schema_and_missing_required_fields()
    test_field_types_must_be_strict_string()
    test_status_normalization_and_consistency()
    test_3_single_model()
    test_4_multiple_models()
    test_version_filtering_in_get_model()
    test_reload_functionality()
    test_10_add_new_model_dynamically()
    print("ALL_ENHANCED_MODEL_REGISTRY_TESTS_EXECUTED_SUCCESSFULLY")


if __name__ == "__main__":
    run_all()
