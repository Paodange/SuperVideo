"""Strict, bounded Python models for the versioned research contract."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .errors import ResearchError
from .url_security import canonicalize_public_url

RESEARCH_SCHEMA_VERSION = 1
RESEARCH_CONTRACT_VERSION = "research-v1"
RESEARCH_MAX_RESULTS = 10
RESEARCH_MAX_CITATIONS = 8
RESEARCH_MAX_FACTS = 8
RESEARCH_MAX_SOURCE_JSON_BYTES = 16 * 1024
_UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_DIGEST_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_SECRET_OR_PATH = re.compile(
    r"(?:^[A-Za-z]:[\\/]|^\\\\|^(?:/|\\)(?!https?://)|sk-[A-Za-z0-9]{12,}|(?:api[_-]?key|access[_-]?token|bearer|password|secret)\s*[:=]|https?://|(?:file|data|javascript):)",
    re.IGNORECASE,
)


class ResearchModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True, frozen=True)


def _safe_text(value: str, maximum: int) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum or value != value.strip():
        raise ValueError("bounded text is invalid")
    if any(ord(character) < 32 or ord(character) == 127 for character in value) or _SECRET_OR_PATH.search(value):
        raise ValueError("bounded text is invalid")
    return value


def _validate_id(value: str, maximum: int) -> str:
    if not isinstance(value, str) or len(value) > maximum or _ID_PATTERN.fullmatch(value) is None:
        raise ValueError("identifier is invalid")
    return value


def _validate_project_id(value: str) -> str:
    if not isinstance(value, str) or _UUID_PATTERN.fullmatch(value) is None:
        raise ValueError("project id is invalid")
    return value


def _validate_64_id(value: str) -> str:
    return _validate_id(value, 64)


def _validate_128_id(value: str) -> str:
    return _validate_id(value, 128)


def _quote_text(value: str) -> str:
    return _safe_text(value, 512)


def _statement_text(value: str) -> str:
    return _safe_text(value, 512)


def _title_text(value: str) -> str:
    return _safe_text(value, 240)


def _summary_text(value: str) -> str:
    return _safe_text(value, 4_000)


def _topic_text(value: str) -> str:
    return _safe_text(value, 160)


def _audience_text(value: str) -> str:
    return _safe_text(value, 160)


def _query_text(value: str) -> str:
    return _safe_text(value, 512)


def _validate_request_id(value: str) -> str:
    return _validate_id(value, 64)


def _validate_idempotency_key(value: str) -> str:
    return _validate_id(value, 128)


def _validate_digest(value: str) -> str:
    if not isinstance(value, str) or _DIGEST_PATTERN.fullmatch(value) is None:
        raise ValueError("digest is invalid")
    return value


def _validate_ids(value: tuple[str, ...]) -> tuple[str, ...]:
    if len(set(value)) != len(value) or any(_ID_PATTERN.fullmatch(item) is None for item in value):
        raise ValueError("identifiers must be unique and bounded")
    return value


def _optional_safe_text(value: str | None) -> str | None:
    return None if value is None else _safe_text(value, 160)


class ResearchCitation(ResearchModel):
    citation_id: str = Field(alias="citationId", min_length=1, max_length=64)
    locator: Literal["title", "summary"]
    quote: str = Field(min_length=1, max_length=512)

    _citation_id = field_validator("citation_id")(_validate_64_id)
    _quote = field_validator("quote")(_quote_text)


class ResearchFact(ResearchModel):
    fact_id: str = Field(alias="factId", min_length=1, max_length=64)
    statement: str = Field(min_length=1, max_length=512)
    citation_ids: list[str] = Field(alias="citationIds", min_length=1, max_length=RESEARCH_MAX_CITATIONS)

    _fact_id = field_validator("fact_id")(_validate_64_id)
    _statement = field_validator("statement")(_statement_text)
    _citation_ids = field_validator("citation_ids")(_validate_ids)


class ResearchEvidence(ResearchModel):
    status: Literal["unverified"]
    citations: list[ResearchCitation] = Field(max_length=RESEARCH_MAX_CITATIONS)
    facts: list[ResearchFact] = Field(max_length=RESEARCH_MAX_FACTS)

    @model_validator(mode="after")
    def validate_references(self) -> "ResearchEvidence":
        citation_ids = [item.citation_id for item in self.citations]
        if len(set(citation_ids)) != len(citation_ids):
            raise ValueError("citation ids must be unique")
        fact_ids = [item.fact_id for item in self.facts]
        if len(set(fact_ids)) != len(fact_ids):
            raise ValueError("fact ids must be unique")
        known = set(citation_ids)
        if any(citation_id not in known for fact in self.facts for citation_id in fact.citation_ids):
            raise ValueError("fact citation is not declared")
        return self


class ResearchProvenance(ResearchModel):
    transport: Literal["deterministic-fake-v1"]
    fixture_id: str = Field(alias="fixtureId", min_length=1, max_length=64)

    _fixture_id = field_validator("fixture_id")(_validate_64_id)


class ResearchSourceInput(ResearchModel):
    url: str = Field(min_length=1, max_length=2_048)
    title: str = Field(min_length=1, max_length=240)
    summary: str = Field(min_length=1, max_length=4_000)
    site_name: str | None = Field(alias="siteName", default=None, max_length=160)
    author: str | None = Field(default=None, max_length=160)
    fetched_at_ms: int = Field(alias="fetchedAtMs", strict=True, ge=0)
    content_digest: str = Field(alias="contentDigest", min_length=64, max_length=64)
    source_digest: str = Field(alias="sourceDigest", min_length=64, max_length=64)
    evidence: ResearchEvidence
    provenance: ResearchProvenance

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        try:
            return canonicalize_public_url(value)
        except ResearchError as error:
            # Domain policy failures must become Pydantic validation errors at
            # the RPC boundary rather than escaping as service exceptions.
            raise ValueError("url is invalid") from error

    _title = field_validator("title")(_title_text)
    _summary = field_validator("summary")(_summary_text)
    _site_name = field_validator("site_name")(_optional_safe_text)
    _author = field_validator("author")(_optional_safe_text)
    _content_digest = field_validator("content_digest")(_validate_digest)
    _source_digest = field_validator("source_digest")(_validate_digest)


class ResearchSourceRecord(ResearchSourceInput):
    source_id: str = Field(alias="sourceId", min_length=1, max_length=64)
    project_id: str = Field(alias="projectId")
    created_at_ms: int = Field(alias="createdAtMs", strict=True, ge=0)

    _source_id = field_validator("source_id")(_validate_64_id)
    _project_id = field_validator("project_id")(_validate_project_id)


class ResearchSearchHit(ResearchSourceInput):
    rank: int = Field(strict=True, ge=1, le=RESEARCH_MAX_RESULTS)
    match_score: float = Field(alias="matchScore", strict=True, ge=0.0, le=1.0)


class ResearchSearchParams(ResearchModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal["research-v1"] = Field(alias="contractVersion")
    project_id: str = Field(alias="projectId")
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=128)
    topic: str = Field(min_length=1, max_length=160)
    audience: str = Field(min_length=1, max_length=160)
    query: str = Field(min_length=1, max_length=512)
    limit: int = Field(default=5, strict=True, ge=1, le=RESEARCH_MAX_RESULTS)
    timeout_ms: int = Field(default=10_000, alias="timeoutMs", strict=True, ge=1, le=120_000)

    _project_id = field_validator("project_id")(_validate_project_id)
    _request_id = field_validator("request_id")(_validate_request_id)
    _idempotency_key = field_validator("idempotency_key")(_validate_idempotency_key)
    _topic = field_validator("topic")(_topic_text)
    _audience = field_validator("audience")(_audience_text)
    _query = field_validator("query")(_query_text)


class ResearchSearchResult(ResearchModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal["research-v1"] = Field(alias="contractVersion")
    project_id: str = Field(alias="projectId")
    request_id: str = Field(alias="requestId")
    idempotency_key: str = Field(alias="idempotencyKey")
    search_id: str = Field(alias="searchId")
    status: Literal["fresh", "replayed"]
    topic: str
    audience: str
    query: str
    limit: int = Field(strict=True, ge=1, le=RESEARCH_MAX_RESULTS)
    transport: Literal["deterministic-fake-v1"]
    created_at_ms: int = Field(alias="createdAtMs", strict=True, ge=0)
    results: list[ResearchSearchHit] = Field(max_length=RESEARCH_MAX_RESULTS)

    _project_id = field_validator("project_id")(_validate_project_id)
    _request_id = field_validator("request_id")(_validate_request_id)
    _idempotency_key = field_validator("idempotency_key")(_validate_idempotency_key)
    _search_id = field_validator("search_id")(_validate_128_id)
    _topic = field_validator("topic")(_topic_text)
    _audience = field_validator("audience")(_audience_text)
    _query = field_validator("query")(_query_text)

    @model_validator(mode="after")
    def validate_order(self) -> "ResearchSearchResult":
        if any(item.rank != index for index, item in enumerate(self.results, start=1)):
            raise ValueError("research results must be ranked deterministically")
        return self


class ResearchSaveSourceParams(ResearchModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal["research-v1"] = Field(alias="contractVersion")
    project_id: str = Field(alias="projectId")
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=128)
    source: ResearchSourceInput

    _project_id = field_validator("project_id")(_validate_project_id)
    _request_id = field_validator("request_id")(_validate_request_id)
    _idempotency_key = field_validator("idempotency_key")(_validate_idempotency_key)


class ResearchSaveSourceResult(ResearchModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal["research-v1"] = Field(alias="contractVersion")
    project_id: str = Field(alias="projectId")
    request_id: str = Field(alias="requestId")
    idempotency_key: str = Field(alias="idempotencyKey")
    status: Literal["created", "existing", "duplicate"]
    record: ResearchSourceRecord

    _project_id = field_validator("project_id")(_validate_project_id)
    _request_id = field_validator("request_id")(_validate_request_id)
    _idempotency_key = field_validator("idempotency_key")(_validate_idempotency_key)

    @model_validator(mode="after")
    def validate_record_scope(self) -> "ResearchSaveSourceResult":
        if self.record.project_id != self.project_id:
            raise ValueError("source record must belong to the project")
        return self




def _optional_safe_text(value: str | None) -> str | None:
    return None if value is None else _safe_text(value, 160)
