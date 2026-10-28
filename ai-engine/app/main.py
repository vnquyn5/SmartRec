import logging

from fastapi import FastAPI

from app.core.logging_config import setup_logging
from app.core.exceptions import register_exception_handlers

setup_logging()
logger = logging.getLogger("smartrec.api")
logger.info("Initializing SmartRec AI Engine")

from app.api.routes import router as audio_router, internal_router
from app.api.nlp_routes import nlp_router

app = FastAPI(
    title="SmartRec AI Engine - Audio Preprocessing & NLP Service",
    version="1.0.0",
    description="Microservice xử lý Audio và NLP: Chuẩn hóa âm thanh, Diarization, LLM Local/Gemini fallback có bảo vệ PII."
)

register_exception_handlers(app)
logger.info("Global exception handlers registered")

@app.middleware("http")
async def add_utf8_charset_header(request, call_next):
    response = await call_next(request)
    ct = response.headers.get("content-type", "")
    if "application/json" in ct and "charset" not in ct:
        response.headers["content-type"] = "application/json; charset=utf-8"
    return response

# Đăng ký router tiền xử lý âm thanh và NLP
app.include_router(audio_router, prefix="/api/v1")
app.include_router(nlp_router, prefix="/api/v1")
app.include_router(internal_router)


@app.get("/health", tags=["Health Check"])
async def health_check():
    return {"status": "HEALTHY", "service": "smartrec-ai-engine"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
