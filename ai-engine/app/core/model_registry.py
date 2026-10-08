import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Set

logger = logging.getLogger("smartrec.model_registry")


class ModelRegistryError(Exception):
    """Ngoại lệ cơ sở cho Model Registry."""
    pass


class ModelNotFoundError(ModelRegistryError):
    """Ngoại lệ khi không tìm thấy model."""
    pass


class InvalidRegistrySchemaError(ModelRegistryError):
    """Ngoại lệ khi cấu trúc registry không hợp lệ."""
    pass


class ModelRegistry:
    """
    Nguồn cấu hình tập trung quản lý danh sách và trạng thái các model trong AI Engine.
    Hỗ trợ validate kiểu dữ liệu (str) và 5 trường bắt buộc: model_name, version, runtime, device, status.
    Chuẩn hóa status về chữ thường ('enabled' / 'disabled') để đảm bảo tính nhất quán dữ liệu.
    """
    REQUIRED_FIELDS: Set[str] = {"model_name", "version", "runtime", "device", "status"}
    VALID_STATUSES: Set[str] = {"enabled", "disabled"}

    def __init__(self, registry_path: Optional[str] = None):
        if registry_path:
            self.registry_path = Path(registry_path)
        else:
            base_dir = Path(__file__).resolve().parent.parent.parent
            default_path = base_dir / "model_registry.json"
            self.registry_path = default_path if default_path.exists() else Path("model_registry.json")

        self.models: List[Dict[str, Any]] = self._load_and_validate()

    def _validate_model_entry(self, model: Any, idx: Optional[int] = None) -> Dict[str, str]:
        """
        Xác thực cấu trúc, kiểu dữ liệu chuỗi (str) và chuẩn hóa status.
        Trả về dict bản sao đã được làm sạch và chuẩn hóa.
        """
        prefix = f"Model tại vị trí #{idx}" if idx is not None else "Model"
        if not isinstance(model, dict):
            raise InvalidRegistrySchemaError(f"{prefix} không phải là đối tượng JSON (dict).")

        missing = self.REQUIRED_FIELDS - set(model.keys())
        if missing:
            raise InvalidRegistrySchemaError(f"{prefix} thiếu các trường bắt buộc: {missing}")

        cleaned_entry: Dict[str, str] = {}
        for field in self.REQUIRED_FIELDS:
            val = model[field]
            # Bắt buộc kiểu dữ liệu phải thực sự là chuỗi (chống số float 3.1, bool, list)
            if not isinstance(val, str) or isinstance(val, bool):
                raise InvalidRegistrySchemaError(
                    f"{prefix} có trường '{field}' không phải kiểu chuỗi (str). Kiểu nhận được: {type(val).__name__}."
                )

            val_trimmed = val.strip()
            if not val_trimmed:
                raise InvalidRegistrySchemaError(f"{prefix} có giá trị rỗng ở trường '{field}'.")

            cleaned_entry[field] = val_trimmed

        # Chuẩn hóa status về chữ thường đồng nhất
        status_normalized = cleaned_entry["status"].lower()
        if status_normalized not in self.VALID_STATUSES:
            raise InvalidRegistrySchemaError(
                f"Model '{cleaned_entry.get('model_name')}' có status không hợp lệ: '{cleaned_entry['status']}'. "
                f"Giá trị hợp lệ phải là 'enabled' hoặc 'disabled'."
            )
        cleaned_entry["status"] = status_normalized

        # Giữ lại các trường mở rộng nếu có
        for k, v in model.items():
            if k not in cleaned_entry:
                cleaned_entry[k] = v

        return cleaned_entry

    def _load_and_validate(self) -> List[Dict[str, Any]]:
        if not self.registry_path.exists():
            raise ModelRegistryError(f"Không tìm thấy file registry tại: {self.registry_path}")

        try:
            with open(self.registry_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            raise InvalidRegistrySchemaError(f"Lỗi cú pháp JSON trong registry file: {str(e)}") from e

        if not isinstance(data, dict) or "models" not in data:
            raise InvalidRegistrySchemaError("Cấu trúc không hợp lệ: thiếu khóa gốc 'models'.")

        models_list = data["models"]
        if not isinstance(models_list, list):
            raise InvalidRegistrySchemaError("Cấu trúc không hợp lệ: 'models' phải là danh sách (list).")

        validated_list: List[Dict[str, Any]] = []
        for idx, model in enumerate(models_list):
            normalized_model = self._validate_model_entry(model, idx=idx)
            validated_list.append(normalized_model)

        logger.info(f"Đã tải thành công {len(validated_list)} models từ {self.registry_path}")
        return validated_list

    def get_model_by_name(self, model_name: str, version: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Tìm model theo tên (và tùy chọn version)."""
        for m in self.models:
            if m["model_name"] == model_name:
                if version is None or m["version"] == version:
                    return m
        return None

    def get_enabled_models(self) -> List[Dict[str, Any]]:
        """Lọc danh sách các model có trạng thái 'enabled'."""
        return [m for m in self.models if m["status"] == "enabled"]

    def add_model(self, model_dict: Dict[str, Any]) -> None:
        """Bổ sung model mới vào registry kèm schema validation và chuẩn hóa."""
        normalized = self._validate_model_entry(model_dict)
        for idx, existing in enumerate(self.models):
            if existing["model_name"] == normalized["model_name"] and existing["version"] == normalized["version"]:
                self.models[idx] = normalized
                return
        self.models.append(normalized)

    def reload(self) -> None:
        """Đọc lại cấu hình từ file registry."""
        self.models = self._load_and_validate()
