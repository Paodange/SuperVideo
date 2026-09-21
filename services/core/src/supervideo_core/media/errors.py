"""Stable, path-safe errors for the media boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

MediaErrorCode = Literal[
    "MEDIA_TOOL_UNAVAILABLE",
    "MEDIA_TOOL_TIMEOUT",
    "MEDIA_PROBE_PARSE_ERROR",
    "MEDIA_NOT_MEDIA",
    "MEDIA_OUTPUT_INVALID",
    "MEDIA_CANCELLED",
]


@dataclass(frozen=True)
class MediaErrorDefinition:
    message: str


ERRORS: Final[dict[str, MediaErrorDefinition]] = {
    "MEDIA_TOOL_UNAVAILABLE": MediaErrorDefinition("The configured media tool is unavailable."),
    "MEDIA_TOOL_TIMEOUT": MediaErrorDefinition("The media tool timed out."),
    "MEDIA_PROBE_PARSE_ERROR": MediaErrorDefinition("The media probe output was invalid."),
    "MEDIA_NOT_MEDIA": MediaErrorDefinition("The selected asset is not a valid media file."),
    "MEDIA_OUTPUT_INVALID": MediaErrorDefinition("The generated media output was invalid."),
    "MEDIA_CANCELLED": MediaErrorDefinition("The media operation was cancelled."),
}


class MediaError(Exception):
    def __init__(self, code: MediaErrorCode, *, cause: BaseException | None = None) -> None:
        self.code = code if code in ERRORS else "MEDIA_OUTPUT_INVALID"
        self.cause = cause
        super().__init__(ERRORS[self.code].message)
