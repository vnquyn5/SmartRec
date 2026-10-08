import os
import tempfile
from pathlib import Path
from typing import Union, Optional

SUPPORTED_MEDIA_INPUT_EXTENSIONS = {
    ".wav",
    ".flac",
    ".mp3",
    ".m4a",
    ".mp4",
    ".mkv",
    ".ogg",
}
ALLOWED_OUTPUT_EXTENSIONS = {".json", ".wav", ".flac", ".mp3", ".m4a", ".ogg"}
FORBIDDEN_DIR_NAMES = {"app", "tests", ".venv", "venv", ".git", "bin", "etc", "usr"}


def get_project_root() -> Path:
    """Trả về thư mục gốc của dự án ai-engine."""
    current = Path(__file__).resolve().parent
    while current != current.parent:
        if (current / "app").is_dir() or (current / "pyproject.toml").is_file():
            return current
        current = current.parent
    return Path(os.getcwd()).resolve()


def get_smartrec_temp_dir() -> Path:
    """Thư mục tạm chuyên biệt dành riêng cho SmartRec AI Engine."""
    base_temp = Path(tempfile.gettempdir()).resolve()
    smartrec_tmp = base_temp / "smartrec"
    smartrec_tmp.mkdir(parents=True, exist_ok=True)
    return smartrec_tmp


def get_workspace_root() -> Path:
    """Dedicated worker workspace, configurable without widening other write access."""
    root = Path(os.getenv("SMARTREC_WORKSPACE_ROOT", "/tmp/smartrec_workspace")).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def validate_safe_read_path(file_path: Union[str, Path]) -> Path:
    """
    Xác thực đường dẫn file đầu vào (audio) hợp lệ và an toàn tuyệt đối.
    """
    if not file_path or not str(file_path).strip():
        raise ValueError("Đường dẫn file đầu vào không được để trống.")

    path_str = str(file_path).strip()
    if "\x00" in path_str:
        raise ValueError("Đường dẫn chứa ký tự null byte không hợp lệ.")

    resolved = Path(path_str).resolve()

    if not resolved.exists():
        raise FileNotFoundError(f"Tệp tin không tồn tại: {resolved}")

    if not resolved.is_file():
        raise ValueError(f"Đường dẫn không phải là tệp tin hợp lệ: {resolved}")

    ext = resolved.suffix.lower()
    if ext not in SUPPORTED_MEDIA_INPUT_EXTENSIONS:
        raise ValueError(
            f"Định dạng media '{ext}' không được hỗ trợ. Chỉ chấp nhận: {', '.join(sorted(SUPPORTED_MEDIA_INPUT_EXTENSIONS))}"
        )

    for part in resolved.parts:
        if part in FORBIDDEN_DIR_NAMES:
            raise PermissionError(f"Nghiêm cấm đọc tệp từ thư mục mã nguồn hoặc cấu hình '{part}': {resolved}")

    root = get_project_root()
    allowed_read_roots = [
        (root / "poc" / "data").resolve(),
        (root / "data").resolve(),
        (root / "storage").resolve(),
        get_smartrec_temp_dir(),
        Path(tempfile.gettempdir()).resolve(),
        Path("/tmp").resolve(),
        Path("/private/tmp").resolve(),
        Path("/var/tmp").resolve(),
        Path("/private/var/tmp").resolve(),
    ]

    is_allowed = any(resolved == r or r in resolved.parents for r in allowed_read_roots)
    if not is_allowed:
        raise PermissionError(f"Đường dẫn đọc '{resolved}' nằm ngoài các thư mục dữ liệu cho phép.")

    return resolved


def validate_safe_write_path(file_path: Union[str, Path]) -> Path:
    """
    Xác thực đường dẫn ghi file đầu ra (JSON) an toàn tuyệt đối:
    Chỉ cho phép ghi vào poc/data, data, storage hoặc thư mục tạm riêng smartrec/.
    Nghiêm cấm ghi tự do ra thư mục temp hệ thống dùng chung.
    """
    if not file_path or not str(file_path).strip():
        raise ValueError("Đường dẫn file đầu ra không được để trống.")

    path_str = str(file_path).strip()
    if "\x00" in path_str:
        raise ValueError("Đường dẫn chứa ký tự null byte không hợp lệ.")

    resolved = Path(path_str).resolve()

    if resolved.suffix.lower() not in ALLOWED_OUTPUT_EXTENSIONS:
        raise PermissionError(
            f"Chỉ cho phép ghi tệp kết quả có định dạng .json (nhận được: '{resolved.suffix}'): {resolved}"
        )

    for part in resolved.parts:
        if part in FORBIDDEN_DIR_NAMES:
            raise PermissionError(f"Nghiêm cấm ghi file vào thư mục hệ thống/mã nguồn '{part}': {resolved}")

    root = get_project_root()
    # Chỉ cho phép ghi vào thư mục dữ liệu của dự án hoặc thư mục tạm riêng smartrec/
    allowed_write_roots = [
        (root / "poc" / "data").resolve(),
        (root / "data").resolve(),
        (root / "storage").resolve(),
        get_smartrec_temp_dir(),
        get_workspace_root(),
    ]

    is_allowed = any(resolved == r or r in resolved.parents for r in allowed_write_roots)
    if not is_allowed:
        raise PermissionError(
            f"Đường dẫn ghi '{resolved}' nằm ngoài các thư mục dữ liệu cho phép (poc/data, data, storage, smartrec temp)."
        )

    return resolved
