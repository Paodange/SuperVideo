"""Stable errors for the E01 research boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

ResearchErrorCode = Literal[
    "RESEARCH_INPUT_INVALID",
    "RESEARCH_URL_INVALID",
    "RESEARCH_SOURCE_INVALID",
    "RESEARCH_IDEMPOTENCY_CONFLICT",
    "RESEARCH_TRANSPORT_UNAVAILABLE",
    "RESEARCH_TIMEOUT",
    "RESEARCH_CANCELLED",
    "RESEARCH_STORAGE_INVALID",
]


@dataclass(frozen=True)
class ResearchErrorDefinition:
    message: str


ERRORS: Final[dict[str, ResearchErrorDefinition]] = {
    "RESEARCH_INPUT_INVALID": ResearchErrorDefinition("The research input is invalid."),
    "RESEARCH_URL_INVALID": ResearchErrorDefinition("The research source URL is not allowed."),
    "RESEARCH_SOURCE_INVALID": ResearchErrorDefinition("The research source record is invalid."),
    "RESEARCH_IDEMPOTENCY_CONFLICT": ResearchErrorDefinition("The research idempotency key conflicts with another request."),
    "RESEARCH_TRANSPORT_UNAVAILABLE": ResearchErrorDefinition("The research transport is unavailable."),
    "RESEARCH_TIMEOUT": ResearchErrorDefinition("The research transport timed out."),
    "RESEARCH_CANCELLED": ResearchErrorDefinition("The research operation was cancelled."),
    "RESEARCH_STORAGE_INVALID": ResearchErrorDefinition("The research storage record is invalid."),
}


class ResearchError(Exception):
    def __init__(self, code: ResearchErrorCode, *, cause: BaseException | None = None) -> None:
        self.code = code if code in ERRORS else "RESEARCH_INPUT_INVALID"
        self.error_code = self.code
        self.cause = cause
        super().__init__(ERRORS[self.code].message)
