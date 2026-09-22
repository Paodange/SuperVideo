"""Replaceable research transport seam with an offline deterministic V1 fake."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Protocol

from .errors import ResearchError
from .models import ResearchCitation, ResearchFact, ResearchSearchParams


@dataclass(frozen=True)
class ResearchTransportHit:
    url: str
    title: str
    summary: str
    site_name: str | None
    author: str | None
    fetched_at_ms: int
    match_score: float
    citations: tuple[ResearchCitation, ...]
    facts: tuple[ResearchFact, ...]
    fixture_id: str


class ResearchTransport(Protocol):
    async def search(self, request: ResearchSearchParams, cancelled: asyncio.Event) -> tuple[ResearchTransportHit, ...]:
        """Return bounded, unverified source drafts without persisting them."""


class DeterministicFakeResearchTransport:
    """Offline fixture transport; URLs are example-only and not real captures."""

    def __init__(self, *, delay_ms: int = 0, mode: str = "ok") -> None:
        self.delay_ms = delay_ms
        self.mode = mode

    async def search(self, request: ResearchSearchParams, cancelled: asyncio.Event) -> tuple[ResearchTransportHit, ...]:
        if self.mode == "unavailable":
            raise ResearchError("RESEARCH_TRANSPORT_UNAVAILABLE")
        if self.mode not in {"ok", "timeout", "cancel"}:
            raise ResearchError("RESEARCH_TRANSPORT_UNAVAILABLE")
        delay = max(self.delay_ms, 50 if self.mode in {"timeout", "cancel"} else 0)
        if delay:
            try:
                await asyncio.wait_for(cancelled.wait(), timeout=delay / 1_000)
            except TimeoutError:
                pass
            else:
                raise ResearchError("RESEARCH_CANCELLED")
        if cancelled.is_set() or self.mode == "cancel":
            raise ResearchError("RESEARCH_CANCELLED")
        return _fixture_for(request.query)


def _fixture_for(query: str) -> tuple[ResearchTransportHit, ...]:
    normalized = query.casefold()
    if "招聘" in normalized or "岗位" in normalized:
        return (
            ResearchTransportHit(
                url="https://example.com/research/hiring-a",
                title="岗位研究样例 A",
                summary="这是用于离线测试的招聘研究摘要，不代表已核实事实。",
                site_name="example.com",
                author="fixture-author-a",
                fetched_at_ms=1_760_000_000_000,
                match_score=0.92,
                citations=(ResearchCitation(citationId="citation-1", locator="summary", quote="这是用于离线测试的招聘研究摘要，不代表已核实事实。"),),
                facts=(ResearchFact(factId="fact-1", statement="样例摘要包含一条待核实陈述。", citationIds=["citation-1"]),),
                fixture_id="fixture-hiring-a",
            ),
            ResearchTransportHit(
                url="https://example.com/research/hiring-b?lang=zh",
                title="岗位研究样例 B",
                summary="第二条离线样例来源用于验证多结果排序和去重。",
                site_name="example.com",
                author=None,
                fetched_at_ms=1_760_000_000_001,
                match_score=0.81,
                citations=(ResearchCitation(citationId="citation-1", locator="summary", quote="第二条离线样例来源用于验证多结果排序和去重。"),),
                facts=(ResearchFact(factId="fact-1", statement="样例 B 仍需用户核实。", citationIds=["citation-1"]),),
                fixture_id="fixture-hiring-b",
            ),
        )
    return (
        ResearchTransportHit(
            url="https://example.com/research/default",
            title="通用研究样例",
            summary="这是 deterministic fake transport 的离线样例，不能作为真实抓取证据。",
            site_name="example.com",
            author="fixture-author-default",
            fetched_at_ms=1_760_000_000_010,
            match_score=0.50,
            citations=(ResearchCitation(citationId="citation-1", locator="summary", quote="这是 deterministic fake transport 的离线样例，不能作为真实抓取证据。"),),
            facts=(ResearchFact(factId="fact-1", statement="该来源仅用于协议测试。", citationIds=["citation-1"]),),
            fixture_id="fixture-default",
        ),
    )
