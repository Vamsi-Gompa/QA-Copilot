"""Tests for text file extension validation."""
import pytest

from app.validators.file_extension import (
    FileExtensionError,
    get_extension,
    is_valid_text_extension,
    validate_text_extension,
)


@pytest.mark.parametrize(
    "filename",
    ["data.txt", "report.csv", "DATA.TXT", "Report.CSV"],
)
def test_valid_text_extensions_pass(filename):
    assert is_valid_text_extension(filename) is True
    assert validate_text_extension(filename) == get_extension(filename)


@pytest.mark.parametrize(
    "filename",
    ["image.jpg", "document.pdf", "archive.zip", "noextension", ""],
)
def test_invalid_extensions_fail(filename):
    assert is_valid_text_extension(filename) is False
    with pytest.raises(FileExtensionError):
        validate_text_extension(filename)


def test_get_extension_handles_multiple_dots():
    assert get_extension("my.data.file.txt") == "txt"
