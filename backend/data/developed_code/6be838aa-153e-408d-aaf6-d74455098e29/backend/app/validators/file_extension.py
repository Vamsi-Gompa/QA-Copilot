"""File extension validation for uploaded files."""
from __future__ import annotations

import os
from typing import Iterable

# Allowed text-based file extensions (lowercase, without leading dot)
ALLOWED_TEXT_EXTENSIONS: set[str] = {"txt", "csv"}


class FileExtensionError(ValueError):
    """Raised when an uploaded file has an unsupported extension."""


def get_extension(filename: str) -> str:
    """Return the lowercase extension of a filename without the leading dot.

    Returns an empty string when the file has no extension.
    """
    if not filename:
        return ""
    _, ext = os.path.splitext(filename)
    return ext.lower().lstrip(".")


def is_valid_text_extension(
    filename: str,
    allowed_extensions: Iterable[str] = ALLOWED_TEXT_EXTENSIONS,
) -> bool:
    """Return True when the filename has an allowed text-based extension."""
    extension = get_extension(filename)
    normalized_allowed = {e.lower().lstrip(".") for e in allowed_extensions}
    return extension in normalized_allowed


def validate_text_extension(
    filename: str,
    allowed_extensions: Iterable[str] = ALLOWED_TEXT_EXTENSIONS,
) -> str:
    """Validate the filename extension, raising FileExtensionError on failure.

    Returns the validated extension when successful.
    """
    if not is_valid_text_extension(filename, allowed_extensions):
        allowed = ", ".join(sorted({e.lower().lstrip('.') for e in allowed_extensions}))
        raise FileExtensionError(
            f"Unsupported file type. Only text-based files are allowed: {allowed}."
        )
    return get_extension(filename)
