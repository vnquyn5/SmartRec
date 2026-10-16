# -*- coding: utf-8 -*-
"""
SmartRec System & Cloud GPU Monitor
Giám sát trạng thái Cloud GPU (Tesla T4) và hệ thống Docker Backend từ Terminal VSCode.
Cách dùng:
    python monitor.py          (xem 1 lần)
    python monitor.py --watch  (tự động làm mới liên tục mỗi 3 giây)
"""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

# Force UTF-8 for Windows PowerShell terminal output
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

try:
    import requests
except ImportError:
    print("Vui long cai dat requests: pip install requests")
    sys.exit(1)


# ANSI Color Codes
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def load_env() -> dict:
    env_vars = {}
    env_path = Path(__file__).resolve().parent / ".env"
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip()
    return env_vars


def get_gpu_url(env_vars: dict) -> str:
    gist_id = env_vars.get("CLOUD_GPU_REGISTRY_GIST_ID", "").strip()
    if gist_id:
        try:
            resp = requests.get(
                f"https://api.github.com/gists/{gist_id}",
                headers={"Accept": "application/vnd.github+json", "User-Agent": "smartrec-monitor"},
                timeout=5,
            )
            if resp.status_code == 200:
                files = resp.json().get("files") or {}
                entry = files.get("gpu_url.txt") or next(iter(files.values()), None)
                content = ((entry or {}).get("content") or "").strip()
                if content.startswith("https://"):
                    return content.rstrip("/")
        except Exception:
            pass
    return env_vars.get("CLOUD_GPU_URL", "").strip().rstrip("/")


def make_bar(percent: float, length: int = 20) -> str:
    filled = int(length * percent / 100.0)
    filled = max(0, min(length, filled))
    bar = "█" * filled + "░" * (length - filled)
    if percent > 85:
        color = RED
    elif percent > 60:
        color = YELLOW
    else:
        color = GREEN
    return f"{color}[{bar}]{RESET}"


def fetch_gpu_info(base_url: str) -> dict:
    if not base_url:
        return {"status": "NO_URL"}

    headers = {"ngrok-skip-browser-warning": "true"}
    started = time.perf_counter()

    # Thử gọi /stats (chi tiết RAM/GPU/Disk)
    try:
        resp = requests.get(f"{base_url}/stats", headers=headers, timeout=5)
        latency = round((time.perf_counter() - started) * 1000, 1)
        if resp.status_code == 200:
            data = resp.json()
            data["latency_ms"] = latency
            data["type"] = "detailed"
            return data
    except Exception:
        pass

    # Fallback sang /health nếu /stats chưa có
    started = time.perf_counter()
    try:
        resp = requests.get(f"{base_url}/health", headers=headers, timeout=5)
        latency = round((time.perf_counter() - started) * 1000, 1)
        if resp.status_code == 200:
            data = resp.json()
            data["latency_ms"] = latency
            data["type"] = "basic"
            return data
    except Exception as e:
        return {"status": "ERROR", "error": str(e)}

    return {"status": "OFFLINE"}


def get_docker_containers() -> list:
    try:
        cmd = ["docker", "ps", "-a", "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}"]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        containers = []
        for line in res.stdout.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("\t")
            name = parts[0]
            if name.startswith("smartrec-"):
                status = parts[1] if len(parts) > 1 else ""
                ports = parts[2] if len(parts) > 2 else ""
                containers.append({"name": name, "status": status, "ports": ports})
        return containers
    except Exception:
        return []


def render_dashboard(env_vars: dict, gpu_url: str):
    gpu_data = fetch_gpu_info(gpu_url)
    containers = get_docker_containers()

    print(f"\n{BOLD}{CYAN}========================================================================{RESET}")
    print(f"{BOLD}{CYAN}             SMARTREC SYSTEM & CLOUD GPU MONITOR{RESET}")
    print(f"{DIM}             Thời gian: {time.strftime('%Y-%m-%d %H:%M:%S')}{RESET}")
    print(f"{BOLD}{CYAN}========================================================================{RESET}")

    # --- CLOUD GPU SECTION ---
    print(f"\n{BOLD}⚡ [CLOUD GPU SERVER - GOOGLE COLAB]{RESET}")
    if not gpu_url:
        print(f"  {RED}Chưa cấu hình URL Cloud GPU hoặc Gist ID trong .env{RESET}")
    elif gpu_data.get("status") in ["ERROR", "OFFLINE"]:
        print(f"  Trạng thái : {RED}● OFFLINE / KHÔNG PHẢN HỒI{RESET}")
        print(f"  URL        : {DIM}{gpu_url}{RESET}")
        if gpu_data.get("error"):
            print(f"  Lỗi        : {RED}{gpu_data.get('error')}{RESET}")
        print(f"  {YELLOW}👉 Hãy mở Google Colab và bấm Run lại ô code server.{RESET}")
    else:
        latency = gpu_data.get("latency_ms", 0)
        device = gpu_data.get("device", "cuda")
        print(f"  Trạng thái : {GREEN}● ONLINE{RESET} (Phản hồi: {CYAN}{latency}ms{RESET})")
        print(f"  Thiết bị   : {BOLD}{device.upper()}{RESET}")
        print(f"  URL        : {CYAN}{gpu_url}{RESET}")

        if gpu_data.get("type") == "detailed":
            # GPU RAM
            gpu = gpu_data.get("gpu_ram") or {}
            if gpu:
                pct = gpu.get("percent", 0)
                used = gpu.get("used_gb", 0)
                tot = gpu.get("total_gb", 0)
                name = gpu.get("name", "NVIDIA GPU")
                bar = make_bar(pct)
                print(f"  GPU ({name}) : {bar} {used:.1f} / {tot:.1f} GB ({pct}%)")

            # System RAM
            sram = gpu_data.get("system_ram") or {}
            if sram:
                pct = sram.get("percent", 0)
                used = sram.get("used_gb", 0)
                tot = sram.get("total_gb", 0)
                bar = make_bar(pct)
                print(f"  System RAM : {bar} {used:.1f} / {tot:.1f} GB ({pct}%)")

            # Disk
            dsk = gpu_data.get("disk") or {}
            if dsk:
                pct = dsk.get("percent", 0)
                used = dsk.get("used_gb", 0)
                tot = dsk.get("total_gb", 0)
                bar = make_bar(pct)
                print(f"  Disk       : {bar} {used:.1f} / {tot:.1f} GB ({pct}%)")
        else:
            print(f"  Model      : {GREEN}Đã nạp sẵn sàng trên {device}{RESET}")
            print(f"  {DIM}(Mẹo: Thêm endpoint /stats trên Colab để hiển thị System RAM & GPU RAM real-time){RESET}")

    # --- DOCKER CONTAINERS SECTION ---
    print(f"\n{BOLD}🐳 [HỆ THỐNG DOCKER LOCAL]{RESET}")
    if not containers:
        print(f"  {YELLOW}Không tìm thấy container smartrec nào đang chạy qua docker ps.{RESET}")
    else:
        for c in sorted(containers, key=lambda x: x["name"]):
            name = c["name"]
            st = c["status"]
            if st.startswith("Up"):
                st_color = GREEN
                icon = "●"
            elif "Restarting" in st:
                st_color = YELLOW
                icon = "▲"
            else:
                st_color = RED
                icon = "■"

            ports = f"({c['ports']})" if c["ports"] else ""
            print(f"  {st_color}{icon}{RESET} {name:<22} : {st_color}{st}{RESET} {DIM}{ports}{RESET}")

    print(f"\n{BOLD}{CYAN}========================================================================{RESET}")


def main():
    parser = argparse.ArgumentParser(description="SmartRec System & Cloud GPU Monitor")
    parser.add_argument("-w", "--watch", action="store_true", help="Tự động làm mới liên tục")
    parser.add_argument("-i", "--interval", type=int, default=3, help="Thời gian làm mới (giây), mặc định 3s")
    args = parser.parse_args()

    env_vars = load_env()
    gpu_url = get_gpu_url(env_vars)

    if not args.watch:
        render_dashboard(env_vars, gpu_url)
        return

    print(f"Bắt đầu giám sát real-time (cập nhật mỗi {args.interval}s). Nhấn Ctrl+C để thoát.\n")
    try:
        while True:
            # Clear terminal screen
            os.system("cls" if os.name == "nt" else "clear")
            # Cập nhật lại URL nếu Gist đổi
            gpu_url = get_gpu_url(env_vars)
            render_dashboard(env_vars, gpu_url)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nĐã dừng giám sát.")


if __name__ == "__main__":
    main()
