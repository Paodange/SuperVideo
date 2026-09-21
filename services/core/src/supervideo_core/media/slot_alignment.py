"""B10 deterministic information-slot alignment over B08/B09 candidates."""

from __future__ import annotations

import asyncio
import hashlib
import re
import time
from pathlib import Path
from typing import Any, Awaitable

from pydantic import ValidationError

from .errors import MediaError
from .retrieval import SentenceRetrievalService
from .retrieval_models import RetrievalParams, RetrievalResult
from .rerank import SentenceQualityRerankService
from .rerank_models import RerankParams, RerankResult
from .slot_alignment_models import (
    SLOT_ALIGNMENT_MAX_CANDIDATES,
    SLOT_ALIGNMENT_SCHEMA_VERSION,
    SLOT_ALIGNMENT_VERSION,
    SLOT_SPLITTER_VERSION,
    InformationSlot,
    SlotAlignmentCandidate,
    SlotAlignmentParams,
    SlotAlignmentResult,
    validate_slot_alignment_size,
)


_BULLET_PREFIX = re.compile(r"^(?:[-*•]|\d{1,3}[.)、])\s*")
_SPLIT_AFTER_PUNCTUATION = re.compile(r"(?<=[。！？!?；;])\s*")
_FACT_PATTERNS = (
    re.compile(r"\d{4}年\d{1,2}月\d{1,2}日"),
    re.compile(r"\d{1,2}月\d{1,2}日"),
    re.compile(r"\d+(?:\.\d+)?\s*(?:(?:万|千)?元|万|千|岁|人|天|月|年|分钟|秒|小时|%|％)"),
    re.compile(r"\b[A-Z][A-Za-z0-9_-]{1,31}\b"),
    re.compile(r"(?<![A-Za-z0-9])\d+(?:\.\d+)?(?![A-Za-z0-9])"),
)
_KIND_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("hook", ("开头", "开始", "钩子", "引入", "为什么", "你是不是")),
    ("cta", ("报名", "联系", "私信", "评论", "关注", "咨询", "行动")),
    ("closing", ("最后", "结尾", "总结", "记得")),
    ("benefit", ("福利", "待遇", "补贴", "包吃", "包住", "奖金", "保险")),
    ("requirement", ("要求", "条件", "学历", "经验", "年龄", "需要")),
    ("process", ("流程", "步骤", "面试", "入职", "培训", "安排")),
    ("evidence", ("数据", "证明", "案例", "数据显示", "实际")),
    ("claim", ("工资", "薪资", "收入", "地点", "地址", "招聘", "岗位", "人数", "价格")),
    ("context", ("公司", "工厂", "行业", "背景", "目前", "这里")),
)


def extract_key_facts(text: str) -> list[str]:
    """Extract only literal, privacy-safe fact-shaped tokens; never rewrite them."""

    text = re.sub(r"(?m)^\s*\d{1,3}[.)、]\s*", "", text)
    matches: list[tuple[int, str]] = []
    for pattern in _FACT_PATTERNS:
        matches.extend((match.start(), match.group(0)) for match in pattern.finditer(text))
    seen: set[str] = set()
    result: list[str] = []
    for _position, value in sorted(matches, key=lambda item: (item[0], item[1])):
        normalized = value.strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return [value for value in result if not any(value != other and value in other for other in result)][:8]


def classify_slot(text: str) -> str:
    for kind, keywords in _KIND_KEYWORDS:
        if any(keyword in text for keyword in keywords):
            return kind
    return "other"


def split_information_slots(input_text: str) -> list[dict[str, object]]:
    """Split copy/outline text using fixed punctuation and line rules."""

    pieces: list[str] = []
    for raw_line in input_text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = _BULLET_PREFIX.sub("", raw_line.strip())
        if not line:
            continue
        for piece in _SPLIT_AFTER_PUNCTUATION.split(line):
            value = piece.strip()
            if not value:
                continue
            if len(value) > 512:
                raise MediaError("SLOT_INPUT_INVALID")
            pieces.append(value)
    if not pieces or len(pieces) > 32:
        raise MediaError("SLOT_INPUT_INVALID")
    return [
        {
            "slotId": f"slot-{index}",
            "order": index,
            "kind": classify_slot(text),
            "sourceText": text,
            "query": text,
            "keyFacts": extract_key_facts(text),
        }
        for index, text in enumerate(pieces, start=1)
    ]


class InformationSlotAlignmentService:
    """Align bounded user copy to complete, audited local sentence candidates."""

    def __init__(
        self,
        retrieval_service: SentenceRetrievalService | None = None,
        rerank_service: SentenceQualityRerankService | None = None,
    ) -> None:
        self.retrieval_service = retrieval_service or SentenceRetrievalService()
        self.rerank_service = rerank_service or SentenceQualityRerankService(self.retrieval_service)
        self._project_root: Path | None = None
        self._database: Any | None = None

    def bind_session(self, project_root: Path, database: Any) -> None:
        self._project_root = project_root
        self._database = database
        self.retrieval_service.bind_session(project_root, database)
        self.rerank_service.bind_session(project_root, database)

    async def align(self, request: SlotAlignmentParams, cancelled: asyncio.Event) -> SlotAlignmentResult:
        from supervideo_core.project.errors import ProjectError

        if self._project_root is None or self._database is None:
            raise ProjectError("PROJECT_NOT_ACTIVE")
        if cancelled.is_set():
            raise MediaError("SLOT_CANCELLED")
        try:
            raw_slots = split_information_slots(request.input_text)
            base = RetrievalParams(
                projectId=request.project_id,
                query=raw_slots[0]["query"],
                assetIds=request.asset_ids,
                limit=request.candidate_limit,
                timeoutMs=request.timeout_ms,
            )
            # B08 owns path, fingerprint, project and cache validation. B10 only
            # receives its trusted asset map and never resolves caller paths.
            assets = self.retrieval_service._resolve_assets(base)
            deadline = time.monotonic() + request.timeout_ms / 1_000
            slots: list[InformationSlot] = []
            for raw_slot in raw_slots:
                if cancelled.is_set():
                    raise MediaError("SLOT_CANCELLED")
                slot = await self._align_slot(request, raw_slot, assets, cancelled, deadline)
                slots.append(slot)
            matched_count = sum(slot.status == "matched" for slot in slots)
            result = SlotAlignmentResult(
                schemaVersion=SLOT_ALIGNMENT_SCHEMA_VERSION,
                alignmentVersion=SLOT_ALIGNMENT_VERSION,
                splitterVersion=SLOT_SPLITTER_VERSION,
                projectId=request.project_id,
                inputKind=request.input_kind,
                inputText=request.input_text,
                sourceDigest=hashlib.sha256(request.input_text.encode("utf-8")).hexdigest(),
                slotCount=len(slots),
                matchedCount=matched_count,
                slots=slots,
            )
            return validate_slot_alignment_size(result)
        except (MediaError, ProjectError, asyncio.CancelledError):
            raise
        except (ValidationError, TypeError, ValueError) as error:
            raise MediaError("SLOT_OUTPUT_INVALID", cause=error) from error
        except Exception as error:
            raise MediaError("SLOT_OUTPUT_INVALID", cause=error) from error

    async def _align_slot(
        self,
        request: SlotAlignmentParams,
        raw_slot: dict[str, object],
        assets: dict[str, tuple[Path, Any]],
        cancelled: asyncio.Event,
        deadline: float,
    ) -> InformationSlot:
        query = str(raw_slot["query"])
        retrieval_request = RetrievalParams(
            projectId=request.project_id,
            query=query,
            mode="hybrid",
            assetIds=request.asset_ids,
            limit=request.candidate_limit,
            timeoutMs=self._remaining_timeout(deadline),
        )
        try:
            retrieval = await self._await_with_cancel(
                self.retrieval_service.search(retrieval_request, cancelled), cancelled, deadline,
            )
        except MediaError as error:
            if error.code == "RETRIEVAL_INDEX_NOT_FOUND":
                return self._gap(raw_slot, "retrieval-index-not-found")
            self._raise_alignment_error(error)
            raise AssertionError("unreachable")
        self._validate_retrieval(retrieval, request, assets, query)

        origin = "b08-retrieval"
        source_candidates: list[Any] = list(retrieval.candidates)
        if request.use_rerank and source_candidates:
            rerank_request = RerankParams(
                projectId=request.project_id,
                query=query,
                mode="hybrid",
                assetIds=request.asset_ids,
                candidateLimit=request.candidate_limit,
                limit=request.candidate_limit,
                timeoutMs=self._remaining_timeout(deadline),
            )
            try:
                reranked = await self._await_with_cancel(
                    self.rerank_service.rerank(rerank_request, cancelled), cancelled, deadline,
                )
            except MediaError as error:
                self._raise_alignment_error(error)
                raise AssertionError("unreachable")
            self._validate_rerank(reranked, request, assets, query)
            source_candidates = list(reranked.candidates)
            origin = "b09-quality-rerank"

        key_facts = list(raw_slot["keyFacts"])
        eligible: list[SlotAlignmentCandidate] = []
        saw_candidate = bool(source_candidates)
        saw_fact_mismatch = False
        for candidate in source_candidates:
            if candidate.quality != "complete":
                continue
            preserved = [fact for fact in key_facts if fact in candidate.text]
            if len(preserved) != len(key_facts):
                saw_fact_mismatch = True
                continue
            score = candidate.scores.final_score if origin == "b09-quality-rerank" else candidate.score
            eligible.append(SlotAlignmentCandidate(
                rank=len(eligible) + 1,
                origin=origin,
                sentenceId=candidate.sentence_id,
                sourceAssetId=candidate.source_asset_id,
                sourceSentenceCacheKey=candidate.source_sentence_cache_key,
                sentenceIndex=candidate.sentence_index,
                timecode={"startMs": candidate.timecode.start_ms, "endMs": candidate.timecode.end_ms},
                text=candidate.text,
                score=score,
                quality=candidate.quality,
                previewUri=candidate.preview_uri,
                selectionReason=("b09-final-score;all-key-facts-preserved" if origin == "b09-quality-rerank" else "b08-hybrid-score;all-key-facts-preserved"),
                preservedFacts=preserved,
            ))
            if len(eligible) >= SLOT_ALIGNMENT_MAX_CANDIDATES:
                break

        if not eligible:
            reason = "no-retrieval-candidates" if not saw_candidate else "key-facts-not-preserved" if saw_fact_mismatch else "no-complete-sentence-candidate"
            return self._gap(raw_slot, reason)
        return InformationSlot(
            **raw_slot,
            status="matched",
            selectedCandidateRank=1,
            candidates=eligible,
            selectionReason=eligible[0].selection_reason,
        )

    @staticmethod
    def _gap(raw_slot: dict[str, object], reason: str) -> InformationSlot:
        return InformationSlot(**raw_slot, status="gap", candidates=[], gapReason=reason)

    @staticmethod
    def _validate_retrieval(result: RetrievalResult, request: SlotAlignmentParams, assets: dict[str, tuple[Path, Any]], query: str) -> None:
        if result.project_id != request.project_id or result.query != query or result.mode != "hybrid":
            raise MediaError("SLOT_RETRIEVAL_INVALID")
        allowed = set(request.asset_ids or assets.keys())
        for candidate in result.candidates:
            if candidate.source_asset_id not in allowed or candidate.source_asset_id not in assets:
                raise MediaError("SLOT_SOURCE_INVALID")
            expected_preview = f"supervideo://asset/{candidate.source_asset_id}?kind=audio&startMs={candidate.timecode.start_ms}&endMs={candidate.timecode.end_ms}"
            if candidate.preview_uri != expected_preview:
                raise MediaError("SLOT_SOURCE_INVALID")

    @staticmethod
    def _validate_rerank(result: RerankResult, request: SlotAlignmentParams, assets: dict[str, tuple[Path, Any]], query: str) -> None:
        if result.project_id != request.project_id or result.query != query or result.mode != "hybrid":
            raise MediaError("SLOT_RETRIEVAL_INVALID")
        allowed = set(request.asset_ids or assets.keys())
        for candidate in result.candidates:
            if candidate.source_asset_id not in allowed or candidate.source_asset_id not in assets:
                raise MediaError("SLOT_SOURCE_INVALID")

    @staticmethod
    def _remaining_timeout(deadline: float) -> int:
        remaining_ms = int((deadline - time.monotonic()) * 1_000)
        if remaining_ms < 1_000:
            raise MediaError("SLOT_TIMEOUT")
        return min(120_000, remaining_ms)

    @staticmethod
    async def _await_with_cancel(operation: Awaitable[Any], cancelled: asyncio.Event, deadline: float) -> Any:
        task = asyncio.create_task(operation)
        cancel_task = asyncio.create_task(cancelled.wait())
        try:
            remaining = max(0.001, deadline - time.monotonic())
            done, _ = await asyncio.wait({task, cancel_task}, timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
            if cancel_task in done and cancelled.is_set():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("SLOT_CANCELLED")
            if task not in done:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("SLOT_TIMEOUT")
            return await task
        finally:
            cancel_task.cancel()
            await asyncio.gather(cancel_task, return_exceptions=True)

    @staticmethod
    def _raise_alignment_error(error: MediaError) -> None:
        if error.code in {"RETRIEVAL_CANCELLED", "RERANK_CANCELLED"}:
            raise MediaError("SLOT_CANCELLED", cause=error)
        if error.code in {"RETRIEVAL_TIMEOUT", "RERANK_TIMEOUT"}:
            raise MediaError("SLOT_TIMEOUT", cause=error)
        if error.code in {"RETRIEVAL_INDEX_STALE", "RERANK_SOURCE_STALE"}:
            raise MediaError("SLOT_SOURCE_STALE", cause=error)
        if error.code in {"RETRIEVAL_INDEX_INVALID", "RERANK_SOURCE_INVALID"}:
            raise MediaError("SLOT_SOURCE_INVALID", cause=error)
        raise MediaError("SLOT_RETRIEVAL_INVALID", cause=error)
