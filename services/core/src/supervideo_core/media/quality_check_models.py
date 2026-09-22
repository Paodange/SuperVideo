"""Versioned C07 quality-check contracts for C06 preview plans and outputs."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import ConfigDict, Field, field_validator, model_validator

from .preview_render_models import PreviewRenderResult, PreviewRenderModel

QUALITY_CHECK_SCHEMA_VERSION = 1
QUALITY_CHECK_VERSION = "preview-quality-v1"
QUALITY_CHECK_MAX_ISSUES = 64
QUALITY_CHECK_MAX_MESSAGE_LENGTH = 256
QUALITY_CHECK_MAX_INPUT_BYTES = 512 * 1024
QUALITY_CHECK_MAX_RESULT_BYTES = 64 * 1024
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class QualityCheckModel(PreviewRenderModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class PreviewQualityCheckParams(QualityCheckModel):
    project_id: str = Field(alias="projectId")
    preview_result: PreviewRenderResult = Field(alias="previewResult")
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid quality-check project id")
        return value

    @model_validator(mode="after")
    def validate_input(self) -> "PreviewQualityCheckParams":
        if self.preview_result.project_id != self.project_id:
            raise ValueError("preview result belongs to another project")
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > QUALITY_CHECK_MAX_INPUT_BYTES:
            raise ValueError("quality-check input is too large")
        return self


QualitySeverity = Literal["pass", "warning", "fail"]
QualityCheckStatus = Literal["verified", "not-run"]
QualityIssueCode = Literal[
    "QA_PLAN_BINDING_INVALID",
    "QA_PLAN_ORDER_INVALID",
    "QA_PLAN_RANGE_INVALID",
    "QA_PLAN_GAP",
    "QA_EXECUTION_NOT_RUN",
    "QA_OUTPUT_MISSING",
    "QA_OUTPUT_PATH_INVALID",
    "QA_OUTPUT_FILE_INVALID",
    "QA_OUTPUT_SIZE_MISMATCH",
    "QA_OUTPUT_FINGERPRINT_MISMATCH",
    "QA_OUTPUT_MANIFEST_INVALID",
    "QA_OUTPUT_DURATION_MISMATCH",
    "QA_OUTPUT_CONTAINER_UNVERIFIED",
    "QA_OUTPUT_CONTAINER_INVALID",
]


class PreviewQualityIssue(QualityCheckModel):
    check_id: str = Field(alias="checkId", min_length=1, max_length=64)
    code: QualityIssueCode
    severity: QualitySeverity
    status: QualityCheckStatus
    message: str = Field(min_length=1, max_length=QUALITY_CHECK_MAX_MESSAGE_LENGTH)


class PreviewQualityCheckResult(QualityCheckModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    qa_version: Literal["preview-quality-v1"] = Field(alias="qaVersion")
    project_id: str = Field(alias="projectId")
    plan_digest: str = Field(alias="planDigest")
    phase: Literal["plan", "executed"]
    status: Literal["pass", "warning", "fail"]
    ready_for_export: bool = Field(alias="readyForExport")
    execution_verified: bool = Field(alias="executionVerified")
    issue_count: int = Field(alias="issueCount", strict=True, ge=1, le=QUALITY_CHECK_MAX_ISSUES)
    issues: list[PreviewQualityIssue] = Field(min_length=1, max_length=QUALITY_CHECK_MAX_ISSUES)

    @field_validator("project_id")
    @classmethod
    def validate_result_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid quality-check project id")
        return value

    @field_validator("plan_digest")
    @classmethod
    def validate_plan_digest(cls, value: str) -> str:
        if SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid quality-check plan digest")
        return value

    @model_validator(mode="after")
    def validate_result(self) -> "PreviewQualityCheckResult":
        if self.issue_count != len(self.issues):
            raise ValueError("quality-check issue count mismatch")
        severities = {issue.severity for issue in self.issues}
        expected = "fail" if "fail" in severities else "warning" if "warning" in severities else "pass"
        if self.status != expected:
            raise ValueError("quality-check status mismatch")
        if self.phase == "plan" and self.execution_verified:
            raise ValueError("quality-check plan cannot verify execution")
        if not self.execution_verified or "fail" in severities:
            if self.ready_for_export:
                raise ValueError("unverified or failed quality check cannot be export-ready")
        return self


def validate_quality_check_size(result: PreviewQualityCheckResult) -> PreviewQualityCheckResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > QUALITY_CHECK_MAX_RESULT_BYTES:
        raise ValueError("quality-check result is too large")
    return result
