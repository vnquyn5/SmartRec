import json
import os
import logging

logger = logging.getLogger(__name__)

class ModelRegistryError(Exception):
    pass

class ModelRegistry:
    REQUIRED_FIELDS = {"model_name", "version", "runtime", "device", "status"}
    VALID_STATUSES = {"enabled", "disabled"}

    def __init__(self, registry_path='model_registry.json'):
        self.registry_path = registry_path
        self.models = self._load_and_validate()

    def _load_and_validate(self):
        if not os.path.exists(self.registry_path):
            raise ModelRegistryError(f"Registry file not found at {self.registry_path}")

        try:
            with open(self.registry_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            raise ModelRegistryError(f"Invalid JSON syntax in registry file: {e}")

        if not isinstance(data, dict) or "models" not in data:
            raise ModelRegistryError("Invalid structure: missing 'models' key at root level.")

        models_list = data["models"]
        if not isinstance(models_list, list):
            raise ModelRegistryError("Invalid structure: 'models' must be a list.")

        for idx, model in enumerate(models_list):
            if not isinstance(model, dict):
                raise ModelRegistryError(f"Model at index {idx} is not a dictionary.")
            
            missing_fields = self.REQUIRED_FIELDS - set(model.keys())
            if missing_fields:
                raise ModelRegistryError(f"Model at index {idx} is missing required fields: {missing_fields}")
            
            if model["status"] not in self.VALID_STATUSES:
                raise ModelRegistryError(f"Model '{model['model_name']}' has invalid status '{model['status']}'. Must be 'enabled' or 'disabled'.")

        return models_list

    def get_model_by_name(self, model_name):
        """Find and return model info based on model_name."""
        for model in self.models:
            if model["model_name"] == model_name:
                return model
        return None

    def get_enabled_models(self):
        """Return list of models with 'enabled' status."""
        return [model for model in self.models if model["status"] == "enabled"]

    def reload(self):
        """Reload models from the registry file."""
        self.models = self._load_and_validate()
