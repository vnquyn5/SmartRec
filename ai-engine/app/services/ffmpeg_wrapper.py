import subprocess
from pathlib import Path


def get_ffmpeg_version() -> str:
    result = subprocess.run(
        ["ffmpeg", "-version"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.splitlines()[0]


def extract_audio(input_path: str, output_path: str, sample_rate: int = 16000) -> str:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            input_path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            output_path,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return output_path
