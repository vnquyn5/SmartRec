from dataclasses import dataclass
from typing import Any, Mapping, Optional


@dataclass(frozen=True)
class TokenUsage:
    input_tokens: Optional[int]
    output_tokens: Optional[int]
    total_tokens: Optional[int]
    source: str


class TokenCounter:
    """Normalize provider supplied token metadata without guessing token counts."""

    _ALIASES = {
        "input": ("promptTokenCount", "prompt_token_count", "prompt_eval_count", "input_tokens", "prompt_tokens"),
        "output": ("candidatesTokenCount", "candidates_token_count", "eval_count", "output_tokens", "completion_tokens"),
        "total": ("totalTokenCount", "total_token_count", "total_tokens"),
    }

    @classmethod
    def read(cls, response: Any) -> TokenUsage:
        usage = cls._get(response, "usage")
        source = "provider_metadata"
        if usage is None:
            usage = cls._get(response, "usageMetadata")
            source = "gemini_metadata"
        if usage is None:
            usage = cls._get(response, "usage_metadata")
            source = "gemini_metadata"
        if usage is None:
            # Ollama exposes token counts on the response itself.
            usage = response
            source = "ollama_metadata"

        values = {
            key: cls._read_count(usage, aliases)
            for key, aliases in cls._ALIASES.items()
        }
        if all(value is None for value in values.values()):
            return TokenUsage(None, None, None, "unavailable")

        if values["total"] is None and values["input"] is not None and values["output"] is not None:
            values["total"] = values["input"] + values["output"]
        return TokenUsage(values["input"], values["output"], values["total"], source)

    @staticmethod
    def _get(value: Any, key: str) -> Any:
        if isinstance(value, Mapping):
            return value.get(key)
        return getattr(value, key, None)

    @classmethod
    def _read_count(cls, metadata: Any, aliases: tuple[str, ...]) -> Optional[int]:
        for key in aliases:
            value = cls._get(metadata, key)
            if value is None:
                continue
            try:
                count = int(value)
            except (TypeError, ValueError):
                continue
            if count >= 0:
                return count
        return None
