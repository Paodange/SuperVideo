"""Deterministic C07 checks for C06 preview plans and rendered outputs."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from pathlib import Path

from pydantic import ValidationError

from .errors import MediaError
from .preview_render_models import PreviewRenderOutput, PreviewRenderResult
from .quality_check_models import (
    PreviewQualityCheckParams,
    PreviewQualityCheckResult,
    PreviewQualityIssue,
    QUALITY_CHECK_SCHEMA_VERSION,
    QUALITY_CHECK_VERSION,
    validate_quality_check_size,
)
from .service import MediaService

PREVIEW_OUTPUT_PATTERN = re.compile(r"^previews/preview-render-v1/([0-9a-f]{64})\.mp4$")
MANIFEST_MAX_BYTES = 16 * 1024
MEDIA_DURATION_TOLERANCE_MS = 100


class PreviewQualityCheckService:
    """Checks only Core-owned, bounded C06 data and project output files."""

    def __init__(self, *, ffprobe_path: str | None = None) -> None:
        self.ffprobe_path = MediaService._resolve_tool(ffprobe_path, "ffprobe")
        self._project_root: Path | None = None

    def bind_session(self, project_root: Path, _database: object) -> None:
        self._project_root = project_root

    async def check(self, request: PreviewQualityCheckParams, cancelled: asyncio.Event) -> PreviewQualityCheckResult:
        if cancelled.is_set():
            raise MediaError("PREVIEW_QUALITY_CANCELLED")
        preview = request.preview_result
        issues: list[PreviewQualityIssue] = []
        self._check_plan(preview, issues)
        if preview.execution_mode == "plan" or preview.execution_status == "not-run":
            self._add(issues, "execution", "QA_EXECUTION_NOT_RUN", "warning", "not-run", "Preview execution has not run; output checks were not performed.")
            return self._result(request.project_id, preview, "plan", False, issues)

        deadline = asyncio.get_running_loop().time() + request.timeout_ms / 1_000
        if self._project_root is None:
            raise MediaError("PROJECT_NOT_ACTIVE")
        if preview.output is None:
            self._add(issues, "output-present", "QA_OUTPUT_MISSING", "fail", "verified", "Executed preview has no output record.")
            return self._result(request.project_id, preview, "executed", False, issues)

        output = preview.output
        match = PREVIEW_OUTPUT_PATTERN.fullmatch(output.relative_path)
        output_path: Path | None = None
        if match is None or match.group(1) != preview.plan_digest:
            self._add(issues, "output-path", "QA_OUTPUT_PATH_INVALID", "fail", "verified", "Preview output path is outside the versioned preview boundary.")
        else:
            output_path = self._safe_project_path(output.relative_path)
            self._add(issues, "output-path", "QA_OUTPUT_PATH_INVALID", "pass" if output_path is not None else "fail", "verified", "Preview output path is inside the versioned preview boundary." if output_path is not None else "Preview output path is unsafe.")

        if output_path is None:
            return self._result(request.project_id, preview, "executed", False, issues)
        try:
            file_valid = output_path.exists() and not output_path.is_symlink() and output_path.is_file() and output_path.stat().st_size > 0
        except OSError:
            file_valid = False
        if not file_valid:
            self._add(issues, "output-file", "QA_OUTPUT_FILE_INVALID", "fail", "verified", "Preview output file is missing or is not a regular non-empty file.")
            return self._result(request.project_id, preview, "executed", False, issues)
        self._add(issues, "output-present", "QA_OUTPUT_MISSING", "pass", "verified", "Preview output file exists.")
        try:
            actual_size = output_path.stat().st_size
            fingerprint = _sha256_file(output_path)
        except OSError:
            self._add(issues, "output-file", "QA_OUTPUT_FILE_INVALID", "fail", "verified", "Preview output could not be read reliably.")
            return self._result(request.project_id, preview, "executed", False, issues)
        self._add(issues, "output-size", "QA_OUTPUT_SIZE_MISMATCH", "pass" if actual_size == output.size_bytes else "fail", "verified", "Preview output size matches its result record." if actual_size == output.size_bytes else "Preview output size does not match its result record.")
        self._add(issues, "output-fingerprint", "QA_OUTPUT_FINGERPRINT_MISMATCH", "pass" if fingerprint == output.output_fingerprint else "fail", "verified", "Preview output fingerprint matches its result record." if fingerprint == output.output_fingerprint else "Preview output fingerprint does not match its result record.")
        self._check_manifest(output_path, request.project_id, preview, output, issues)
        self._add(issues, "output-duration", "QA_OUTPUT_DURATION_MISMATCH", "pass" if output.duration_ms == preview.timeline_duration_ms else "fail", "verified", "Declared preview duration matches the plan duration." if output.duration_ms == preview.timeline_duration_ms else "Declared preview duration does not match the plan duration.")

        if self.ffprobe_path is None:
            self._add(issues, "output-container", "QA_OUTPUT_CONTAINER_UNVERIFIED", "warning", "not-run", "Container and media duration could not be verified because ffprobe is unavailable.")
        else:
            remaining_ms = max(1_000, int((deadline - asyncio.get_running_loop().time()) * 1_000))
            if remaining_ms <= 0:
                raise MediaError("PREVIEW_QUALITY_TIMEOUT")
            try:
                raw = await MediaService._run(
                    [self.ffprobe_path, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(output_path)],
                    remaining_ms,
                    cancelled,
                    overflow_code="PREVIEW_QUALITY_OUTPUT_INVALID",
                    stdout_limit=128 * 1024,
                )
                metadata = MediaService._parse_probe(raw)
            except MediaError as error:
                if error.code == "MEDIA_CANCELLED":
                    raise MediaError("PREVIEW_QUALITY_CANCELLED") from error
                if error.code == "MEDIA_TOOL_TIMEOUT":
                    raise MediaError("PREVIEW_QUALITY_TIMEOUT") from error
                self._add(issues, "output-container", "QA_OUTPUT_CONTAINER_INVALID", "fail", "verified", "Preview container information could not be verified.")
            else:
                duration_ok = metadata.duration_ms is not None and abs(metadata.duration_ms - output.duration_ms) <= MEDIA_DURATION_TOLERANCE_MS
                has_video = any(stream.codec_type == "video" for stream in metadata.streams)
                self._add(issues, "output-container", "QA_OUTPUT_CONTAINER_INVALID", "pass" if has_video else "fail", "verified", "Preview contains a video stream." if has_video else "Preview does not contain a video stream.")
                self._add(issues, "output-media-duration", "QA_OUTPUT_DURATION_MISMATCH", "pass" if duration_ok else "fail", "verified", "Measured media duration matches the declared duration." if duration_ok else "Measured media duration does not match the declared duration.")

        return self._result(request.project_id, preview, "executed", True, issues)

    def _check_plan(self, preview: PreviewRenderResult, issues: list[PreviewQualityIssue]) -> None:
        bindings = {item.source_id for item in preview.source_bindings}
        binding_ok = len(bindings) == len(preview.source_bindings) and all(item.segment_count > 0 for item in preview.source_bindings)
        self._add(issues, "plan-binding", "QA_PLAN_BINDING_INVALID", "pass" if binding_ok else "fail", "verified", "C04 source bindings are unique and non-empty." if binding_ok else "C04 source bindings are duplicated or empty.")
        order_ok = [cue.order for cue in preview.cues] == list(range(1, len(preview.cues) + 1)) and all(cue.source_id in bindings for cue in preview.cues)
        self._add(issues, "plan-order", "QA_PLAN_ORDER_INVALID", "pass" if order_ok else "fail", "verified", "C05 cues retain stable order and bind to a C04 source." if order_ok else "C05 cues are out of order or reference an unknown C04 source.")
        cursor = 0
        range_ok = True
        for cue in preview.cues:
            if cue.output_start_ms < cursor or cue.output_end_ms > preview.timeline_duration_ms or cue.output_end_ms - cue.output_start_ms != cue.duration_ms:
                range_ok = False
                break
            cursor = cue.output_end_ms
        self._add(issues, "plan-ranges", "QA_PLAN_RANGE_INVALID", "pass" if range_ok else "fail", "verified", "C05 cue ranges are ordered, bounded, and non-overlapping." if range_ok else "C05 cue ranges overlap or exceed the preview duration.")
        self._add(issues, "plan-gaps", "QA_PLAN_GAP", "fail" if preview.gaps else "pass", "verified", "No C04/C05 mapping gaps remain." if not preview.gaps else "C04/C05 mapping contains an uncovered gap.")

    def _check_manifest(self, output_path: Path, project_id: str, preview: PreviewRenderResult, output: PreviewRenderOutput, issues: list[PreviewQualityIssue]) -> None:
        manifest_path = output_path.with_name(f"{preview.plan_digest}.manifest.json")
        valid = False
        try:
            if not manifest_path.is_symlink() and manifest_path.is_file() and manifest_path.stat().st_size <= MANIFEST_MAX_BYTES:
                value = json.loads(manifest_path.read_text(encoding="utf-8"))
                expected = {"schemaVersion", "projectId", "planDigest", "relativePath", "sizeBytes", "durationMs", "outputFingerprint"}
                valid = isinstance(value, dict) and set(value) == expected and value == {
                    "schemaVersion": 1,
                    "projectId": project_id,
                    "planDigest": preview.plan_digest,
                    "relativePath": output.relative_path,
                    "sizeBytes": output.size_bytes,
                    "durationMs": output.duration_ms,
                    "outputFingerprint": output.output_fingerprint,
                }
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError):
            valid = False
        self._add(issues, "output-manifest", "QA_OUTPUT_MANIFEST_INVALID", "pass" if valid else "fail", "verified", "Preview manifest matches the output record." if valid else "Preview manifest is missing or does not match the output record.")

    def _safe_project_path(self, relative_path: str) -> Path | None:
        assert self._project_root is not None
        root = self._project_root.resolve()
        candidate = self._project_root / relative_path
        try:
            if candidate.is_symlink():
                return None
            cursor = candidate.parent
            while cursor != root:
                if cursor.is_symlink():
                    return None
                cursor = cursor.parent
            resolved = candidate.resolve()
            if os.path.commonpath([str(root), str(resolved)]) != str(root):
                return None
            return resolved
        except (OSError, ValueError):
            return None

    @staticmethod
    def _add(issues: list[PreviewQualityIssue], check_id: str, code: str, severity: str, status: str, message: str) -> None:
        issues.append(PreviewQualityIssue(checkId=check_id, code=code, severity=severity, status=status, message=message))  # type: ignore[arg-type]

    @staticmethod
    def _result(project_id: str, preview: PreviewRenderResult, phase: str, execution_verified: bool, issues: list[PreviewQualityIssue]) -> PreviewQualityCheckResult:
        status = "fail" if any(issue.severity == "fail" for issue in issues) else "warning" if any(issue.severity == "warning" for issue in issues) else "pass"
        ready = execution_verified and status != "fail" and all(issue.status == "verified" for issue in issues)
        try:
            return validate_quality_check_size(PreviewQualityCheckResult(
                schemaVersion=QUALITY_CHECK_SCHEMA_VERSION,
                qaVersion=QUALITY_CHECK_VERSION,
                projectId=project_id,
                planDigest=preview.plan_digest,
                phase=phase,
                status=status,
                readyForExport=ready,
                executionVerified=execution_verified and all(issue.status == "verified" for issue in issues),
                issueCount=len(issues),
                issues=issues,
            ))
        except (TypeError, ValueError, ValidationError) as error:
            raise MediaError("PREVIEW_QUALITY_OUTPUT_INVALID", cause=error) from error


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
