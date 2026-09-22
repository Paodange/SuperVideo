"""Deterministic, project-scoped E01 research orchestration."""

from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any

from pydantic import ValidationError

from supervideo_core.storage import (
    Database,
    ResearchRepository,
    ResearchSearchRecord,
    SourceRecord,
    StorageError,
    new_id,
    serialize_json_value,
    utc_now_ms,
)

from .errors import ResearchError
from .models import (
    RESEARCH_CONTRACT_VERSION,
    RESEARCH_MAX_SOURCE_JSON_BYTES,
    ResearchEvidence,
    ResearchProvenance,
    ResearchSaveSourceParams,
    ResearchSaveSourceResult,
    ResearchSearchHit,
    ResearchSearchParams,
    ResearchSearchResult,
    ResearchSourceInput,
    ResearchSourceRecord,
)
from .transport import DeterministicFakeResearchTransport, ResearchTransport, ResearchTransportHit


class ResearchService:
    """Owns validation, replay, deterministic ordering and source persistence."""

    def __init__(self, transport: ResearchTransport | None = None) -> None:
        self.transport = transport or DeterministicFakeResearchTransport()
        self.database: Database | None = None

    def bind_session(self, database: Database) -> None:
        self.database = database

    async def search(self, request: ResearchSearchParams, cancelled: asyncio.Event) -> ResearchSearchResult:
        database = self._require_database()
        repository = ResearchRepository(database)
        request_digest = _digest(_search_identity(request))
        try:
            existing = repository.get_search_by_idempotency(request.project_id, request.idempotency_key)
            if existing is not None:
                return self._replay_search(existing, request, request_digest)
            existing_request = repository.get_search_by_request_id(request.project_id, request.request_id)
            if existing_request is not None:
                return self._replay_search(existing_request, request, request_digest)
        except StorageError as error:
            raise ResearchError("RESEARCH_STORAGE_INVALID", cause=error) from error

        if cancelled.is_set():
            raise ResearchError("RESEARCH_CANCELLED")
        try:
            raw_hits = await asyncio.wait_for(
                self.transport.search(request, cancelled),
                timeout=request.timeout_ms / 1_000,
            )
        except ResearchError:
            raise
        except TimeoutError as error:
            raise ResearchError("RESEARCH_TIMEOUT", cause=error) from error
        except asyncio.CancelledError as error:
            raise ResearchError("RESEARCH_CANCELLED", cause=error) from error
        except Exception as error:
            raise ResearchError("RESEARCH_TRANSPORT_UNAVAILABLE", cause=error) from error
        if cancelled.is_set():
            raise ResearchError("RESEARCH_CANCELLED")

        result = self._build_search_result(request, raw_hits)
        result_wire = result.model_dump(mode="json", by_alias=True)
        _ensure_bounded_json(result_wire, RESEARCH_MAX_SOURCE_JSON_BYTES * 8)
        record = ResearchSearchRecord(
            id=new_id(),
            project_id=request.project_id,
            request_id=request.request_id,
            idempotency_key=request.idempotency_key,
            request_digest=request_digest,
            result_json=result_wire,
            created_at_ms=result.created_at_ms,
        )
        try:
            with database.transaction():
                existing = repository.get_search_by_idempotency(request.project_id, request.idempotency_key)
                if existing is not None:
                    return self._replay_search(existing, request, request_digest)
                existing_request = repository.get_search_by_request_id(request.project_id, request.request_id)
                if existing_request is not None:
                    return self._replay_search(existing_request, request, request_digest)
                repository.create_search(record)
        except ResearchError:
            raise
        except StorageError as error:
            if error.code == "CONSTRAINT_VIOLATION":
                try:
                    race = repository.get_search_by_idempotency(request.project_id, request.idempotency_key)
                    if race is not None:
                        return self._replay_search(race, request, request_digest)
                except StorageError as lookup_error:
                    raise ResearchError("RESEARCH_STORAGE_INVALID", cause=lookup_error) from lookup_error
            raise ResearchError("RESEARCH_STORAGE_INVALID", cause=error) from error
        return result

    def save_source(self, request: ResearchSaveSourceParams) -> ResearchSaveSourceResult:
        database = self._require_database()
        repository = ResearchRepository(database)
        source = request.source
        expected_content_digest, expected_source_digest = source_digests(source)
        if source.content_digest != expected_content_digest or source.source_digest != expected_source_digest:
            raise ResearchError("RESEARCH_SOURCE_INVALID")
        _ensure_bounded_json(source.model_dump(mode="json", by_alias=True), RESEARCH_MAX_SOURCE_JSON_BYTES)

        try:
            with database.transaction():
                existing_by_key = repository.get_source_by_idempotency(request.project_id, request.idempotency_key)
                if existing_by_key is not None:
                    if existing_by_key.source_digest != source.source_digest:
                        raise ResearchError("RESEARCH_IDEMPOTENCY_CONFLICT")
                    record = self._source_record(existing_by_key)
                    return self._save_result(request, "existing", record)
                existing_by_digest = repository.get_source_by_digest(request.project_id, source.source_digest)
                if existing_by_digest is not None:
                    record = self._source_record(existing_by_digest)
                    return self._save_result(request, "duplicate", record)
                record = SourceRecord(
                    id=new_id(),
                    project_id=request.project_id,
                    url=source.url,
                    title=source.title,
                    summary=source.summary,
                    site_name=source.site_name,
                    author=source.author,
                    fetched_at_ms=source.fetched_at_ms,
                    content_digest=source.content_digest,
                    source_digest=source.source_digest,
                    evidence_json=source.evidence.model_dump(mode="json", by_alias=True),
                    provenance_json=source.provenance.model_dump(mode="json", by_alias=True),
                    idempotency_key=request.idempotency_key,
                    created_at_ms=utc_now_ms(),
                )
                repository.create_source(record)
        except ResearchError:
            raise
        except (StorageError, ValidationError) as error:
            raise ResearchError("RESEARCH_STORAGE_INVALID", cause=error) from error
        return self._save_result(request, "created", self._source_record(record))

    def _build_search_result(self, request: ResearchSearchParams, raw_hits: tuple[ResearchTransportHit, ...]) -> ResearchSearchResult:
        candidates: dict[str, ResearchSearchHit] = {}
        for hit in raw_hits:
            source = self._source_input(hit)
            candidates[source.source_digest] = ResearchSearchHit(
                **source.model_dump(),
                rank=1,
                matchScore=hit.match_score,
            )
        ordered = sorted(candidates.values(), key=lambda item: (-item.match_score, item.source_digest, item.url))[: request.limit]
        ranked = tuple(item.model_copy(update={"rank": index}) for index, item in enumerate(ordered, start=1))
        created_at_ms = min((item.fetched_at_ms for item in ranked), default=utc_now_ms())
        return ResearchSearchResult(
            schemaVersion=1,
            contractVersion=RESEARCH_CONTRACT_VERSION,
            projectId=request.project_id,
            requestId=request.request_id,
            idempotencyKey=request.idempotency_key,
            searchId=new_id(),
            status="fresh",
            topic=request.topic,
            audience=request.audience,
            query=request.query,
            limit=request.limit,
            transport="deterministic-fake-v1",
            createdAtMs=created_at_ms,
            results=list(ranked),
        )

    def _source_input(self, hit: ResearchTransportHit) -> ResearchSourceInput:
        try:
            evidence = ResearchEvidence(status="unverified", citations=list(hit.citations), facts=list(hit.facts))
            provenance = ResearchProvenance(transport="deterministic-fake-v1", fixtureId=hit.fixture_id)
            content_digest, source_digest = _draft_digests(
                hit.url,
                hit.title,
                hit.summary,
                hit.site_name,
                hit.author,
                evidence,
                provenance,
            )
            return ResearchSourceInput(
                url=hit.url,
                title=hit.title,
                summary=hit.summary,
                siteName=hit.site_name,
                author=hit.author,
                fetchedAtMs=hit.fetched_at_ms,
                contentDigest=content_digest,
                sourceDigest=source_digest,
                evidence=evidence,
                provenance=provenance,
            )
        except ResearchError:
            raise
        except (TypeError, ValueError, ValidationError) as error:
            raise ResearchError("RESEARCH_SOURCE_INVALID", cause=error) from error

    def _replay_search(self, record: ResearchSearchRecord, request: ResearchSearchParams, request_digest: str) -> ResearchSearchResult:
        if record.project_id != request.project_id or record.request_digest != request_digest:
            raise ResearchError("RESEARCH_IDEMPOTENCY_CONFLICT")
        try:
            result = ResearchSearchResult.model_validate(record.result_json)
        except (TypeError, ValueError, ValidationError) as error:
            raise ResearchError("RESEARCH_STORAGE_INVALID", cause=error) from error
        if result.project_id != request.project_id or result.idempotency_key != request.idempotency_key:
            raise ResearchError("RESEARCH_IDEMPOTENCY_CONFLICT")
        return result.model_copy(update={"status": "replayed"})

    @staticmethod
    def _source_record(record: SourceRecord) -> ResearchSourceRecord:
        try:
            return ResearchSourceRecord(
                sourceId=record.id,
                projectId=record.project_id,
                url=record.url,
                title=record.title,
                summary=record.summary,
                siteName=record.site_name,
                author=record.author,
                fetchedAtMs=record.fetched_at_ms,
                contentDigest=record.content_digest,
                sourceDigest=record.source_digest,
                evidence=record.evidence_json,
                provenance=record.provenance_json,
                createdAtMs=record.created_at_ms,
            )
        except (TypeError, ValueError, ValidationError) as error:
            raise ResearchError("RESEARCH_STORAGE_INVALID", cause=error) from error

    @staticmethod
    def _save_result(request: ResearchSaveSourceParams, status: str, record: ResearchSourceRecord) -> ResearchSaveSourceResult:
        return ResearchSaveSourceResult(
            schemaVersion=1,
            contractVersion=RESEARCH_CONTRACT_VERSION,
            projectId=request.project_id,
            requestId=request.request_id,
            idempotencyKey=request.idempotency_key,
            status=status,
            record=record,
        )  # type: ignore[arg-type]

    def _require_database(self) -> Database:
        if self.database is None:
            raise ResearchError("RESEARCH_STORAGE_INVALID")
        return self.database


def source_digests(source: ResearchSourceInput) -> tuple[str, str]:
    return _draft_digests(
        source.url,
        source.title,
        source.summary,
        source.site_name,
        source.author,
        source.evidence,
        source.provenance,
    )


def _draft_digests(
    url: str,
    title: str,
    summary: str,
    site_name: str | None,
    author: str | None,
    evidence: ResearchEvidence,
    provenance: ResearchProvenance,
) -> tuple[str, str]:
    evidence_wire = evidence.model_dump(by_alias=True)
    provenance_wire = provenance.model_dump(by_alias=True)
    content_digest = _digest({"algorithm": "summary-content-v1", "title": title, "summary": summary, "evidence": evidence_wire})
    source_digest = _digest(
        {
            "schemaVersion": 1,
            "contractVersion": RESEARCH_CONTRACT_VERSION,
            "url": url,
            "title": title,
            "summary": summary,
            "siteName": site_name,
            "author": author,
            "contentDigest": content_digest,
            "evidence": evidence_wire,
            "provenance": provenance_wire,
        }
    )
    return content_digest, source_digest


def _search_identity(request: ResearchSearchParams) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "contractVersion": RESEARCH_CONTRACT_VERSION,
        "projectId": request.project_id,
        "requestId": request.request_id,
        "idempotencyKey": request.idempotency_key,
        "topic": request.topic,
        "audience": request.audience,
        "query": request.query,
        "limit": request.limit,
        "timeoutMs": request.timeout_ms,
    }


def _digest(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _ensure_bounded_json(value: object, maximum_bytes: int) -> None:
    try:
        if len(serialize_json_value(value).encode("utf-8")) > maximum_bytes:
            raise ResearchError("RESEARCH_SOURCE_INVALID")
    except (TypeError, ValueError, OverflowError) as error:
        raise ResearchError("RESEARCH_SOURCE_INVALID", cause=error) from error
