"""Controlled media analysis adapters for B02 and B03."""

from .errors import MediaError
from .models import MediaProbeParams, MediaProxyParams
from .transcription_models import TranscriptionParams, TranscriptionResult
from .vad_models import VadParams, VadResult
__all__ = ["MediaError", "MediaProbeParams", "MediaProxyParams", "MediaService", "TranscriptionParams", "TranscriptionResult", "TranscriptionService", "VadParams", "VadResult", "VadService"]


def __getattr__(name: str):
    if name == "MediaService":
        from .service import MediaService

        return MediaService
    if name == "TranscriptionService":
        from .transcription import TranscriptionService

        return TranscriptionService
    if name == "VadService":
        from .vad import VadService

        return VadService
    raise AttributeError(name)
