from fastapi import FastAPI
import uvicorn
from app.api.nlp_routes import nlp_router

app = FastAPI(
    title="SmartRec NLP & Fallback Service",
    description="Chạy độc lập module Local LLM / Gemini Fallback, bảo vệ PII và giới hạn request"
)

@app.middleware("http")
async def add_utf8_charset_header(request, call_next):
    response = await call_next(request)
    ct = response.headers.get("content-type", "")
    if "application/json" in ct and "charset" not in ct:
        response.headers["content-type"] = "application/json; charset=utf-8"
    return response

app.include_router(nlp_router, prefix="/api/v1")


@app.get("/health")
def health_check():
    return {"status": "HEALTHY", "service": "smartrec-nlp-service"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
