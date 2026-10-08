#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

docker compose \
  -f docker-compose.yml \
  -f docker-compose.gpu.yml \
  logs -f --tail=100 ai-engine ai-worker
