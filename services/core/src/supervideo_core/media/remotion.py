"""D03 fixed local Remotion runtime seam and deterministic offline executor."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import stat
import tempfile
from pathlib import Path
from typing import Any

from .remotion_models import (
    REMOTION_BUNDLE_VERSION, REMOTION_JOB_TYPE, REMOTION_MAX_OUTPUT_BYTES, REMOTION_RENDER_VERSION,
    REMOTION_RUNTIME_MODE, REMOTION_TEMPLATE_ID, REMOTION_TEMPLATE_VERSION,
    RemotionRenderParams, RemotionRenderResult, compute_remotion_cache_key, compute_remotion_timeline_digest,
)


class RemotionRuntimeError(ValueError):
    pass


class RemotionRuntimeShutdown(Exception):
    pass


class RemotionRuntime:
    """Creates only a truthful contract artifact; it never executes a path or command from input."""

    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root.resolve()
        self.boundary = self.project_root / "generated" / "remotion-v1"

    async def renderMedia(self, params: RemotionRenderParams, *, cancel_event: asyncio.Event, shutdown_event: asyncio.Event, persist: Any) -> dict[str, object]:
        """Fixed D03 entry name; the implementation remains offline and command-free."""
        return await self.render(params, cancel_event=cancel_event, shutdown_event=shutdown_event, persist=persist)

    async def render(self, params: RemotionRenderParams, *, cancel_event: asyncio.Event, shutdown_event: asyncio.Event, persist: Any) -> dict[str, object]:
        try:
            return await self._render(params, cancel_event=cancel_event, shutdown_event=shutdown_event, persist=persist)
        except OSError as error:
            raise RemotionRuntimeError("Remotion filesystem operation failed") from error

    async def _render(self, params: RemotionRenderParams, *, cancel_event: asyncio.Event, shutdown_event: asyncio.Event, persist: Any) -> dict[str, object]:
        self._ensure_boundary()
        if cancel_event.is_set():
            raise asyncio.CancelledError
        timeline = params.input_props.timeline.model_dump(by_alias=True, exclude_none=True)
        timeline_digest = compute_remotion_timeline_digest(params)
        bundle_cache_key = self._digest({"bundleVersion": REMOTION_BUNDLE_VERSION, "templateId": REMOTION_TEMPLATE_ID, "templateVersion": REMOTION_TEMPLATE_VERSION})
        cache_key = compute_remotion_cache_key(params)
        output_rel = f"generated/remotion-v1/renders/{cache_key}.json"
        manifest_rel = f"generated/remotion-v1/renders/{cache_key}.manifest.json"
        output_path = self._safe_path(output_rel)
        manifest_path = self._safe_path(manifest_rel)
        cached = self._read_verified(params.project_id, cache_key, bundle_cache_key, timeline_digest, output_path, manifest_path)
        if cached is not None:
            return cached.model_dump(by_alias=True)
        await persist(1, "bundle-validated", {"executor": REMOTION_JOB_TYPE, "executorVersion": 1, "checkpointVersion": 1, "cacheKey": cache_key, "timelineDigest": timeline_digest})
        if cancel_event.is_set():
            raise asyncio.CancelledError
        if shutdown_event.is_set():
            raise RemotionRuntimeShutdown()
        bundle_path = self._safe_path(f"generated/remotion-v1/bundles/{bundle_cache_key}.json")
        self._atomic_json_write(bundle_path, {"schemaVersion": 1, "bundleVersion": REMOTION_BUNDLE_VERSION, "templateId": REMOTION_TEMPLATE_ID, "templateVersion": REMOTION_TEMPLATE_VERSION, "runtimeMode": REMOTION_RUNTIME_MODE})
        artifact = {
            "schemaVersion": 1,
            "artifactKind": "render-contract",
            "runtimeMode": REMOTION_RUNTIME_MODE,
            "projectId": params.project_id,
            "templateId": REMOTION_TEMPLATE_ID,
            "templateVersion": REMOTION_TEMPLATE_VERSION,
            "bundleVersion": REMOTION_BUNDLE_VERSION,
            "timelineDigest": timeline_digest,
            "sourceIds": [source["id"] for source in timeline["sources"]],
            "clipCount": sum(len(track["clips"]) for track in timeline["tracks"]),
            "durationMs": timeline["durationMs"],
        }
        encoded = json.dumps(artifact, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if not encoded or len(encoded) > REMOTION_MAX_OUTPUT_BYTES:
            raise RemotionRuntimeError("render artifact exceeds output limit")
        digest = hashlib.sha256(encoded).hexdigest()
        manifest = {
            "schemaVersion": 1,
            "manifestVersion": "remotion-manifest-v1",
            "projectId": params.project_id,
            "renderVersion": REMOTION_RENDER_VERSION,
            "runtimeMode": REMOTION_RUNTIME_MODE,
            "templateId": REMOTION_TEMPLATE_ID,
            "templateVersion": REMOTION_TEMPLATE_VERSION,
            "bundleVersion": REMOTION_BUNDLE_VERSION,
            "bundleCacheKey": bundle_cache_key,
            "cacheKey": cache_key,
            "timelineDigest": timeline_digest,
            "output": {"relativePath": output_rel, "sizeBytes": len(encoded), "sha256": digest},
            "provenance": {"sourceIds": artifact["sourceIds"], "sourcePathsIncluded": False},
        }
        self._atomic_bytes_write(output_path, encoded)
        self._atomic_json_write(manifest_path, manifest)
        result = RemotionRenderResult(
            schemaVersion=1, resultVersion="remotion-render-result-v1", projectId=params.project_id,
            runtimeMode=REMOTION_RUNTIME_MODE, templateId=REMOTION_TEMPLATE_ID, templateVersion=REMOTION_TEMPLATE_VERSION,
            bundleVersion=REMOTION_BUNDLE_VERSION, cacheStatus="created", cacheKey=cache_key, bundleCacheKey=bundle_cache_key,
            timelineDigest=timeline_digest,
            output={"artifactKind": "render-contract", "relativePath": output_rel, "manifestPath": manifest_rel, "sizeBytes": len(encoded), "sha256": digest},
            player={"availability": "contract-only", "compositionId": "timeline-preview-v1", "playbackUri": f"supervideo://remotion/{params.project_id}/{cache_key}"},
        )
        return result.model_dump(by_alias=True)

    def _ensure_boundary(self) -> None:
        self._ensure_directory(self.project_root / "generated")
        self._ensure_directory(self.boundary)

    def _safe_path(self, relative: str) -> Path:
        candidate = Path(relative)
        if candidate.is_absolute() or ".." in candidate.parts or candidate.parts[0:2] != ("generated", "remotion-v1"):
            raise RemotionRuntimeError("unsafe Remotion path")
        target = self.project_root.joinpath(*candidate.parts)
        try:
            if os.path.commonpath([str(self.project_root), str(target.resolve(strict=False))]) != str(self.project_root):
                raise RemotionRuntimeError("Remotion path escaped project")
        except ValueError as error:
            raise RemotionRuntimeError("Remotion path escaped project") from error
        current = self.project_root
        for part in candidate.parts:
            current = current / part
            if current.exists() and current.is_symlink():
                raise RemotionRuntimeError("symlinks are not allowed in Remotion boundary")
        self._ensure_directory(target.parent)
        return target

    @staticmethod
    def _ensure_directory(path: Path) -> None:
        if path.exists():
            if path.is_symlink() or not path.is_dir():
                raise RemotionRuntimeError("Remotion directory is not a regular directory")
            return
        path.mkdir(parents=True, exist_ok=False)

    @staticmethod
    def _digest(value: object) -> str:
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    @staticmethod
    def _atomic_bytes_write(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=f".{path.name}-", suffix=".tmp", dir=str(path.parent))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(name, path)
        finally:
            try: os.unlink(name)
            except FileNotFoundError: pass

    @classmethod
    def _atomic_json_write(cls, path: Path, value: dict[str, object]) -> None:
        cls._atomic_bytes_write(path, json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))

    @classmethod
    def _read_verified(cls, project_id: str, cache_key: str, bundle_cache_key: str, timeline_digest: str, output_path: Path, manifest_path: Path) -> RemotionRenderResult | None:
        try:
            if output_path.is_symlink() or manifest_path.is_symlink() or not stat.S_ISREG(output_path.stat().st_mode) or not stat.S_ISREG(manifest_path.stat().st_mode): return None
            encoded = output_path.read_bytes()
            if len(encoded) == 0 or len(encoded) > REMOTION_MAX_OUTPUT_BYTES: return None
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(manifest, dict) or set(manifest) != {"schemaVersion", "manifestVersion", "projectId", "renderVersion", "runtimeMode", "templateId", "templateVersion", "bundleVersion", "bundleCacheKey", "cacheKey", "timelineDigest", "output", "provenance"}: return None
            if manifest.get("schemaVersion") != 1 or manifest.get("manifestVersion") != "remotion-manifest-v1" or manifest.get("projectId") != project_id or manifest.get("renderVersion") != REMOTION_RENDER_VERSION or manifest.get("runtimeMode") != REMOTION_RUNTIME_MODE or manifest.get("templateId") != REMOTION_TEMPLATE_ID or manifest.get("templateVersion") != REMOTION_TEMPLATE_VERSION or manifest.get("bundleVersion") != REMOTION_BUNDLE_VERSION or manifest.get("cacheKey") != cache_key or manifest.get("bundleCacheKey") != bundle_cache_key or manifest.get("timelineDigest") != timeline_digest: return None
            output = manifest.get("output")
            if not isinstance(output, dict) or set(output) != {"relativePath", "sizeBytes", "sha256"} or output.get("relativePath") != f"generated/remotion-v1/renders/{cache_key}.json" or output.get("sizeBytes") != len(encoded) or output.get("sha256") != hashlib.sha256(encoded).hexdigest(): return None
            provenance = manifest.get("provenance")
            if not isinstance(provenance, dict) or provenance.get("sourcePathsIncluded") is not False or not isinstance(provenance.get("sourceIds"), list): return None
            return RemotionRenderResult(schemaVersion=1, resultVersion="remotion-render-result-v1", projectId=project_id, runtimeMode=REMOTION_RUNTIME_MODE, templateId=REMOTION_TEMPLATE_ID, templateVersion=REMOTION_TEMPLATE_VERSION, bundleVersion=REMOTION_BUNDLE_VERSION, cacheStatus="cache-hit", cacheKey=cache_key, bundleCacheKey=bundle_cache_key, timelineDigest=timeline_digest, output={"artifactKind": "render-contract", "relativePath": f"generated/remotion-v1/renders/{cache_key}.json", "manifestPath": f"generated/remotion-v1/renders/{cache_key}.manifest.json", "sizeBytes": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest()}, player={"availability": "contract-only", "compositionId": "timeline-preview-v1", "playbackUri": f"supervideo://remotion/{project_id}/{cache_key}"})
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
            return None
