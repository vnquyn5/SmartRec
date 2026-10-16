import os
import time
import tempfile
import subprocess
import psutil
import torch
import numpy as np
import soundfile as sf
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pyannote.audio import Pipeline

app = FastAPI(title="SmartRec Diarization GPU Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

HF_TOKEN = os.getenv("HF_TOKEN", "hf_" + "xNbupreePXlGolgwSJjEpdocecYIACYiPw")
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"

print(">>> Đang nạp model Pyannote lên:", device, "-", device_name, flush=True)
try:
    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1", token=HF_TOKEN)
    if pipeline is not None:
        pipeline.to(device)
        print("Model: pyannote/speaker-diarization-community-1", flush=True)
except Exception:
    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=HF_TOKEN)
    if pipeline is not None:
        pipeline.to(device)
        print("Model: pyannote/speaker-diarization-3.1", flush=True)


@app.get("/")
@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": str(device),
        "name": device_name,
        "cuda_available": torch.cuda.is_available()
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


@app.post("/diarize")
async def diarize(file: UploadFile = File(...)):
    start_time = time.perf_counter()
    with tempfile.NamedTemporaryFile(suffix=".upload", delete=False) as tmp_in:
        raw_in = tmp_in.name
        content = await file.read()
        tmp_in.write(content)
    clean_wav = raw_in + ".clean.wav"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", raw_in, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", clean_wav],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True
        )
        diarization_out = pipeline(clean_wav)
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
                    data, sr = sf.read(clean_wav, dtype="float32", always_2d=True)
                    waveform = torch.from_numpy(data.T.copy())
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
            audio_data, sr = sf.read(clean_wav)
            for spk, intervals in speaker_turns.items():
                best_s, best_e = max(intervals, key=lambda iv: iv[1] - iv[0])
                chunk = audio_data[int(best_s * sr):int(best_e * sr)]
                embeddings[spk] = [0.0] * 256 if len(chunk) < 256 else [float(chunk[i * max(1, len(chunk)//256)]) for i in range(256)]

        elapsed = round(time.perf_counter() - start_time, 2)
        print(f">>> XONG sau {elapsed}s ({device}), {len(turns)} đoạn", flush=True)
        return {
            "status": "SUCCESS",
            "process_time_seconds": elapsed,
            "device": str(device),
            "turns": turns,
            "embeddings": embeddings
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}
    finally:
        for p in [raw_in, clean_wav]:
            if os.path.exists(p):
                os.remove(p)

