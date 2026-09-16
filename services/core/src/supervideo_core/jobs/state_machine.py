"""The only allowed persistent job status transitions."""

from __future__ import annotations

from typing import Final

from .errors import JobError

TERMINAL_STATUSES: Final[frozenset[str]] = frozenset({"succeeded", "failed", "cancelled", "needs_attention"})

ALLOWED_TRANSITIONS: Final[dict[str, frozenset[str]]] = {
    "queued": frozenset({"running", "cancelled"}),
    "running": frozenset({"succeeded", "failed", "cancelling", "retrying", "needs_attention"}),
    "failed": frozenset({"retrying"}),
    "retrying": frozenset({"running", "failed", "needs_attention"}),
    "cancelling": frozenset({"cancelled", "needs_attention"}),
    "succeeded": frozenset(),
    "cancelled": frozenset(),
    "needs_attention": frozenset({"retrying"}),
}


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in ALLOWED_TRANSITIONS.get(from_status, frozenset())


def require_transition(from_status: str, to_status: str) -> None:
    if not can_transition(from_status, to_status):
        raise JobError("JOB_STATE_CONFLICT")
