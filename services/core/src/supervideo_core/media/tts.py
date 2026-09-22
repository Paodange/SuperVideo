"""D02 deterministic offline TTS adapter and project-scoped cache."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import tempfile
import wave
from pathlib import Path
from typing import Any, Protocol

from pydantic import ValidationError

from .tts_models import (
    TTS_ADAPTER_VERSION,
    TTS_CONTRACT_VERSION,
    TTS_MAX_DURATION_MS,
    TTS_MAX_OUTPUT_BYTES,
    TTS_OUTPUT_DIRECTORY,
    TTS_SCHEMA_VERSION,
    TtsAudioOutput,
    TtsJobInput,
    TtsProvenance,
    TtsSentenceTimestamp,
    TtsSynthesisResult,
)


class TtsExecutionCancelled(Exception):
    """The durable job reached a cancellation safe point."""


class TtsExecutionShutdown(Exception):
    """The durable job reached a shutdown safe point."""


class TtsAdapter(Protocol):
    provider_id: str
    adapter_version: str

    def synthesize_sentence(self, text: str, *, model: str, voice: str) -> tuple[bytes, int]:
        """Return deterministic mono PCM frames and their duration in ms."""


class DeterministicFakeTtsAdapter:
    """Offline adapter used by D02 smoke/tests; it never reads a credential."""

    provider_id = "fake"
    adapter_version = TTS_ADAPTER_VERSION
    sample_rate = 22_050

    def synthesize_sentence(self, text: str, *, model: str, voice: str) -> tuple[bytes, int]:
        if model == "fake-fail":
            raise ValueError("deterministic fake failure")
        # Keep the fake output small and deterministic while making voice/model
        # changes audible and observable in the fingerprint.
        seed = hashlib.sha256(f"{model}\0{voice}\0{text}".encode("utf-8")).digest()
        duration_ms = min(5_000, max(280, 260 + len(text) * 42 + seed[0] % 61))
        frame_count = round(self.sample_rate * duration_ms / 1_000)
        frequency = 180 + (int.from_bytes(seed[1:3], "big") % 420)
        amplitude = 2_000 + (seed[3] % 1_000)
        frames = bytearray()
        for index in range(frame_count):
            sample = int(amplitude * math.sin(2 * math.pi * frequency * index / self.sample_rate))
            frames.extend(sample.to_bytes(2, "little", signed=True))
        return bytes(frames), duration_ms


class TtsAdapterRegistry:
    """Fixed provider-id registry; future adapters can be registered explicitly."""

    def __init__(self, adapters: tuple[TtsAdapter, ...] | None = None) -> None:
        entries = adapters or (DeterministicFakeTtsAdapter(),)
        self._adapters: dict[str, TtsAdapter] = {}
        for adapter in entries:
            if adapter.provider_id in self._adapters:
                raise ValueError("duplicate tts provider")
            self._adapters[adapter.provider_id] = adapter

    def get(self, provider_id: str) -> TtsAdapter | None:
        return self._adapters.get(provider_id)


class TtsSynthesisService:
    """Writes only validated generated audio below the active project root."""

    def __init__(self, *, registry: TtsAdapterRegistry | None = None) -> None:
        self.registry = registry or TtsAdapterRegistry()
        self._project_root: Path | None = None

    def bind_session(self, project_root: Path) -> None:
        self._project_root = project_root

    @staticmethod
    def cache_key(project_id: str, params: TtsJobInput, adapter_version: str = TTS_ADAPTER_VERSION) -> str:
        canonical = {
            "schemaVersion": TTS_SCHEMA_VERSION,
            "contractVersion": TTS_CONTRACT_VERSION,
            "adapterVersion": adapter_version,
            "projectId": project_id,
            "providerId": params.provider_id,
            "model": params.model,
            "voice": params.voice,
            "sentences": [
                {"sentenceId": item.sentence_id, "text": item.text, "provenanceIds": list(item.provenance_ids)}
                for item in params.sentences
            ],
        }
        return hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    async def synthesize(
        self,
        project_id: str,
        params: TtsJobInput,
        *,
        cancel_event: asyncio.Event,
        shutdown_event: asyncio.Event,
        completed_sentences: int,
        persist: Any,
    ) -> TtsSynthesisResult:
        project_root = self._project_root
        if project_root is None:
            raise ValueError("tts project session is not bound")
        adapter = self.registry.get(params.provider_id)
        if adapter is None:
            raise ValueError("tts provider is not registered")
        cache_key = self.cache_key(project_id, params, adapter.adapter_version)
        output_dir = project_root / TTS_OUTPUT_DIRECTORY
        self._ensure_output_directory(project_root, output_dir)
        output_path = output_dir / f"{cache_key}.wav"
        manifest_path = output_dir / f"{cache_key}.json"
        cached = self._read_cache(manifest_path, output_path, project_id, params, cache_key, adapter.adapter_version)
        if cached is not None:
            return cached.model_copy(update={"cache_status": "cache-hit"})

        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(prefix=f".{cache_key[:16]}-", suffix=".wav.tmp", dir=output_dir, delete=False) as handle:
                temporary_path = Path(handle.name)
            timestamps: list[TtsSentenceTimestamp] = []
            cursor_ms = 0
            with wave.open(str(temporary_path), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(getattr(adapter, "sample_rate", 22_050))
                for index, sentence in enumerate(params.sentences):
                    if shutdown_event.is_set():
                        raise TtsExecutionShutdown()
                    if cancel_event.is_set():
                        raise TtsExecutionCancelled()
                    frames, duration_ms = adapter.synthesize_sentence(sentence.text, model=params.model, voice=params.voice)
                    if duration_ms <= 0 or len(frames) == 0:
                        raise ValueError("tts adapter returned empty audio")
                    cursor_ms += duration_ms
                    if cursor_ms > TTS_MAX_DURATION_MS:
                        raise ValueError("tts output is too long")
                    output.writeframes(frames)
                    timestamps.append(TtsSentenceTimestamp(
                        sentenceId=sentence.sentence_id,
                        text=sentence.text,
                        startMs=cursor_ms - duration_ms,
                        endMs=cursor_ms,
                        provenanceIds=list(sentence.provenance_ids),
                    ))
                    if index + 1 > completed_sentences:
                        checkpoint = {
                            "executor": "tts.synthesize",
                            "executorVersion": 1,
                            "checkpointVersion": 1,
                            "cacheKey": cache_key,
                            "sentenceCount": len(params.sentences),
                            "completedSentences": index + 1,
                            "nextSentence": index + 2,
                        }
                        await persist(index + 1, f"sentence-{index + 1}", checkpoint)
                    await asyncio.sleep(0)
            size_bytes = temporary_path.stat().st_size
            if size_bytes <= 0 or size_bytes > TTS_MAX_OUTPUT_BYTES:
                raise ValueError("tts output size is invalid")
            os.replace(temporary_path, output_path)
            temporary_path = None
            fingerprint = self._sha256_file(output_path)
            result = TtsSynthesisResult(
                schemaVersion=TTS_SCHEMA_VERSION,
                contractVersion=TTS_CONTRACT_VERSION,
                adapterVersion=adapter.adapter_version,
                projectId=project_id,
                cacheStatus="created",
                cacheKey=cache_key,
                providerId=params.provider_id,
                model=params.model,
                voice=params.voice,
                durationMs=cursor_ms,
                sentences=timestamps,
                output=TtsAudioOutput(
                    kind="audio",
                    relativePath=f"{TTS_OUTPUT_DIRECTORY}/{cache_key}.wav",
                    sizeBytes=size_bytes,
                    durationMs=cursor_ms,
                    outputFingerprint=fingerprint,
                ),
                provenance=TtsProvenance(
                    kind="generated",
                    providerId=params.provider_id,
                    model=params.model,
                    voice=params.voice,
                    adapterVersion=adapter.adapter_version,
                ),
            )
            self._atomic_json_write(manifest_path, {"schemaVersion": TTS_SCHEMA_VERSION, "cacheKey": cache_key, "result": result.model_dump(by_alias=True)})
            return result
        except (TtsExecutionCancelled, TtsExecutionShutdown):
            raise
        except (OSError, ValueError, ValidationError) as error:
            raise ValueError("tts output is invalid") from error
        finally:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass

    def _read_cache(
        self,
        manifest_path: Path,
        output_path: Path,
        project_id: str,
        params: TtsJobInput,
        cache_key: str,
        adapter_version: str,
    ) -> TtsSynthesisResult | None:
        try:
            if manifest_path.is_symlink() or output_path.is_symlink() or not manifest_path.is_file() or not output_path.is_file():
                return None
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            if payload.get("schemaVersion") != TTS_SCHEMA_VERSION or payload.get("cacheKey") != cache_key:
                return None
            result = TtsSynthesisResult.model_validate(payload.get("result"))
            expected_relative_path = f"{TTS_OUTPUT_DIRECTORY}/{cache_key}.wav"
            if result.project_id != project_id or result.cache_key != cache_key or result.adapter_version != adapter_version or result.provider_id != params.provider_id or result.model != params.model or result.voice != params.voice or result.output.relative_path != expected_relative_path:
                return None
            if len(result.sentences) != len(params.sentences) or any(
                timestamp.sentence_id != sentence.sentence_id
                or timestamp.text != sentence.text
                or timestamp.provenance_ids != sentence.provenance_ids
                for timestamp, sentence in zip(result.sentences, params.sentences)
            ):
                return None
            stat = output_path.stat()
            if stat.st_size != result.output.size_bytes or stat.st_size <= 0 or stat.st_size > TTS_MAX_OUTPUT_BYTES:
                return None
            if self._sha256_file(output_path) != result.output.output_fingerprint:
                return None
            return result
        except (OSError, ValueError, TypeError, ValidationError, json.JSONDecodeError):
            return None

    @staticmethod
    def _ensure_output_directory(project_root: Path, output_dir: Path) -> None:
        try:
            root = project_root.resolve(strict=True)
            output_dir.mkdir(parents=True, exist_ok=True)
            resolved = output_dir.resolve(strict=True)
            if resolved != root / TTS_OUTPUT_DIRECTORY or root not in resolved.parents:
                raise ValueError("tts output directory escaped project")
        except (OSError, RuntimeError) as error:
            raise ValueError("tts output directory is unavailable") from error

    @staticmethod
    def _sha256_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(64 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

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
