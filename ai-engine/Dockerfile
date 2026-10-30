FROM python:3.11-slim AS ai-runtime-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
COPY requirements_ai.txt .
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
    "torch==2.2.2" "torchaudio==2.2.2" \
    && python -c "import torch, torchaudio; assert torch.version.cuda is None, torch.version.cuda; print('CPU torch', torch.__version__, 'torchaudio', torchaudio.__version__, 'cuda', torch.version.cuda)"

RUN pip install --no-cache-dir -r requirements.txt -r requirements_ai.txt

FROM ai-runtime-base AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-vie tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
