"""Controlled media analysis adapters for B02 through B06."""

from .errors import MediaError
from .models import MediaProbeParams, MediaProxyParams
from .transcription_models import TranscriptionParams, TranscriptionResult
from .vad_models import VadParams, VadResult
from .sentence_models import SentenceConfig, SentenceParams, SentenceResult
from .qa_models import SentenceQaParams, SentenceQaSaveParams, SentenceQaContextResult, SentenceQaSaveResult
__all__ = ["MediaError", "MediaProbeParams", "MediaProxyParams", "MediaService", "SentenceConfig", "SentenceParams", "SentenceResult", "SentenceService", "SentenceQaParams", "SentenceQaSaveParams", "SentenceQaContextResult", "SentenceQaSaveResult", "SentenceQaService", "TranscriptionParams", "TranscriptionResult", "TranscriptionService", "VadParams", "VadResult", "VadService"]


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
    if name == "SentenceService":
        from .sentences import SentenceService

        return SentenceService
    if name == "SentenceQaService":
        from .qa import SentenceQaService

        return SentenceQaService
    raise AttributeError(name)
