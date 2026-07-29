"""Upload route with text file extension validation."""
from __future__ import annotations

from fastapi import APIRouter, File, UploadFile, status
from fastapi.responses import JSONResponse

from app.validators.file_extension import (
    ALLOWED_TEXT_EXTENSIONS,
    FileExtensionError,
    validate_text_extension,
)

router = APIRouter(prefix="/api/files", tags=["files"])


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)) -> JSONResponse:
    """Accept an uploaded file only when it has a text-based extension."""
    try:
        extension = validate_text_extension(file.filename or "")
    except FileExtensionError as exc:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "detail": str(exc),
                "filename": file.filename,
                "allowed_extensions": sorted(ALLOWED_TEXT_EXTENSIONS),
            },
        )

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "detail": "File extension validated successfully.",
            "filename": file.filename,
            "extension": extension,
        },
    )
