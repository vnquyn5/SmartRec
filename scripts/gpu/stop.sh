#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

docker compose \
  -f docker-compose.yml \
  -f docker-compose.gpu.yml \
  stop ai-worker ai-engine redis

echo "SmartRec GPU services stopped."
