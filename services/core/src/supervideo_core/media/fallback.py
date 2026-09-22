"""D08 deterministic generation failure resolution before D07 assembly."""

from __future__ import annotations

from collections.abc import Mapping

from .fallback_models import (
    GENERATION_FALLBACK_CONTRACT_VERSION,
    GENERATION_FALLBACK_POLICY_VERSION,
    GENERATION_FALLBACK_RUNTIME_MODE,
    GENERATION_FALLBACK_SCHEMA_VERSION,
    GenerationFallbackAttempt,
    GenerationFallbackDiagnostic,
    GenerationFallbackFailure,
    GenerationFallbackParams,
    GenerationFallbackResult,
    GenerationFallbackShot,
    GenerationFallbackTts,
    fallback_input_digest,
    fallback_result_digest,
    storyboard_digest_projection,
    video_assembly_digest_projection,
)
from .video_assembly_models import VideoAssemblyParams


class GenerationFallbackService:
    """Resolve each shot independently without calling a provider or writing media."""

    def resolve(self, request: GenerationFallbackParams) -> GenerationFallbackResult:
        images = {item.shot_id: item for item in request.image_results}
        materials = {item.shot_id: item for item in request.user_materials}
        image_failures = {item.shot_id: item for item in request.image_failures}
        animation_failures = {item.shot_id: item for item in request.animation_failures}
        text_card_unavailable = set(request.text_card_unavailable_shot_ids)
        source_segments = [request.storyboard.script.hook, *request.storyboard.script.body, request.storyboard.script.cta]
        segments = {item.segment_id: item for item in source_segments}
        resolved_shots = []
        resolutions: list[GenerationFallbackShot] = []

        for shot in request.storyboard.shots:
            segment = segments[shot.segment_id]
            if segment.status == "gap":
                attempts = [
                    GenerationFallbackAttempt(
                        source=source,
                        outcome="unavailable",
                        error=GenerationFallbackDiagnostic(code="FALLBACK_SOURCE_GAP", stage="storyboard"),
                        provenance=[],
                    )
                    for source in shot.visual_source_priority
                ]
                resolutions.append(
                    GenerationFallbackShot(
                        shotId=shot.shot_id,
                        order=shot.order,
                        segmentId=shot.segment_id,
                        status="unresolved",
                        chosenSource=None,
                        fallbackReason="source-gap",
                        d05FallbackReason=shot.fallback_reason,
                        d07Binding=None,
                        attempts=attempts,
                        provenance=["d08:policy:generation-fallback-v1"],
                        diagnostic=GenerationFallbackDiagnostic(code="FALLBACK_SOURCE_GAP", stage="storyboard"),
                    )
                )
                resolved_shots.append(shot)
                continue

            attempts: list[GenerationFallbackAttempt] = []
            selected = None
            selected_provenance: list[str] = []
            saw_failure = False
            for source in shot.visual_source_priority:
                available, provenance, attempt = self._candidate(
                    source,
                    shot.shot_id,
                    segment.segment_id,
                    images,
                    materials,
                    image_failures,
                    animation_failures,
                    text_card_unavailable,
                    request,
                )
                attempts.append(attempt)
                if available:
                    selected = source
                    selected_provenance = provenance
                    attempts[-1] = attempt.model_copy(update={"outcome": "selected", "error": None, "provenance": provenance})
                    break
                saw_failure = saw_failure or attempt.outcome == "failed"

            d07_binding = "user-material" if selected == "user-material" else "d06-image" if selected == "ai-image" else None
            diagnostic = (
                GenerationFallbackDiagnostic(code="FALLBACK_CANDIDATES_EXHAUSTED", stage="selection")
                if selected is None
                else GenerationFallbackDiagnostic(code="FALLBACK_D07_SOURCE_UNSUPPORTED", stage="d07-binding")
                if d07_binding is None
                else None
            )
            fallback_reason = (
                "candidates-exhausted"
                if selected is None
                else "none"
                if attempts[0].outcome == "selected"
                else "generation-failed"
                if saw_failure
                else "source-unavailable"
            )
            resolutions.append(
                GenerationFallbackShot(
                    shotId=shot.shot_id,
                    order=shot.order,
                    segmentId=shot.segment_id,
                    status="unresolved" if selected is None else "resolved",
                    chosenSource=selected,
                    fallbackReason=fallback_reason,
                    d05FallbackReason=shot.fallback_reason,
                    d07Binding=d07_binding,
                    attempts=attempts,
                    provenance=selected_provenance or ["d08:policy:generation-fallback-v1"],
                    diagnostic=diagnostic,
                )
            )
            resolved_shots.append(
                shot.model_copy(
                    update=(
                        {"fallback_reason": "no-user-material", "visual_source_priority": ["licensed-stock", "ai-image", "remotion-template", "text-card"]}
                        if selected != "user-material" and shot.fallback_reason == "planned"
                        else {}
                    )
                )
            )

        resolved_storyboard = request.storyboard.model_copy(update={"shots": resolved_shots})
        tts = self._resolve_tts(request)
        d07_request = self._build_d07_request(request, resolved_storyboard, resolutions) if tts.d07_binding is not None and all(item.status == "resolved" and item.d07_binding is not None for item in resolutions) and resolved_storyboard.status != "gaps" and resolved_storyboard.duration_status == "within-tolerance" and all(item.status == "matched" and item.duration_ms > 0 for item in [resolved_storyboard.script.hook, *resolved_storyboard.script.body, resolved_storyboard.script.cta]) else None
        d07_diagnostic = None if d07_request is not None else self._first_d07_diagnostic(tts, resolutions)
        status = "ready" if d07_request is not None else "blocked" if tts.status == "fallback" or any(item.status == "unresolved" for item in resolutions) else "partial"
        d07_eligible = d07_request is not None
        input_digest = fallback_input_digest(request)
        digest_seed = {
            "schemaVersion": GENERATION_FALLBACK_SCHEMA_VERSION,
            "contractVersion": GENERATION_FALLBACK_CONTRACT_VERSION,
            "policyVersion": GENERATION_FALLBACK_POLICY_VERSION,
            "projectId": request.project_id,
            "timelineId": request.timeline_id,
            "assemblyId": request.assembly_id,
            "status": status,
            "d07Eligible": d07_eligible,
            "inputDigest": input_digest,
            "storyboardDigest": request.storyboard.source_plan_digest,
            "tts": self._tts_digest(tts),
            "shots": [self._shot_digest(item) for item in resolutions],
            "d07Diagnostic": d07_diagnostic.model_dump(by_alias=True) if d07_diagnostic is not None else None,
            "resolvedStoryboard": storyboard_digest_projection(resolved_storyboard),
            "videoAssemblyRequest": video_assembly_digest_projection(d07_request) if d07_request is not None else None,
        }
        result = GenerationFallbackResult(
            schemaVersion=GENERATION_FALLBACK_SCHEMA_VERSION,
            contractVersion=GENERATION_FALLBACK_CONTRACT_VERSION,
            policyVersion=GENERATION_FALLBACK_POLICY_VERSION,
            runtimeMode=GENERATION_FALLBACK_RUNTIME_MODE,
            projectId=request.project_id,
            timelineId=request.timeline_id,
            assemblyId=request.assembly_id,
            status=status,
            d07Eligible=d07_eligible,
            inputDigest=input_digest,
            resultDigest=self._sha256_json(digest_seed),
            storyboard=request.storyboard,
            resolvedStoryboard=resolved_storyboard,
            tts=tts,
            shots=resolutions,
            d07Diagnostic=d07_diagnostic,
            videoAssemblyRequest=d07_request,
        )
        if result.result_digest != fallback_result_digest(result):
            raise ValueError("D08 result digest mismatch")
        return result

    @staticmethod
    def _resolve_tts(request: GenerationFallbackParams) -> GenerationFallbackTts:
        if request.tts is not None:
            return GenerationFallbackTts(
                status="available",
                chosenSource="d02-tts",
                fallbackReason="none",
                d07Binding="d02-tts",
                failure=None,
                provenance=["d08:policy:generation-fallback-v1", f"d02:tts:{request.tts.cache_key}"],
                diagnostic=None,
            )
        return GenerationFallbackTts(
            status="fallback",
            chosenSource="silence-placeholder",
            fallbackReason="generation-failed",
            d07Binding=None,
            failure=request.tts_failure,
            provenance=["d08:policy:generation-fallback-v1"],
            diagnostic=GenerationFallbackDiagnostic(code="FALLBACK_TTS_AUDIO_UNAVAILABLE", stage="tts"),
        )

    @staticmethod
    def _candidate(source: str, shot_id: str, segment_id: str, images: Mapping[str, object], materials: Mapping[str, object], image_failures: Mapping[str, GenerationFallbackFailure], animation_failures: Mapping[str, GenerationFallbackFailure], text_card_unavailable: set[str], request: GenerationFallbackParams) -> tuple[bool, list[str], GenerationFallbackAttempt]:
        if source == "user-material":
            material = materials.get(shot_id)
            if material is None:
                return False, [], _unavailable(source)
            provenance_id = material.provenance_id  # type: ignore[union-attr]
            return True, ["d08:policy:generation-fallback-v1", f"user-material:{provenance_id}"], GenerationFallbackAttempt(source=source, outcome="selected", error=None, provenance=[])
        if source == "licensed-stock":
            return False, [], _unavailable(source)
        if source == "ai-image":
            failure = image_failures.get(shot_id)
            image = images.get(shot_id)
            if failure is not None:
                return False, [], GenerationFallbackAttempt(source=source, outcome="failed", error=failure, provenance=[])
            if image is None:
                return False, [], _unavailable(source)
            return True, ["d08:policy:generation-fallback-v1", f"d06:image:{image.cache_key}"], GenerationFallbackAttempt(source=source, outcome="selected", error=None, provenance=[])
        if source == "remotion-template":
            failure = animation_failures.get(shot_id)
            if failure is not None:
                return False, [], GenerationFallbackAttempt(source=source, outcome="failed", error=failure, provenance=[])
            return True, ["d08:policy:generation-fallback-v1", f"d04:template:{request.d04_plan.template_version}"], GenerationFallbackAttempt(source=source, outcome="selected", error=None, provenance=[])
        if shot_id in text_card_unavailable:
            return False, [], _unavailable(source)
        return True, ["d08:policy:generation-fallback-v1", f"text-card:{segment_id}"], GenerationFallbackAttempt(source=source, outcome="selected", error=None, provenance=[])

    @staticmethod
    def _build_d07_request(request: GenerationFallbackParams, storyboard: object, resolutions: list[GenerationFallbackShot]) -> VideoAssemblyParams | None:
        selected_images = [item for item in request.image_results if any(resolution.shot_id == item.shot_id and resolution.d07_binding == "d06-image" for resolution in resolutions)]
        selected_materials = [item for item in request.user_materials if any(resolution.shot_id == item.shot_id and resolution.d07_binding == "user-material" for resolution in resolutions)]
        try:
            return VideoAssemblyParams.model_validate({
                "schemaVersion": 1,
                "contractVersion": "video-assembly-v1",
                "runtimeMode": "offline-deterministic",
                "projectId": request.project_id,
                "timelineId": request.timeline_id,
                "assemblyId": request.assembly_id,
                "storyboard": storyboard.model_dump(by_alias=True),  # type: ignore[union-attr]
                "tts": request.tts.model_dump(by_alias=True) if request.tts is not None else None,
                "imageResults": [item.model_dump(by_alias=True) for item in selected_images],
                "d04Plan": request.d04_plan.model_dump(by_alias=True),
                "d03Plan": request.d03_plan.model_dump(by_alias=True),
                "userMaterials": [item.model_dump(by_alias=True, exclude_none=True) for item in selected_materials],
            })
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _first_d07_diagnostic(tts: GenerationFallbackTts, resolutions: list[GenerationFallbackShot]) -> GenerationFallbackDiagnostic:
        if tts.diagnostic is not None:
            return tts.diagnostic
        return next((item.diagnostic for item in resolutions if item.diagnostic is not None), GenerationFallbackDiagnostic(code="FALLBACK_D07_INPUT_INVALID", stage="d07-binding"))

    @staticmethod
    def _tts_digest(value: GenerationFallbackTts) -> dict[str, object]:
        return {"status": value.status, "chosenSource": value.chosen_source, "fallbackReason": value.fallback_reason, "d07Binding": value.d07_binding, "failure": value.failure.model_dump(by_alias=True) if value.failure is not None else None, "provenance": value.provenance, "diagnostic": value.diagnostic.model_dump(by_alias=True) if value.diagnostic is not None else None}

    @staticmethod
    def _shot_digest(value: GenerationFallbackShot) -> dict[str, object]:
        return {"shotId": value.shot_id, "order": value.order, "segmentId": value.segment_id, "status": value.status, "chosenSource": value.chosen_source, "fallbackReason": value.fallback_reason, "d05FallbackReason": value.d05_fallback_reason, "d07Binding": value.d07_binding, "attempts": [{"source": item.source, "outcome": item.outcome, "error": item.error.model_dump(by_alias=True) if item.error is not None else None, "provenance": item.provenance} for item in value.attempts], "provenance": value.provenance, "diagnostic": value.diagnostic.model_dump(by_alias=True) if value.diagnostic is not None else None}

    @staticmethod
    def _sha256_json(value: object) -> str:
        import hashlib
        import json

        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _unavailable(source: str) -> GenerationFallbackAttempt:
    return GenerationFallbackAttempt(source=source, outcome="unavailable", error=GenerationFallbackDiagnostic(code="FALLBACK_SOURCE_UNAVAILABLE", stage="selection"), provenance=[])


__all__ = ["GenerationFallbackService"]
