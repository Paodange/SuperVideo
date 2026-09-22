"""E01 bounded research search and source provenance services."""

from .errors import ResearchError, ResearchErrorCode
from .models import (
    ResearchCitation,
    ResearchEvidence,
    ResearchFact,
    ResearchProvenance,
    ResearchSaveSourceParams,
    ResearchSaveSourceResult,
    ResearchSearchHit,
    ResearchSearchParams,
    ResearchSearchResult,
    ResearchSourceInput,
    ResearchSourceRecord,
)
from .service import ResearchService
from .transport import DeterministicFakeResearchTransport, ResearchTransport, ResearchTransportHit

__all__ = [
    "DeterministicFakeResearchTransport",
    "ResearchCitation",
    "ResearchError",
    "ResearchErrorCode",
    "ResearchEvidence",
    "ResearchFact",
    "ResearchProvenance",
    "ResearchSaveSourceParams",
    "ResearchSaveSourceResult",
    "ResearchSearchHit",
    "ResearchSearchParams",
    "ResearchSearchResult",
    "ResearchService",
    "ResearchSourceInput",
    "ResearchSourceRecord",
    "ResearchTransport",
    "ResearchTransportHit",
]
