from app.tracking.token_counter import TokenCounter


def test_reads_ollama_usage_metadata():
    usage = TokenCounter.read({"prompt_eval_count": 12, "eval_count": 7})
    assert (usage.input_tokens, usage.output_tokens, usage.total_tokens) == (12, 7, 19)
    assert usage.source == "ollama_metadata"


def test_reads_gemini_usage_metadata():
    camel_case = TokenCounter.read({"usageMetadata": {
        "promptTokenCount": 20,
        "candidatesTokenCount": 8,
        "totalTokenCount": 28,
    }})
    snake_case = TokenCounter.read({"usage_metadata": {
        "prompt_token_count": 20,
        "candidates_token_count": 8,
        "total_token_count": 28,
    }})

    for usage in (camel_case, snake_case):
        assert (usage.input_tokens, usage.output_tokens, usage.total_tokens) == (20, 8, 28)
        assert usage.source == "gemini_metadata"


def test_reads_openai_style_usage_metadata():
    usage = TokenCounter.read({"usage": {"input_tokens": 4, "output_tokens": 3}})
    assert (usage.input_tokens, usage.output_tokens, usage.total_tokens) == (4, 3, 7)
    assert usage.source == "provider_metadata"


def test_missing_or_null_counts_are_not_guessed():
    assert TokenCounter.read({"text": "model output"}) == TokenCounter.read({})
    usage = TokenCounter.read({"usage": {"input_tokens": None, "output_tokens": None}})
    assert usage.input_tokens is None
    assert usage.output_tokens is None
    assert usage.total_tokens is None
    assert usage.source == "unavailable"


def test_preserves_partial_counts_without_fabricating_missing_side():
    usage = TokenCounter.read({"usage": {"input_tokens": 5, "output_tokens": None}})
    assert usage.input_tokens == 5
    assert usage.output_tokens is None
    assert usage.total_tokens is None
