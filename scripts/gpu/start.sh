#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

COMPOSE=(
  docker compose
  -f docker-compose.yml
  -f docker-compose.gpu.yml
)

if [[ ! -f .env ]]; then
  echo "[FAIL] Missing .env"
  echo "Run: cp .env.gpu.example .env"
  exit 1
fi

# Validate required GPU deployment settings without printing secrets.
required_vars=(
  GPU_TAILSCALE_IP
  BACKEND_BASE_URL
  MINIO_ENDPOINT
  SMARTREC_INTERNAL_TOKEN
  HF_TOKEN
  MINIO_USER
  MINIO_PASSWORD
)

for key in "${required_vars[@]}"; do
  value=$(sed -n "s/^${key}=//p" .env | tail -n 1)

  if [[ -z "$value" || "$value" == "REPLACE_ME" || "$value" == *"100.x.x.x"* ]]; then
    echo "[FAIL] Invalid or missing setting: $key"
    exit 1
  fi
done

echo "[PASS] Required environment settings are configured."

echo "[1/4] Validating Docker Compose..."
"${COMPOSE[@]}" config --quiet

echo "[2/4] Preparing model cache..."
mkdir -p ai-engine/hf-cache

echo "[3/4] Starting Redis, FastAPI and GPU Worker..."
"${COMPOSE[@]}" up -d --no-build \
  redis ai-engine ai-worker

echo "[4/4] Service status:"
"${COMPOSE[@]}" ps redis ai-engine ai-worker

echo
echo "SmartRec GPU services started."
