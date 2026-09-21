"""Controlled media probing and proxy generation for B02."""

from .errors import MediaError
from .models import MediaProbeParams, MediaProxyParams
__all__ = ["MediaError", "MediaProbeParams", "MediaProxyParams", "MediaService"]


def __getattr__(name: str):
    if name == "MediaService":
        from .service import MediaService

        return MediaService
    raise AttributeError(name)
