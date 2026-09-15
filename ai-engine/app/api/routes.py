from fastapi import APIRouter
from app.core.config import settings
from app.services.ffmpeg_wrapper import get_ffmpeg_version

router = APIRouter()


@router.get("/")
def root():
    return {"service": settings.app_name, "status": "UP"}


@router.get("/health")
def health():
    return {
        "service": settings.app_name,
        "status": "UP",
        "ffmpeg": get_ffmpeg_version(),
    }
