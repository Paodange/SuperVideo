"""Stable C10 version-management errors."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TimelineVersionErrorDefinition:
    message: str


TIMELINE_VERSION_ERRORS = {
    "TIMELINE_VERSION_NOT_FOUND": TimelineVersionErrorDefinition("The requested Timeline version was not found."),
    "TIMELINE_VERSION_PROJECT_MISMATCH": TimelineVersionErrorDefinition("The Timeline version does not belong to the requested project."),
    "TIMELINE_ACTIVE_VERSION_MISSING": TimelineVersionErrorDefinition("The project has no active Timeline version."),
    "TIMELINE_NO_UNDO": TimelineVersionErrorDefinition("There is no previous Timeline version to undo to."),
    "TIMELINE_NO_REDO": TimelineVersionErrorDefinition("There is no next Timeline version to redo to."),
    "TIMELINE_REDO_AMBIGUOUS": TimelineVersionErrorDefinition("Redo has multiple child versions; choose a version explicitly."),
    "TIMELINE_VERSION_CONFLICT": TimelineVersionErrorDefinition("The active Timeline version changed concurrently."),
    "TIMELINE_VERSION_INVALID": TimelineVersionErrorDefinition("The Timeline version request is invalid."),
    "TIMELINE_DIFF_NOT_AVAILABLE": TimelineVersionErrorDefinition("The requested Timeline diff is not available."),
}


class TimelineVersionError(Exception):
    def __init__(self, code: str) -> None:
        if code not in TIMELINE_VERSION_ERRORS:
            code = "TIMELINE_VERSION_INVALID"
        self.code = code
        super().__init__(TIMELINE_VERSION_ERRORS[code].message)
