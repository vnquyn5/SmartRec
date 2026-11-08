FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg libsndfile1 libgomp1 libglib2.0-0 libgl1 && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements_ai.txt requirements_ocr.txt ./

# PyTorch CPU - compatible baseline for Pyannote 4.
RUN python -m pip install \
    torch==2.11.0 torchaudio==2.11.0 torchcodec==0.16.0 \
    --index-url https://download.pytorch.org/whl/cpu

# PaddleOCR uses opencv-contrib-python; install only one distribution of cv2.
RUN sed '/^opencv-python-headless==/d' requirements.txt > /tmp/requirements-worker.txt && \
    python -m pip install \
    -r /tmp/requirements-worker.txt -r requirements_ai.txt -r requirements_ocr.txt && \
    python -m pip check && \
    python -c "import torch, pyannote.audio, paddleocr, cv2, skimage; assert torch.version.cuda is None"

COPY app ./app
COPY model_registry.json ./model_registry.json

EXPOSE 8000

CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000"]
