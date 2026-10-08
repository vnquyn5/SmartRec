#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

COMPOSE=(
  docker compose
  -f docker-compose.yml
  -f docker-compose.gpu.yml
)

failed=0

pass() {
  echo "[PASS] $1"
}

fail() {
  echo "[FAIL] $1"
  failed=1
}

echo "===================================="
echo " SmartRec GPU Health Check"
echo "===================================="

if docker exec smartrec-redis redis-cli ping \
  2>/dev/null | grep -qx PONG; then
  pass "Redis"
else
  fail "Redis"
fi

if docker exec smartrec-ai-engine python -c '
import urllib.request
import json

with urllib.request.urlopen(
    "http://127.0.0.1:8000/health",
    timeout=10
) as response:
    data = json.load(response)
    assert response.status == 200
    assert data["status"] == "HEALTHY"
' >/dev/null 2>&1; then
  pass "FastAPI"
else
  fail "FastAPI"
fi

if docker exec smartrec-ai-worker python -c '
import torch

assert torch.cuda.is_available()
assert torch.cuda.device_count() > 0

print(torch.cuda.get_device_name(0))
' >/dev/null 2>&1; then
  pass "PyTorch CUDA"
else
  fail "PyTorch CUDA"
fi

if docker exec smartrec-ai-worker \
  celery -A app.celery_app.celery_app \
  inspect ping --timeout=10 \
  2>/dev/null | grep -q pong; then
  pass "Celery Worker"
else
  fail "Celery Worker"
fi

if docker exec smartrec-ai-worker python -c '
import os
from app.services.minio_client import get_minio_client

bucket = os.environ["MINIO_BUCKET"]
client = get_minio_client()

assert client.bucket_exists(bucket)
' >/dev/null 2>&1; then
  pass "MinIO bucket"
else
  fail "MinIO bucket"
fi

if docker exec smartrec-ai-worker python -c '
import os
import requests

url = os.environ["BACKEND_BASE_URL"].rstrip("/") + "/"
response = requests.get(url, timeout=10)

assert response.status_code in (200, 401, 403, 404)
' >/dev/null 2>&1; then
  pass "Backend connectivity"
else
  fail "Backend connectivity"
fi

echo

if [[ "$failed" -eq 0 ]]; then
  echo "SMARTREC GPU SERVICES READY"
else
  echo "SMARTREC GPU CHECK FAILED"
  exit 1
fi
