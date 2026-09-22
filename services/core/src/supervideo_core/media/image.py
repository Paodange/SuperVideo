"""D06 deterministic offline image adapter and project-scoped PNG cache."""

from __future__ import annotations

import asyncio
import binascii
import hashlib
import json
import os
import stat
import struct
import tempfile
import zlib
from pathlib import Path
from typing import Any, Protocol

from pydantic import ValidationError

from .image_models import (
    IMAGE_ADAPTER_VERSION,
    IMAGE_CONTRACT_VERSION,
    IMAGE_JOB_TYPE,
    IMAGE_MAX_OUTPUT_BYTES,
    IMAGE_MAX_RESULT_BYTES,
    IMAGE_OUTPUT_DIRECTORY,
    IMAGE_SCHEMA_VERSION,
    ImageGenerationProvenance,
    ImageGenerationResult,
    ImageJobInput,
    ImageOutput,
)


class ImageExecutionCancelled(Exception):
    """The durable image job reached a cancellation safe point."""


class ImageExecutionShutdown(Exception):
    """The durable image job reached a shutdown safe point."""


class ImageAdapter(Protocol):
    provider_id: str
    adapter_version: str

    def generate(self, params: ImageJobInput) -> bytes:
        """Return a deterministic PNG; adapters never receive credentials in Core."""


class DeterministicFakeImageAdapter:
    """Small deterministic PNG generator. It never reads a credential or uses a network."""

    provider_id = "fake"
    adapter_version = IMAGE_ADAPTER_VERSION

    def generate(self, params: ImageJobInput) -> bytes:
        if params.model == "fake-fail":
            raise ValueError("deterministic fake failure")
        canonical = {
            "providerId": params.provider_id,
            "model": params.model,
            "shotId": params.shot_id,
            "promptSha256": hashlib.sha256(params.prompt.encode("utf-8")).hexdigest(),
            "parameters": params.parameters.model_dump(),
            "source": params.source.model_dump(),
            "provenance": [item.model_dump() for item in params.provenance],
        }
        seed = hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).digest()
        width, height = params.parameters.width, params.parameters.height
        rows = bytearray()
        for y in range(height):
            rows.append(0)
            for x in range(width):
                offset = (x * 3 + y * 5) % len(seed)
                rows.extend((seed[offset] ^ (x & 0x1F), seed[(offset + 7) % len(seed)] ^ (y & 0x1F), seed[(offset + 13) % len(seed)], 255))
        metadata = json.dumps({"adapter": self.adapter_version, "source": canonical["source"], "parameters": canonical["parameters"], "provenance": canonical["provenance"]}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        chunks = [
            _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)),
            _png_chunk(b"tEXt", b"SuperVideo\0" + metadata.encode("utf-8")),
            _png_chunk(b"IDAT", zlib.compress(bytes(rows), level=9)),
            _png_chunk(b"IEND", b""),
        ]
        output = b"\x89PNG\r\n\x1a\n" + b"".join(chunks)
        if len(output) <= 0 or len(output) > IMAGE_MAX_OUTPUT_BYTES:
            raise ValueError("image output is too large")
        return output


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data) & 0xFFFFFFFF)


class ImageAdapterRegistry:
    def __init__(self, adapters: tuple[ImageAdapter, ...] | None = None) -> None:
        entries = adapters or (DeterministicFakeImageAdapter(),)
        self._adapters: dict[str, ImageAdapter] = {}
        for adapter in entries:
            if adapter.provider_id in self._adapters:
                raise ValueError("duplicate image provider")
            self._adapters[adapter.provider_id] = adapter

    def get(self, provider_id: str) -> ImageAdapter | None:
        return self._adapters.get(provider_id)


class ImageGenerationService:
    """Writes only validated generated images below the active project root."""

    def __init__(self, *, registry: ImageAdapterRegistry | None = None) -> None:
        self.registry = registry or ImageAdapterRegistry()
        self._project_root: Path | None = None

    def bind_session(self, project_root: Path) -> None:
        self._project_root = project_root

    @staticmethod
    def cache_key(project_id: str, params: ImageJobInput, adapter_version: str = IMAGE_ADAPTER_VERSION) -> str:
        canonical = {
            "schemaVersion": IMAGE_SCHEMA_VERSION,
            "contractVersion": IMAGE_CONTRACT_VERSION,
            "jobType": IMAGE_JOB_TYPE,
            "adapterVersion": adapter_version,
            "projectId": project_id,
            "providerId": params.provider_id,
            "model": params.model,
            "shotId": params.shot_id,
            "prompt": params.prompt,
            "parameters": params.parameters.model_dump(),
            "source": params.source.model_dump(),
            "provenance": [item.model_dump() for item in params.provenance],
        }
        return hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    async def generate(
        self,
        project_id: str,
        params: ImageJobInput,
        *,
        cancel_event: asyncio.Event,
        shutdown_event: asyncio.Event,
        persist: Any,
    ) -> ImageGenerationResult:
        project_root = self._project_root
        if project_root is None:
            raise ValueError("image project session is not bound")
        adapter = self.registry.get(params.provider_id)
        if adapter is None:
            raise ValueError("image provider is not registered")
        cache_key = self.cache_key(project_id, params, adapter.adapter_version)
        output_dir = project_root / IMAGE_OUTPUT_DIRECTORY
        self._ensure_output_directory(project_root, output_dir)
        output_path = output_dir / f"{cache_key}.png"
        manifest_path = output_dir / f"{cache_key}.json"
        cached = self._read_cache(manifest_path, output_path, project_id, params, cache_key, adapter.adapter_version)
        if cached is not None:
            return cached.model_copy(update={"cache_status": "cache-hit"})
        if shutdown_event.is_set():
            raise ImageExecutionShutdown()
        if cancel_event.is_set():
            raise ImageExecutionCancelled()
        await persist(1, "image-prepared", {"executor": IMAGE_JOB_TYPE, "executorVersion": 1, "checkpointVersion": 1, "cacheKey": cache_key, "completed": 0, "nextStep": 1})
        await asyncio.sleep(0)
        if shutdown_event.is_set():
            raise ImageExecutionShutdown()
        if cancel_event.is_set():
            raise ImageExecutionCancelled()
        try:
            image_bytes = adapter.generate(params)
            self._validate_png(image_bytes, params.parameters.width, params.parameters.height)
            self._atomic_bytes_write(output_path, image_bytes)
            fingerprint = hashlib.sha256(image_bytes).hexdigest()
            result = ImageGenerationResult(
                schemaVersion=IMAGE_SCHEMA_VERSION,
                contractVersion=IMAGE_CONTRACT_VERSION,
                adapterVersion=adapter.adapter_version,
                projectId=project_id,
                cacheStatus="created",
                cacheKey=cache_key,
                providerId=params.provider_id,
                model=params.model,
                shotId=params.shot_id,
                prompt=params.prompt,
                parameters=params.parameters,
                source=params.source,
                provenance=params.provenance,
                output=ImageOutput(kind="image", mimeType="image/png", relativePath=f"{IMAGE_OUTPUT_DIRECTORY}/{cache_key}.png", sizeBytes=len(image_bytes), width=params.parameters.width, height=params.parameters.height, outputFingerprint=fingerprint),
                generationProvenance=ImageGenerationProvenance(kind="generated", providerId=params.provider_id, model=params.model, adapterVersion=adapter.adapter_version, source=params.source, provenance=params.provenance),
            )
            self._atomic_json_write(manifest_path, {"schemaVersion": IMAGE_SCHEMA_VERSION, "contractVersion": IMAGE_CONTRACT_VERSION, "cacheKey": cache_key, "result": result.model_dump(by_alias=True)})
            return result
        except (ImageExecutionCancelled, ImageExecutionShutdown):
            raise
        except (OSError, ValueError, ValidationError) as error:
            raise ValueError("image output is invalid") from error

    def _read_cache(self, manifest_path: Path, output_path: Path, project_id: str, params: ImageJobInput, cache_key: str, adapter_version: str) -> ImageGenerationResult | None:
        try:
            expected_dir = (self._project_root / IMAGE_OUTPUT_DIRECTORY).resolve(strict=True) if self._project_root is not None else None
            output_dir = output_path.parent.resolve(strict=True)
            manifest_stat = manifest_path.stat()
            output_stat = output_path.stat()
            if expected_dir is None or output_dir != expected_dir or manifest_path.is_symlink() or output_path.is_symlink() or not stat.S_ISREG(manifest_stat.st_mode) or not stat.S_ISREG(output_stat.st_mode) or manifest_path.resolve(strict=True).parent != output_dir or output_path.resolve(strict=True).parent != output_dir:
                return None
            if manifest_path.stat().st_size > IMAGE_MAX_RESULT_BYTES * 2:
                return None
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict) or set(payload) != {"schemaVersion", "contractVersion", "cacheKey", "result"} or payload.get("schemaVersion") != IMAGE_SCHEMA_VERSION or payload.get("contractVersion") != IMAGE_CONTRACT_VERSION or payload.get("cacheKey") != cache_key:
                return None
            result = ImageGenerationResult.model_validate(payload.get("result"))
            expected_relative_path = f"{IMAGE_OUTPUT_DIRECTORY}/{cache_key}.png"
            if result.cache_status != "created" or result.project_id != project_id or result.cache_key != cache_key or result.adapter_version != adapter_version or result.provider_id != params.provider_id or result.model != params.model or result.shot_id != params.shot_id or result.prompt != params.prompt or result.parameters != params.parameters or result.source != params.source or result.provenance != params.provenance or result.output.relative_path != expected_relative_path:
                return None
            if output_stat.st_size != result.output.size_bytes or output_stat.st_size <= 0 or output_stat.st_size > IMAGE_MAX_OUTPUT_BYTES:
                return None
            data = output_path.read_bytes()
            self._validate_png(data, params.parameters.width, params.parameters.height)
            if hashlib.sha256(data).hexdigest() != result.output.output_fingerprint:
                return None
            return result
        except (OSError, ValueError, TypeError, ValidationError, json.JSONDecodeError, KeyError):
            return None

    @staticmethod
    def _validate_png(data: bytes, width: int, height: int) -> None:
        if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or struct.unpack(">I", data[8:12])[0] != 13 or data[12:16] != b"IHDR":
            raise ValueError("invalid png")
        actual_width, actual_height = struct.unpack(">II", data[16:24])
        if actual_width != width or actual_height != height or data[24] != 8 or data[25] != 6 or b"IEND" not in data[-16:]:
            raise ValueError("invalid png dimensions")

    @staticmethod
    def _ensure_output_directory(project_root: Path, output_dir: Path) -> None:
        try:
            root = project_root.resolve(strict=True)
            output_dir.mkdir(parents=True, exist_ok=True)
            resolved = output_dir.resolve(strict=True)
            if resolved != root / IMAGE_OUTPUT_DIRECTORY or root not in resolved.parents:
                raise ValueError("image output directory escaped project")
        except (OSError, RuntimeError) as error:
            raise ValueError("image output directory is unavailable") from error

    @staticmethod
    def _atomic_bytes_write(path: Path, data: bytes) -> None:
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(prefix=f".{path.stem}-", suffix=".png.tmp", dir=path.parent, delete=False) as handle:
                temporary_path = Path(handle.name)
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, path)
            temporary_path = None
        finally:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass

    @staticmethod
    def _atomic_json_write(path: Path, value: dict[str, object]) -> None:
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(prefix=f".{path.stem}-", suffix=".json.tmp", dir=path.parent, mode="w", encoding="utf-8", newline="\n", delete=False) as handle:
                temporary_path = Path(handle.name)
                json.dump(value, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, path)
            temporary_path = None
        finally:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass
