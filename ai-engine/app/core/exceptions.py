import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


logger = logging.getLogger("smartrec.exceptions")


def register_exception_handlers(app: FastAPI) -> None:
    """Register a handler for unexpected application errors."""

    @app.exception_handler(Exception)
    async def unexpected_exception_handler(
        request: Request,
        exc: Exception
    ) -> JSONResponse:
        logger.error(
            "Unhandled exception: %s %s",
            request.method,
            request.url.path,
            exc_info=(type(exc), exc, exc.__traceback__)
        )

        return JSONResponse(
            status_code=500,
            content={
                "detail": {
                    "status": "FAILED",
                    "message": "Internal server error"
                }
            }
        )