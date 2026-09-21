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
    "TRANSCRIPTION_TOOL_UNAVAILABLE",
    "TRANSCRIPTION_MODEL_UNAVAILABLE",
    "TRANSCRIPTION_OUTPUT_INVALID",
    "TRANSCRIPTION_TIMEOUT",
    "TRANSCRIPTION_CANCELLED",
    "VAD_TOOL_UNAVAILABLE",
    "VAD_OUTPUT_INVALID",
    "VAD_TIMEOUT",
    "VAD_CANCELLED",
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
    "TRANSCRIPTION_TOOL_UNAVAILABLE": MediaErrorDefinition("The local transcription tool is unavailable."),
    "TRANSCRIPTION_MODEL_UNAVAILABLE": MediaErrorDefinition("The local transcription model is unavailable."),
    "TRANSCRIPTION_OUTPUT_INVALID": MediaErrorDefinition("The local transcription output was invalid."),
    "TRANSCRIPTION_TIMEOUT": MediaErrorDefinition("The local transcription timed out."),
    "TRANSCRIPTION_CANCELLED": MediaErrorDefinition("The local transcription was cancelled."),
    "VAD_TOOL_UNAVAILABLE": MediaErrorDefinition("The local VAD backend is unavailable."),
    "VAD_OUTPUT_INVALID": MediaErrorDefinition("The local VAD output was invalid."),
    "VAD_TIMEOUT": MediaErrorDefinition("The local VAD timed out."),
    "VAD_CANCELLED": MediaErrorDefinition("The local VAD operation was cancelled."),
}


class MediaError(Exception):
    def __init__(self, code: MediaErrorCode, *, cause: BaseException | None = None) -> None:
        self.code = code if code in ERRORS else "MEDIA_OUTPUT_INVALID"
        self.cause = cause
        super().__init__(ERRORS[self.code].message)
