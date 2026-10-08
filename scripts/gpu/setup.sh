#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "===================================="
echo " SmartRec GPU Environment Setup"
echo "===================================="

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "[INFO] Script này dùng trên GPU Server Linux."
  echo "[INFO] Trên Mac chỉ kiểm tra cú pháp bằng bash -n."
  exit 0
fi

check_command() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "[PASS] $1"
  else
    echo "[FAIL] $1 chưa được cài đặt."
    return 1
  fi
}

failed=0

check_command nvidia-smi || failed=1
check_command docker || failed=1
check_command tailscale || failed=1

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    echo "[PASS] Docker daemon"
  else
    echo "[FAIL] Docker daemon hoặc quyền truy cập Docker"
    failed=1
  fi

  if docker compose version >/dev/null 2>&1; then
    echo "[PASS] Docker Compose"
  else
    echo "[FAIL] Docker Compose plugin"
    failed=1
  fi
fi

if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,memory.total,driver_version \
    --format=csv,noheader
fi

if command -v tailscale >/dev/null 2>&1; then
  if tailscale ip -4 >/dev/null 2>&1; then
    echo "[PASS] Tailscale IP available"
  else
    echo "[FAIL] Tailscale chưa kết nối"
    failed=1
  fi
fi

if [[ "$failed" -ne 0 ]]; then
  echo
  echo "Một số thành phần chưa sẵn sàng."
  echo "Docker: https://docs.docker.com/engine/install/ubuntu/"
  echo "NVIDIA Toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
  echo "Tailscale: https://tailscale.com/kb/1031/install-linux"
  exit 1
fi

echo
echo "Kiểm tra NVIDIA Container Toolkit..."

if ! docker info --format '{{json .Runtimes}}' | grep -q '"nvidia"'; then
  echo "[FAIL] Chưa thấy NVIDIA Docker runtime."
  echo "Cài NVIDIA Container Toolkit, sau đó chạy:"
  echo "sudo nvidia-ctk runtime configure --runtime=docker"
  echo "sudo systemctl restart docker"
  exit 1
fi

echo "[PASS] NVIDIA Docker runtime"

echo
echo "Kiểm tra Docker GPU access..."

if docker run --rm --gpus all \
  nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi; then
  echo "[PASS] GPU available inside Docker"
else
  echo "[FAIL] Docker chưa truy cập được GPU."
  exit 1
fi

echo
echo "SMARTREC GPU ENVIRONMENT READY"
