"""Controlled media analysis adapters for B02 and B03."""

from .errors import MediaError
from .models import MediaProbeParams, MediaProxyParams
from .transcription_models import TranscriptionParams, TranscriptionResult
__all__ = ["MediaError", "MediaProbeParams", "MediaProxyParams", "MediaService", "TranscriptionParams", "TranscriptionResult", "TranscriptionService"]


def __getattr__(name: str):
    if name == "MediaService":
        from .service import MediaService

        return MediaService
    if name == "TranscriptionService":
        from .transcription import TranscriptionService

        return TranscriptionService
    raise AttributeError(name)
