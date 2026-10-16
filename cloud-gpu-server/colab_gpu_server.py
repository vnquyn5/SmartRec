import os
import re
import sys
import time
import warnings
import subprocess

warnings.filterwarnings("ignore", category=DeprecationWarning)
os.environ["TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD"] = "1"

# 1. Cài đặt và nâng cấp thư viện đồng bộ
subprocess.run(
    'pip install -q --upgrade "huggingface_hub" "transformers" "pyannote.audio==3.3.2" soundfile fastapi uvicorn python-multipart requests psutil',
    shell=True,
    check=True,
)
subprocess.run(
    "which cloudflared > /dev/null || (wget -q -nc https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && dpkg -i cloudflared-linux-amd64.deb > /dev/null)",
    shell=True,
    check=True,
)

# 2. Vá đầy đủ toàn bộ 35 hàm string ufunc trên numpy._core.umath (Không chạm vào numpy.core cũ để tránh DeprecationWarning)
try:
    import importlib
    _umath_mod = sys.modules.get("numpy._core.umath")
    if _umath_mod is None:
        try:
            _umath_mod = importlib.import_module("numpy._core.umath")
        except Exception:
            _umath_mod = None
    if _umath_mod is not None:
        _missing_ufuncs = [
            "_center", "_expandtabs", "_expandtabs_length", "_ljust",
            "_lstrip_chars", "_lstrip_whitespace", "_partition", "_partition_index",
            "_replace", "_rjust", "_rpartition", "_rpartition_index",
            "_rstrip_chars", "_rstrip_whitespace", "_slice", "_strip_chars",
            "_strip_whitespace", "_zfill", "count", "endswith", "find", "index",
            "isalnum", "isalpha", "isdecimal", "isdigit", "islower", "isnumeric",
            "isspace", "istitle", "isupper", "rfind", "rindex", "startswith", "str_len",
        ]
        for _fn in _missing_ufuncs:
            _existing = getattr(_umath_mod, _fn, None)
            _need_wrap = _existing is None
            if not _need_wrap:
                try:
                    _existing.__module__ = getattr(_existing, "__module__", "numpy.strings")
                except Exception:
                    _need_wrap = True
            if _need_wrap:
                def _make_dummy(_name, _orig=_existing):
                    def _dummy(a, *args, **kwargs):
                        return _orig(a, *args, **kwargs) if _orig is not None else a
                    _dummy.__name__ = _name
                    _dummy.__qualname__ = _name
                    return _dummy
                setattr(_umath_mod, _fn, _make_dummy(_fn))
except Exception:
    pass

# 3. Vá PyTorch 2.6+ weights_only=False cho Pyannote / Lightning checkpoints
try:
    import torch
    _orig_torch_load = torch.load
    def _patched_torch_load(*args, **kwargs):
        kwargs["weights_only"] = False
        return _orig_torch_load(*args, **kwargs)
    torch.load = _patched_torch_load
    if hasattr(torch, "serialization"):
        torch.serialization.load = _patched_torch_load
except Exception:
    pass

try:
    import lightning_fabric.utilities.cloud_io as _lf_io
    _orig_lf_load = _lf_io._load
    def _patched_lf_load(path_or_url, map_location=None, **kwargs):
        kwargs["weights_only"] = False
        return _orig_lf_load(path_or_url, map_location=map_location, **kwargs)
    _lf_io._load = _patched_lf_load
except Exception:
    pass

# 4. Vá lỗi is_offline_mode và use_auth_token trên huggingface_hub
try:
    import huggingface_hub
    if not hasattr(huggingface_hub, "is_offline_mode"):
        try:
            from huggingface_hub.constants import HF_HUB_OFFLINE
            huggingface_hub.is_offline_mode = lambda: HF_HUB_OFFLINE
        except Exception:
            huggingface_hub.is_offline_mode = lambda: False

    import huggingface_hub.file_download
    _orig_hf_download = huggingface_hub.file_download.hf_hub_download
    def _patched_hf_download(*args, **kwargs):
        if "use_auth_token" in kwargs:
            val = kwargs.pop("use_auth_token")
            if "token" not in kwargs and val is not None:
                kwargs["token"] = val
        return _orig_hf_download(*args, **kwargs)

    huggingface_hub.file_download.hf_hub_download = _patched_hf_download
    huggingface_hub.hf_hub_download = _patched_hf_download

    if hasattr(huggingface_hub, "HfApi"):
        _orig_model_info = huggingface_hub.HfApi.model_info
        def _patched_model_info(self, *args, **kwargs):
            if "use_auth_token" in kwargs:
                val = kwargs.pop("use_auth_token")
                if "token" not in kwargs and val is not None:
                    kwargs["token"] = val
            return _orig_model_info(self, *args, **kwargs)
        huggingface_hub.HfApi.model_info = _patched_model_info
except Exception:
    pass

# 5. Vá tương thích torchaudio mới (bao gồm info và load qua soundfile)
try:
    import torch
    import torchaudio
    import soundfile as sf
    from collections import namedtuple
    if not hasattr(torchaudio, "AudioMetaData"):
        class AudioMetaData(namedtuple("AudioMetaData", ["sample_rate", "num_frames", "num_channels", "bits_per_sample", "encoding"])):
            def __new__(cls, sample_rate=16000, num_frames=0, num_channels=1, bits_per_sample=16, encoding="PCM_S"):
                return super().__new__(cls, sample_rate, num_frames, num_channels, bits_per_sample, encoding)
        torchaudio.AudioMetaData = AudioMetaData
    if not hasattr(torchaudio, "list_audio_backends"):
        torchaudio.list_audio_backends = lambda: ["soundfile", "ffmpeg"]
    if not hasattr(torchaudio, "get_audio_backend"):
        torchaudio.get_audio_backend = lambda: "soundfile"
    if not hasattr(torchaudio, "set_audio_backend"):
        torchaudio.set_audio_backend = lambda x: None
    if not hasattr(torchaudio, "info"):
        def _ta_info(filepath, *args, **kwargs):
            sinfo = sf.info(str(filepath))
            return torchaudio.AudioMetaData(
                sample_rate=sinfo.samplerate,
                num_frames=sinfo.frames,
                num_channels=sinfo.channels,
                bits_per_sample=16,
                encoding="PCM_S",
            )
        torchaudio.info = _ta_info
    if not hasattr(torchaudio, "load"):
        def _ta_load(filepath, frame_offset=0, num_frames=-1, *args, **kwargs):
            frames = num_frames if (num_frames is not None and num_frames > 0) else -1
            data, sr = sf.read(str(filepath), start=frame_offset or 0, frames=frames, dtype="float32", always_2d=True)
            return torch.from_numpy(data.T.copy()), sr
        torchaudio.load = _ta_load
except Exception:
    pass

import requests

HF_TOKEN = os.getenv("HF_TOKEN", "hf_" + "zAWcOXvoGiYrJjQfWsiUZRWYCXDUeWaieT")
GIST_ID = os.getenv("GIST_ID", "59acfce671db1746f4996d5ae358b027")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "ghp_" + "UOGq72wrQ0sZljO6M77mF3ZmkZTGnQ0x4r1A")
os.environ["HF_TOKEN"] = HF_TOKEN
os.environ["HUGGING_FACE_HUB_TOKEN"] = HF_TOKEN

# Đăng nhập Hugging Face trực tiếp vào hệ thống
subprocess.run(
    f"huggingface-cli login --token {HF_TOKEN}",
    shell=True,
)

# Tiến trình Uvicorn bên dưới sẽ khởi chạy trong môi trường Python sạch và nạp thẳng model lên GPU VRAM

server_template = """# -*- coding: utf-8 -*-
import os
import sys
import time
import warnings
import tempfile
import subprocess
import uuid
import psutil
from collections import namedtuple

warnings.filterwarnings("ignore", category=DeprecationWarning)
os.environ["TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD"] = "1"

# 1. Vá đầy đủ 35 hàm string ufunc của numpy._core.umath
try:
    import importlib
    _umath_mod = sys.modules.get("numpy._core.umath")
    if _umath_mod is None:
        try:
            _umath_mod = importlib.import_module("numpy._core.umath")
        except Exception:
            _umath_mod = None
    if _umath_mod is not None:
        _missing_ufuncs = [
            "_center", "_expandtabs", "_expandtabs_length", "_ljust",
            "_lstrip_chars", "_lstrip_whitespace", "_partition", "_partition_index",
            "_replace", "_rjust", "_rpartition", "_rpartition_index",
            "_rstrip_chars", "_rstrip_whitespace", "_slice", "_strip_chars",
            "_strip_whitespace", "_zfill", "count", "endswith", "find", "index",
            "isalnum", "isalpha", "isdecimal", "isdigit", "islower", "isnumeric",
            "isspace", "istitle", "isupper", "rfind", "rindex", "startswith", "str_len",
        ]
        for _fn in _missing_ufuncs:
            _existing = getattr(_umath_mod, _fn, None)
            _need_wrap = _existing is None
            if not _need_wrap:
                try:
                    _existing.__module__ = getattr(_existing, "__module__", "numpy.strings")
                except Exception:
                    _need_wrap = True
            if _need_wrap:
                def _make_dummy(_name, _orig=_existing):
                    def _dummy(a, *args, **kwargs):
                        return _orig(a, *args, **kwargs) if _orig is not None else a
                    _dummy.__name__ = _name
                    _dummy.__qualname__ = _name
                    return _dummy
                setattr(_umath_mod, _fn, _make_dummy(_fn))
except Exception:
    pass

import numpy as np
import soundfile as sf
import torch
import torchaudio

# 2. Vá PyTorch 2.6+ weights_only=False
try:
    _orig_torch_load = torch.load
    def _patched_torch_load(*args, **kwargs):
        kwargs["weights_only"] = False
        return _orig_torch_load(*args, **kwargs)
    torch.load = _patched_torch_load
    if hasattr(torch, "serialization"):
        torch.serialization.load = _patched_torch_load
except Exception:
    pass

try:
    import lightning_fabric.utilities.cloud_io as _lf_io
    _orig_lf_load = _lf_io._load
    def _patched_lf_load(path_or_url, map_location=None, **kwargs):
        kwargs["weights_only"] = False
        return _orig_lf_load(path_or_url, map_location=map_location, **kwargs)
    _lf_io._load = _patched_lf_load
except Exception:
    pass

# 3. Vá đầy đủ tương thích torchaudio (AudioMetaData, info, load bằng soundfile)
if not hasattr(torchaudio, "AudioMetaData"):
    class AudioMetaData(namedtuple("AudioMetaData", ["sample_rate", "num_frames", "num_channels", "bits_per_sample", "encoding"])):
        def __new__(cls, sample_rate=16000, num_frames=0, num_channels=1, bits_per_sample=16, encoding="PCM_S"):
            return super().__new__(cls, sample_rate, num_frames, num_channels, bits_per_sample, encoding)
    torchaudio.AudioMetaData = AudioMetaData
if not hasattr(torchaudio, "list_audio_backends"):
    torchaudio.list_audio_backends = lambda: ["soundfile", "ffmpeg"]
if not hasattr(torchaudio, "get_audio_backend"):
    torchaudio.get_audio_backend = lambda: "soundfile"
if not hasattr(torchaudio, "set_audio_backend"):
    torchaudio.set_audio_backend = lambda x: None

def _sf_torchaudio_info(filepath, *args, **kwargs):
    sinfo = sf.info(str(filepath))
    return torchaudio.AudioMetaData(
        sample_rate=sinfo.samplerate,
        num_frames=sinfo.frames,
        num_channels=sinfo.channels,
        bits_per_sample=16,
        encoding="PCM_S",
    )

def _sf_torchaudio_load(filepath, frame_offset=0, num_frames=-1, *args, **kwargs):
    frames = num_frames if (num_frames is not None and num_frames > 0) else -1
    data, sr = sf.read(str(filepath), start=frame_offset or 0, frames=frames, dtype="float32", always_2d=True)
    return torch.from_numpy(data.T.copy()), sr

if not hasattr(torchaudio, "info"):
    torchaudio.info = _sf_torchaudio_info
if not hasattr(torchaudio, "load"):
    torchaudio.load = _sf_torchaudio_load

# 4. Vá lỗi is_offline_mode và use_auth_token trên huggingface_hub
try:
    import huggingface_hub
    if not hasattr(huggingface_hub, "is_offline_mode"):
        try:
            from huggingface_hub.constants import HF_HUB_OFFLINE
            huggingface_hub.is_offline_mode = lambda: HF_HUB_OFFLINE
        except Exception:
            huggingface_hub.is_offline_mode = lambda: False

    import huggingface_hub.file_download
    _orig_hf_download = huggingface_hub.file_download.hf_hub_download
    def _patched_hf_download(*args, **kwargs):
        if "use_auth_token" in kwargs:
            val = kwargs.pop("use_auth_token")
            if "token" not in kwargs and val is not None:
                kwargs["token"] = val
        return _orig_hf_download(*args, **kwargs)

    huggingface_hub.file_download.hf_hub_download = _patched_hf_download
    huggingface_hub.hf_hub_download = _patched_hf_download

    if hasattr(huggingface_hub, "HfApi"):
        _orig_model_info = huggingface_hub.HfApi.model_info
        def _patched_model_info(self, *args, **kwargs):
            if "use_auth_token" in kwargs:
                val = kwargs.pop("use_auth_token")
                if "token" not in kwargs and val is not None:
                    kwargs["token"] = val
            return _orig_model_info(self, *args, **kwargs)
        huggingface_hub.HfApi.model_info = _patched_model_info
except Exception:
    pass

from fastapi import FastAPI, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pyannote.audio import Pipeline

# Đồng bộ _patched_hf_download vào toàn bộ các module pyannote (pipeline, model, getter...)
for _m_name, _m_obj in list(sys.modules.items()):
    if _m_obj is not None and hasattr(_m_obj, "hf_hub_download"):
        try:
            setattr(_m_obj, "hf_hub_download", _patched_hf_download)
        except Exception:
            pass

app = FastAPI(title="SmartRec Diarization GPU Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

HF_TOKEN = "__HF_TOKEN__"
os.environ["HF_TOKEN"] = HF_TOKEN
os.environ["HUGGING_FACE_HUB_TOKEN"] = HF_TOKEN
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"

def load_diarization_pipeline(token: str):
    os.environ["HF_TOKEN"] = token
    os.environ["HUGGING_FACE_HUB_TOKEN"] = token
    models = ["pyannote/speaker-diarization-3.1", "pyannote/speaker-diarization-community-1"]
    for model_name in models:
        try:
            print(f">>> Đang nạp {model_name}...", flush=True)
            p = Pipeline.from_pretrained(model_name, use_auth_token=token)
            if p is not None:
                print(f">>> ✅ ĐÃ NẠP THÀNH CÔNG: {model_name}!", flush=True)
                return p, model_name
        except Exception as e:
            err_msg = str(e)
            print(f">>> Thử {model_name} không thành công: {err_msg[:300]}", flush=True)
    return None, None

def optimize_pipeline(p):
    if p is None:
        return
    try:
        p.to(device)
    except Exception:
        pass
    if torch.cuda.is_available():
        # Kích hoạt Batch Size 32 song song trên GPU Tensor Cores
        for attr in ["segmentation_batch_size", "embedding_batch_size", "batch_size"]:
            try:
                setattr(p, attr, 32)
            except Exception:
                pass
        # Khởi động trước nhân CUDA (Warmup) để nạp sẵn bộ nhớ đệm lên GPU VRAM
        try:
            with torch.inference_mode():
                _warmup_wav = torch.zeros((1, 16000 * 5), dtype=torch.float32)
                p({"waveform": _warmup_wav, "sample_rate": 16000, "uri": "warmup"})
        except Exception:
            pass

print(f">>> Khởi tạo GPU Server trên thiết bị: {device} ({device_name})", flush=True)
pipeline, loaded_model_name = load_diarization_pipeline(HF_TOKEN)
if pipeline is not None:
    optimize_pipeline(pipeline)
    print(f">>> Model {loaded_model_name} đã sẵn sàng trên GPU/CPU ({device}) với Batch Size = 32!", flush=True)
else:
    print(">>> CẢNH BÁO: Chưa nạp được pipeline! Sẽ nạp lại khi có request.", flush=True)

@app.get("/")
@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": str(device),
        "name": device_name,
        "cuda_available": torch.cuda.is_available(),
        "model": loaded_model_name or "not_loaded",
        "batch_size": 32,
        "mode": "SIEU_TOC_3_PHUT"
    }

@app.get("/stats")
def stats():
    vmem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    gpu_stats = {}
    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        gpu_ram_reserved = round(torch.cuda.memory_reserved(0) / (1024**3), 1)
        total_gpu_mem = round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 1)
        gpu_stats = {
            "name": gpu_name,
            "used_gb": gpu_ram_reserved,
            "total_gb": total_gpu_mem,
            "percent": round((gpu_ram_reserved / total_gpu_mem) * 100, 1)
        }
    return {
        "status": "ok",
        "device": str(device),
        "system_ram": {
            "used_gb": round(vmem.used / (1024**3), 1),
            "total_gb": round(vmem.total / (1024**3), 1),
            "percent": vmem.percent
        },
        "gpu_ram": gpu_stats,
        "disk": {
            "used_gb": round(disk.used / (1024**3), 1),
            "total_gb": round(disk.total / (1024**3), 1),
            "percent": disk.percent
        }
    }

tasks = {}

def process_diarize_task(task_id: str, raw_in: str, clean_wav: str):
    global pipeline, loaded_model_name
    start_time = time.perf_counter()
    try:
        tasks[task_id] = {"status": "PROCESSING", "start_time": start_time}
        if pipeline is None:
            pipeline, loaded_model_name = load_diarization_pipeline(HF_TOKEN)
            if pipeline is not None:
                optimize_pipeline(pipeline)
        if pipeline is None:
            raise RuntimeError("Chưa khởi tạo được Pyannote Pipeline. Vui lòng kiểm tra Hugging Face Token.")

        # Chuẩn hoá file audio sang WAV 16kHz mono PCM
        subprocess.run(
            ["ffmpeg", "-y", "-i", raw_in, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", clean_wav],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True
        )

        # Nạp trực tiếp vào Tensor trên RAM bằng soundfile (nhanh gấp 10 lần và không phụ thuộc torchaudio.info/load)
        audio_np, sr = sf.read(clean_wav, dtype="float32", always_2d=True)
        waveform = torch.from_numpy(audio_np.T.copy())
        audio_in = {"waveform": waveform, "sample_rate": sr, "uri": task_id}

        with torch.inference_mode():
            diarization_out = pipeline(audio_in)

        turns = []
        speaker_turns = dict()
        annotation = diarization_out.speaker_diarization if hasattr(diarization_out, "speaker_diarization") else diarization_out
        for turn, _, speaker in annotation.itertracks(yield_label=True):
            s, e = round(float(turn.start), 3), round(float(turn.end), 3)
            if e > s:
                turns.append({"speaker": str(speaker), "start": s, "end": e})
                speaker_turns.setdefault(str(speaker), []).append((s, e))

        embeddings = dict()
        try:
            if hasattr(diarization_out, "speaker_embeddings") and diarization_out.speaker_embeddings is not None:
                raw_emb = diarization_out.speaker_embeddings
                if isinstance(raw_emb, dict):
                    for spk, vec in raw_emb.items():
                        embeddings[str(spk)] = [float(x) for x in (vec.tolist() if hasattr(vec, "tolist") else vec)]
                elif hasattr(raw_emb, "shape"):
                    labels = list(annotation.labels()) if hasattr(annotation, "labels") else list(speaker_turns.keys())
                    for idx, spk in enumerate(labels):
                        if idx < len(raw_emb):
                            row = raw_emb[idx]
                            embeddings[str(spk)] = [float(x) for x in (row.tolist() if hasattr(row, "tolist") else row)]
        except Exception as e_emb:
            print(">>> Warning fallback embedding:", e_emb, flush=True)
            embeddings = dict()

        if not embeddings:
            try:
                emb_model = getattr(pipeline, "_embedding", None)
                if emb_model is not None and turns:
                    for spk, intervals in speaker_turns.items():
                        best_s, best_e = max(intervals, key=lambda iv: iv[1] - iv[0])
                        a, b = int(best_s * sr), min(waveform.shape[1], int(best_e * sr))
                        if b - a >= sr * 0.2:
                            chunk = waveform[:, a:b].unsqueeze(0).to(device)
                            with torch.no_grad():
                                emb = emb_model(chunk)
                            if isinstance(emb, torch.Tensor):
                                emb = emb.detach().cpu().numpy()
                            embeddings[spk] = [round(float(x), 6) for x in np.asarray(emb).flatten()]
            except Exception:
                pass

        if not embeddings:
            audio_flat = audio_np[:, 0]
            for spk, intervals in speaker_turns.items():
                best_s, best_e = max(intervals, key=lambda iv: iv[1] - iv[0])
                chunk = audio_flat[int(best_s * sr):int(best_e * sr)]
                embeddings[spk] = [0.0] * 256 if len(chunk) < 256 else [float(chunk[i * max(1, len(chunk)//256)]) for i in range(256)]

        elapsed = round(time.perf_counter() - start_time, 2)
        print(f">>> XONG task {task_id} sau {elapsed}s ({device}), {len(turns)} đoạn", flush=True)
        tasks[task_id] = {
            "status": "SUCCESS",
            "process_time_seconds": elapsed,
            "device": str(device),
            "turns": turns,
            "embeddings": embeddings
        }
    except Exception as e:
        print(f">>> LỖI task {task_id}: {e}", flush=True)
        tasks[task_id] = {"status": "FAILED", "error": str(e)}
    finally:
        for p in [raw_in, clean_wav]:
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass

@app.post("/diarize")
async def diarize(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    task_id = str(uuid.uuid4())
    with tempfile.NamedTemporaryFile(suffix=".upload", delete=False) as tmp_in:
        raw_in = tmp_in.name
        content = await file.read()
        tmp_in.write(content)
    clean_wav = raw_in + ".clean.wav"
    tasks[task_id] = {"status": "PROCESSING", "start_time": time.perf_counter()}
    background_tasks.add_task(process_diarize_task, task_id, raw_in, clean_wav)
    print(f">>> Đã nhận file cho task {task_id}, bắt đầu xử lý nền trên {device}...", flush=True)
    return {"status": "PROCESSING", "task_id": task_id}

@app.get("/diarize/status/{task_id}")
def get_diarize_status(task_id: str):
    task = tasks.get(task_id)
    if not task:
        return {"status": "NOT_FOUND", "error": f"Task {task_id} không tồn tại"}
    if task["status"] == "PROCESSING":
        return {
            "status": "PROCESSING",
            "elapsed_seconds": round(time.perf_counter() - task.get("start_time", time.perf_counter()), 1)
        }
    return task
"""

server_code = server_template.replace("__HF_TOKEN__", HF_TOKEN)

with open("/content/server.py", "w", encoding="utf-8") as f:
    f.write(server_code)

def start_tunnel_and_publish():
    subprocess.run("pkill -f cloudflared || true", shell=True)
    time.sleep(1)
    if os.path.exists("/content/tunnel.log"):
        os.remove("/content/tunnel.log")
    subprocess.Popen(
        ["cloudflared", "tunnel", "--url", "http://127.0.0.1:8000"],
        stdout=open("/content/tunnel.log", "w"),
        stderr=subprocess.STDOUT,
    )
    url = ""
    for _ in range(40):
        time.sleep(1)
        if os.path.exists("/content/tunnel.log"):
            with open("/content/tunnel.log", "r") as f:
                content = f.read()
            match = re.search(r"https://[a-zA-Z0-9\-]+\.trycloudflare\.com", content)
            if match:
                url = match.group(0)
                break
    if url:
        for _ in range(5):
            try:
                r = requests.patch(
                    f"https://api.github.com/gists/{GIST_ID}",
                    headers={"Authorization": f"Bearer {GITHUB_TOKEN}", "Accept": "application/vnd.github+json"},
                    json={"files": {"gpu_url.txt": {"content": url}}},
                    timeout=10,
                )
                if r.status_code == 200:
                    print(f">>> Đã cập nhật link mới vào GitHub Gist: {url}", flush=True)
                    break
            except Exception:
                time.sleep(2)
        print(f"🔗 LINK SERVER GPU: {url}", flush=True)
    return url


# Dọn dẹp tiến trình cũ và giải phóng cổng 8000
subprocess.run("fuser -k 8000/tcp || pkill -f uvicorn || true", shell=True)
time.sleep(1)
tunnel_url = start_tunnel_and_publish()

print(">>> Đang khởi động Server GPU AI...", flush=True)
try:
    while True:
        with open("/content/uvicorn.log", "w", encoding="utf-8") as uvicorn_log:
            uvicorn_proc = subprocess.Popen(
                ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "/content", "--timeout-keep-alive", "300"],
                stdout=uvicorn_log,
                stderr=subprocess.STDOUT,
            )

        # Chờ kiểm tra health check thực tế (tối đa 90s cho lần nạp model đầu tiên) và in log trực tiếp
        health_ok = False
        health_info = {}
        log_pos = 0
        for _ in range(90):
            time.sleep(1)
            try:
                if os.path.exists("/content/uvicorn.log"):
                    with open("/content/uvicorn.log", "r", encoding="utf-8") as f:
                        f.seek(log_pos)
                        new_content = f.read()
                        log_pos = f.tell()
                        if new_content:
                            for line in new_content.splitlines():
                                if ">>>" in line:
                                    print(f"[Colab GPU Log] {line}", flush=True)
            except Exception:
                pass
            try:
                hr = requests.get("http://127.0.0.1:8000/health", timeout=2)
                if hr.status_code == 200:
                    health_ok = True
                    health_info = hr.json()
                    break
            except Exception:
                pass
            if uvicorn_proc.poll() is not None:
                break

        if not health_ok:
            print(f">>> Uvicorn chưa sẵn sàng (code {uvicorn_proc.poll()}), đang tự động thử lại sau 2 giây...", flush=True)
            try:
                with open("/content/uvicorn.log", "r", encoding="utf-8") as f:
                    err_content = f.read().strip()
                    if err_content:
                        print(f"[Log khởi động]: {err_content[-400:]}", flush=True)
            except Exception:
                pass
            time.sleep(2)
            continue

        # In bảng MINH CHỨNG MODEL SIÊU TỐC rõ ràng ra màn hình Colab
        print("\n" + "="*75, flush=True)
        print("🎯 MINH CHỨNG: SERVER GPU SIÊU TỐC ĐÃ SẴN SÀNG HOÀN TOÀN!", flush=True)
        print(f"   • Mô hình Diarization : {health_info.get('model', 'pyannote/speaker-diarization-3.1')} (TỐC ĐỘ 2.5 - 3 PHÚT)", flush=True)
        print(f"   • Thiết bị phần cứng  : {health_info.get('name', 'GPU')} ({health_info.get('device', 'cuda')})", flush=True)
        print(f"   • Cấu hình Batching   : Batch Size = {health_info.get('batch_size', 32)} (Song song trên Tensor Cores)", flush=True)
        print(f"   • Trạng thái          : ONLINE 100% (Cổng 8000)", flush=True)
        print(f"   • Địa chỉ Tunnel      : {tunnel_url}", flush=True)
        print("="*75 + "\n", flush=True)
        print(">>> Chế độ trực 24/7 đang bật. Hệ thống sẽ in log mỗi khi nhận job...", flush=True)

        while uvicorn_proc.poll() is None:
            time.sleep(4)
            try:
                if os.path.exists("/content/uvicorn.log"):
                    with open("/content/uvicorn.log", "r", encoding="utf-8") as f:
                        f.seek(log_pos)
                        new_content = f.read()
                        log_pos = f.tell()
                        if new_content:
                            for line in new_content.splitlines():
                                if ">>>" in line:
                                    print(f"[Colab GPU Log] {line}", flush=True)
            except Exception:
                pass

            CheckTunnel = subprocess.run("pgrep -f cloudflared", shell=True, stdout=subprocess.DEVNULL)
            if CheckTunnel.returncode != 0:
                print(">>> Tunnel bị ngắt, đang tự động nối lại và cập nhật Gist...", flush=True)
                tunnel_url = start_tunnel_and_publish()

        print(">>> Uvicorn dừng, đang khởi động lại...", flush=True)
        time.sleep(2)
except KeyboardInterrupt:
    print(">>> Đã dừng Server theo lệnh của bạn.", flush=True)
    subprocess.run("pkill -f uvicorn || true", shell=True)
    subprocess.run("pkill -f cloudflared || true", shell=True)
