import pytest
import json
import os
import tempfile
from app.core.model_registry import ModelRegistry, ModelRegistryError

@pytest.fixture
def temp_registry():
    """Fixture to create and clean up a temporary registry JSON file."""
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    yield path
    if os.path.exists(path):
        os.remove(path)

def write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f)

def write_raw(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

# 1. Kiểm tra file JSON có cú pháp hợp lệ
def test_valid_json_syntax(temp_registry):
    valid_data = {
        "models": [{
            "model_name": "test-model",
            "version": "1.0",
            "runtime": "local",
            "device": "cpu",
            "status": "enabled"
        }]
    }
    write_json(temp_registry, valid_data)
    registry = ModelRegistry(temp_registry)
    assert len(registry.models) == 1

# 2. Kiểm tra phát hiện file JSON sai cú pháp
def test_invalid_json_syntax(temp_registry):
    write_raw(temp_registry, "{ 'models': [ missing quotes and bad json ] }")
    with pytest.raises(ModelRegistryError, match="Invalid JSON syntax"):
        ModelRegistry(temp_registry)

# 3. Kiểm tra phát hiện mô hình bị thiếu trường bắt buộc
def test_missing_required_fields(temp_registry):
    data = {
        "models": [{
            "model_name": "test-model",
            "status": "enabled"
            # Missing version, runtime, device
        }]
    }
    write_json(temp_registry, data)
    with pytest.raises(ModelRegistryError, match="missing required fields"):
        ModelRegistry(temp_registry)

# 4. Kiểm tra phát hiện dữ liệu không đúng cấu trúc quy định
def test_invalid_structure(temp_registry):
    # Root is a list instead of dict
    write_json(temp_registry, [{"model_name": "test"}])
    with pytest.raises(ModelRegistryError, match="missing 'models' key at root level"):
        ModelRegistry(temp_registry)

# 5. Kiểm tra đọc thành công danh sách chỉ có một mô hình
def test_read_single_model(temp_registry):
    data = {
        "models": [{
            "model_name": "model-1",
            "version": "1.0",
            "runtime": "local",
            "device": "cpu",
            "status": "enabled"
        }]
    }
    write_json(temp_registry, data)
    registry = ModelRegistry(temp_registry)
    assert len(registry.models) == 1
    assert registry.models[0]["model_name"] == "model-1"

# 6. Kiểm tra đọc thành công danh sách có nhiều mô hình
def test_read_multiple_models(temp_registry):
    data = {
        "models": [
            {
                "model_name": "model-1",
                "version": "1.0",
                "runtime": "local",
                "device": "cpu",
                "status": "enabled"
            },
            {
                "model_name": "model-2",
                "version": "2.0",
                "runtime": "api",
                "device": "gpu",
                "status": "disabled"
            }
        ]
    }
    write_json(temp_registry, data)
    registry = ModelRegistry(temp_registry)
    assert len(registry.models) == 2

# 7. Kiểm tra lấy thông tin mô hình theo tên
def test_get_model_by_name(temp_registry):
    data = {
        "models": [{
            "model_name": "target-model",
            "version": "1.0",
            "runtime": "local",
            "device": "cpu",
            "status": "enabled"
        }]
    }
    write_json(temp_registry, data)
    registry = ModelRegistry(temp_registry)
    model = registry.get_model_by_name("target-model")
    assert model is not None
    assert model["version"] == "1.0"
    
    assert registry.get_model_by_name("non-existent") is None

# 8. Kiểm tra lọc đúng danh sách mô hình có trạng thái enabled
def test_filter_enabled_models(temp_registry):
    data = {
        "models": [
            {
                "model_name": "model-1",
                "version": "1.0",
                "runtime": "local",
                "device": "cpu",
                "status": "enabled"
            },
            {
                "model_name": "model-2",
                "version": "2.0",
                "runtime": "api",
                "device": "gpu",
                "status": "enabled"
            }
        ]
    }
    write_json(temp_registry, data)
    registry = ModelRegistry(temp_registry)
    enabled = registry.get_enabled_models()
    assert len(enabled) == 2

# 9. Kiểm tra không đưa mô hình disabled vào danh sách được phép sử dụng
def test_exclude_disabled_models(temp_registry):
    data = {
        "models": [
            {
                "model_name": "model-1",
                "version": "1.0",
                "runtime": "local",
                "device": "cpu",
                "status": "enabled"
            },
            {
                "model_name": "model-2",
                "version": "2.0",
                "runtime": "api",
                "device": "gpu",
                "status": "disabled"
            }
        ]
    }
    write_json(temp_registry, data)
    registry = ModelRegistry(temp_registry)
    enabled = registry.get_enabled_models()
    assert len(enabled) == 1
    assert enabled[0]["model_name"] == "model-1"

# 10. Kiểm tra khả năng bổ sung mô hình mới vào registry và đọc được thông tin sau khi cập nhật
def test_add_new_model_and_reload(temp_registry):
    data = {
        "models": [{
            "model_name": "model-1",
            "version": "1.0",
            "runtime": "local",
            "device": "cpu",
            "status": "enabled"
        }]
    }
    write_json(temp_registry, data)
    registry = ModelRegistry(temp_registry)
    assert len(registry.models) == 1
    
    # Simulate an external process adding a model to the file
    data["models"].append({
        "model_name": "model-2",
        "version": "2.0",
        "runtime": "api",
        "device": "cpu",
        "status": "disabled"
    })
    write_json(temp_registry, data)
    
    # Reload and verify
    registry.reload()
    assert len(registry.models) == 2
    assert registry.get_model_by_name("model-2") is not None

# 11. Kiểm tra xử lý trường hợp file registry không tồn tại
def test_missing_registry_file():
    missing_path = "does_not_exist_xyz.json"
    if os.path.exists(missing_path):
        os.remove(missing_path)
        
    with pytest.raises(ModelRegistryError, match="Registry file not found"):
        ModelRegistry(missing_path)
