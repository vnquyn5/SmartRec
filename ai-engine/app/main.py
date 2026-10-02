from fastapi import FastAPI
from app.api.routes import router as audio_router

app = FastAPI(
    title="SmartRec AI Engine - Audio Preprocessing Service",
    version="1.0.0",
    description="Microservice tiền xử lý âm thanh: Trích xuất, chuẩn hóa 16kHz Mono và cắt phân đoạn cho pipeline AI."
)

# Đăng ký router tiền xử lý âm thanh
app.include_router(audio_router)


@app.get("/health", tags=["Health Check"])
async def health_check():
    return {"status": "HEALTHY", "service": "smartrec-ai-engine"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)