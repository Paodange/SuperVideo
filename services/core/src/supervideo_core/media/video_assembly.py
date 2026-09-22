"""D07 deterministic generated-video assembly over the shared Timeline IR."""

from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any

from .errors import MediaError
from .video_assembly_models import (
    VIDEO_ASSEMBLY_MAX_DURATION_MS,
    VIDEO_ASSEMBLY_RUNTIME_MODE,
    VIDEO_ASSEMBLY_SCHEMA_VERSION,
    VideoAssemblyParams,
    VideoAssemblyResult,
)
from supervideo_core.timeline.models import TimelineProject, validate_timeline_project


class VideoAssemblyService:
    """Builds only a validated offline assembly plan; it never renders or calls a provider."""

    async def assemble(self, request: VideoAssemblyParams, cancelled: asyncio.Event) -> VideoAssemblyResult:
        if cancelled.is_set():
            raise MediaError("VIDEO_ASSEMBLY_INPUT_INVALID")
        try:
            self._validate_bindings(request)
            timeline = self._build_timeline(request, cancelled)
            if cancelled.is_set():
                raise MediaError("VIDEO_ASSEMBLY_INPUT_INVALID")
            digest = hashlib.sha256(_canonical_json(timeline.model_dump(by_alias=True, exclude_none=True))).hexdigest()
            image_cache_keys = [
                {"shotId": shot.shot_id, "cacheKey": image.cache_key}
                for shot in sorted(request.storyboard.shots, key=lambda item: item.order)
                for image in request.image_results
                if image.shot_id == shot.shot_id
            ]
            result = VideoAssemblyResult(
                schemaVersion=VIDEO_ASSEMBLY_SCHEMA_VERSION,
                contractVersion="video-assembly-v1",
                runtimeMode=VIDEO_ASSEMBLY_RUNTIME_MODE,
                projectId=request.project_id,
                timelineId=request.timeline_id,
                assemblyId=request.assembly_id,
                status="assembled",
                contentStatus="ready" if request.storyboard.status == "ready" else "needs-user-confirmation",
                durationMs=timeline.duration_ms,
                timelineDigest=digest,
                output={
                    "kind": "timeline-ir",
                    "relativePath": f"generated/video-assembly-v1/{digest}.json",
                    "durationMs": timeline.duration_ms,
                    "digest": digest,
                },
                preview={
                    "availability": "contract-only",
                    "compositionId": "timeline-preview-v1",
                    "playbackUri": f"supervideo://remotion/{request.project_id}/{digest}",
                    "timelineDigest": digest,
                },
                provenance={
                    "storyboardSourcePlanDigest": request.storyboard.source_plan_digest,
                    "ttsCacheKey": request.tts.cache_key,
                    "imageCacheKeys": image_cache_keys,
                    "userMaterialSourceIds": [item.source_id for item in request.user_materials],
                },
                timeline=timeline,
            )
            return result
        except MediaError:
            raise
        except (TypeError, ValueError, KeyError) as error:
            raise MediaError("VIDEO_ASSEMBLY_RESULT_INVALID", cause=error) from error

    @staticmethod
    def _validate_bindings(request: VideoAssemblyParams) -> None:
        storyboard = request.storyboard
        segments = [storyboard.script.hook, *storyboard.script.body, storyboard.script.cta]
        if storyboard.project_id != request.project_id or request.d04_plan.project_id != request.project_id or request.d04_plan.timeline_id != request.timeline_id:
            raise MediaError("VIDEO_ASSEMBLY_PROJECT_MISMATCH")
        if storyboard.status in {"gaps", "needs-duration-optimization"} or storyboard.duration_status != "within-tolerance" or any(segment.status != "matched" or segment.duration_ms <= 0 for segment in segments):
            raise MediaError("VIDEO_ASSEMBLY_STORYBOARD_INVALID")
        if not 1 <= storyboard.selected_duration_ms <= VIDEO_ASSEMBLY_MAX_DURATION_MS:
            raise MediaError("VIDEO_ASSEMBLY_STORYBOARD_INVALID")
        if request.tts.project_id != request.project_id or request.tts.duration_ms != storyboard.selected_duration_ms or len(request.tts.sentences) != len(segments):
            raise MediaError("VIDEO_ASSEMBLY_TTS_BINDING_INVALID")
        cursor = 0
        for sentence, segment in zip(request.tts.sentences, segments, strict=True):
            if sentence.sentence_id != segment.sentence_id or sentence.text != segment.text or sentence.start_ms != cursor or sentence.end_ms - sentence.start_ms != segment.duration_ms:
                raise MediaError("VIDEO_ASSEMBLY_TTS_BINDING_INVALID")
            cursor += segment.duration_ms
        shots = sorted(storyboard.shots, key=lambda item: item.order)
        if len(shots) != len(segments) or any(shot.segment_id != segment.segment_id or shot.duration_ms != segment.duration_ms for shot, segment in zip(shots, segments, strict=True)):
            raise MediaError("VIDEO_ASSEMBLY_STORYBOARD_INVALID")
        if len({item.shot_id for item in shots}) != len(shots) or len({item.shot_id for item in request.image_results}) != len(request.image_results):
            raise MediaError("VIDEO_ASSEMBLY_IMAGE_BINDING_INVALID")
        if len({item.shot_id for item in request.user_materials}) != len(request.user_materials) or len({item.source_id for item in request.user_materials}) != len(request.user_materials):
            raise MediaError("VIDEO_ASSEMBLY_MATERIAL_INVALID")
        image_shots = {item.shot_id for item in request.image_results}
        shot_ids = {item.shot_id for item in shots}
        if not image_shots <= shot_ids or any(item.project_id != request.project_id for item in request.image_results):
            raise MediaError("VIDEO_ASSEMBLY_IMAGE_BINDING_INVALID")
        material_by_shot = {item.shot_id: item for item in request.user_materials}
        for shot in shots:
            if shot.fallback_reason == "source-gap":
                raise MediaError("VIDEO_ASSEMBLY_STORYBOARD_INVALID")
            material = material_by_shot.get(shot.shot_id)
            if shot.visual_source_priority[0] == "user-material":
                if material is None:
                    raise MediaError("VIDEO_ASSEMBLY_MATERIAL_INVALID")
            elif material is not None:
                raise MediaError("VIDEO_ASSEMBLY_MATERIAL_INVALID")
            elif shot.shot_id not in image_shots:
                raise MediaError("VIDEO_ASSEMBLY_IMAGE_BINDING_INVALID")
            if material is not None and material.media_type == "video" and material.duration_ms is not None and material.duration_ms < shot.duration_ms:
                raise MediaError("VIDEO_ASSEMBLY_MATERIAL_INVALID")
        if any(source_id not in {item.source_id for item in request.user_materials} for source_id in request.d04_plan.source_ids):
            raise MediaError("VIDEO_ASSEMBLY_LAYOUT_INVALID")

    @classmethod
    def _build_timeline(cls, request: VideoAssemblyParams, cancelled: asyncio.Event) -> TimelineProject:
        storyboard = request.storyboard
        segments = [storyboard.script.hook, *storyboard.script.body, storyboard.script.cta]
        shots = sorted(storyboard.shots, key=lambda item: item.order)
        material_by_shot = {item.shot_id: item for item in request.user_materials}
        image_by_shot = {item.shot_id: item for item in request.image_results}
        sources: list[dict[str, Any]] = []
        provenance: list[dict[str, Any]] = []
        source_ids: set[str] = set()
        provenance_ids: set[str] = set()

        def add_provenance(item: dict[str, Any]) -> str:
            if item["id"] not in provenance_ids:
                provenance_ids.add(item["id"])
                provenance.append(item)
            return item["id"]

        def add_source(item: dict[str, Any]) -> str:
            if item["id"] not in source_ids:
                source_ids.add(item["id"])
                sources.append(item)
            return item["id"]

        d05_by_id = {item.id: item for item in storyboard.provenance}

        def d05_ref(origin_id: str) -> str:
            item = d05_by_id.get(origin_id)
            return add_provenance({
                "id": _reference_id("d05", origin_id),
                "kind": "user-supplied" if item and item.kind == "user-brief" else "derived",
                "metadata": {"originId": origin_id, "label": item.label if item else "D05 storyboard provenance", "verified": item.verified if item else False},
            })

        tts_input_provenance = [
            add_provenance({"id": _reference_id("tts-input", origin_id), "kind": "derived", "metadata": {"originId": origin_id}})
            for sentence in request.tts.sentences
            for origin_id in sentence.provenance_ids
        ]
        tts_generated = add_provenance({
            "id": _reference_id("tts-output", request.tts.cache_key),
            "kind": "generated",
            "sourceId": "source:tts",
            "metadata": {"cacheKey": request.tts.cache_key, "adapterVersion": request.tts.adapter_version},
        })
        tts_source = add_source({
            "id": "source:tts", "kind": "generated", "uri": f"supervideo://generated/tts-{request.tts.cache_key}",
            "mediaType": "audio", "durationMs": storyboard.selected_duration_ms, "fingerprint": request.tts.output.output_fingerprint,
            "provenanceIds": _unique([tts_generated, *tts_input_provenance]),
            "metadata": {"relativePath": request.tts.output.relative_path, "cacheKey": request.tts.cache_key},
        })
        d03_generated = add_provenance({
            "id": _reference_id("d03-plan", f"{request.d03_plan.template_version}:{request.timeline_id}"),
            "kind": "derived",
            "metadata": {"contractVersion": request.d03_plan.contract_version, "templateId": request.d03_plan.template_id, "templateVersion": request.d03_plan.template_version, "bundleVersion": request.d03_plan.bundle_version},
        })
        d04_plan_ref = _reference_id("d04-plan", f"{request.d04_plan.project_id}:{request.d04_plan.timeline_id}:{request.d04_plan.template_version}")
        d04_input = [add_provenance({"id": _reference_id("d04-input", origin_id), "kind": "derived", "metadata": {"originId": origin_id, "planReference": d04_plan_ref}}) for origin_id in request.d04_plan.provenance_ids]
        d04_generated = add_provenance({"id": _reference_id("d04-plan-output", d04_plan_ref), "kind": "derived", "metadata": {"planReference": d04_plan_ref, "templateId": request.d04_plan.template_id, "templateVersion": request.d04_plan.template_version}})
        layout_uri = f"supervideo://generated/layout-{_reference_id('layout', d04_plan_ref)[7:]}"
        layout_source = add_source({
            "id": "source:d04-layout", "kind": "generated", "uri": layout_uri, "mediaType": "other", "durationMs": storyboard.selected_duration_ms,
            "provenanceIds": _unique([d04_generated, *d04_input]),
            "metadata": {"contractVersion": request.d04_plan.contract_version, "templateId": request.d04_plan.template_id, "templateVersion": request.d04_plan.template_version},
        })

        video_clips: list[dict[str, Any]] = []
        subtitle_clips: list[dict[str, Any]] = []
        overlay_clips: list[dict[str, Any]] = []
        cursor = 0
        for index, shot in enumerate(shots):
            if cancelled.is_set():
                raise MediaError("VIDEO_ASSEMBLY_INPUT_INVALID")
            segment = segments[index]
            segment_provenance = [d05_ref(origin_id) for origin_id in segment.provenance_ids]
            fact_refs: list[str] = []
            for fact_id in segment.fact_ids:
                audit = next((item for item in storyboard.facts if item.fact_id == fact_id), None)
                fact_refs.append(add_provenance({
                    "id": _reference_id("d05-fact", fact_id), "kind": "derived",
                    "metadata": {"originId": fact_id, "status": audit.status if audit else "unbound", "provenanceIds": [d05_ref(item) for item in audit.provenance_ids] if audit else []},
                }))
            material = material_by_shot.get(shot.shot_id)
            image = image_by_shot.get(shot.shot_id)
            selected_provenance = [*segment_provenance, *fact_refs]
            if material is not None:
                material_provenance = add_provenance({"id": _reference_id("user-material", material.provenance_id), "kind": "user-supplied", "sourceId": material.source_id, "metadata": {"originId": material.provenance_id}})
                selected_provenance.append(material_provenance)
                material_source: dict[str, Any] = {
                    "id": material.source_id, "kind": "asset", "uri": material.uri, "mediaType": material.media_type,
                    "fingerprint": material.fingerprint, "provenanceIds": [material_provenance], "metadata": {"shotId": shot.shot_id},
                }
                if material.duration_ms is not None:
                    material_source["durationMs"] = material.duration_ms
                visual_source = add_source(material_source)
                visual_kind = "asset"
                visual_media_type = material.media_type
            elif image is not None:
                image_input = [add_provenance({"id": _reference_id("d06-input", f"{item.kind}:{item.id}"), "kind": "derived", "metadata": {"originKind": item.kind, "originId": item.id}}) for item in image.provenance]
                image_output = add_provenance({
                    "id": _reference_id("d06-output", image.cache_key), "kind": "generated", "sourceId": f"source:image:{shot.shot_id}",
                    "metadata": {"cacheKey": image.cache_key, "adapterVersion": image.adapter_version, "outputFingerprint": image.output.output_fingerprint},
                })
                visual_source = add_source({
                    "id": f"source:image:{shot.shot_id}", "kind": "generated", "uri": f"supervideo://generated/image-{image.cache_key}", "mediaType": "image", "durationMs": shot.duration_ms,
                    "fingerprint": image.output.output_fingerprint, "provenanceIds": _unique([image_output, *image_input]),
                    "metadata": {"shotId": shot.shot_id, "relativePath": image.output.relative_path, "cacheKey": image.cache_key},
                })
                visual_kind = "generated"
                visual_media_type = "image"
                selected_provenance.extend([image_output, *image_input])
            else:
                raise MediaError("VIDEO_ASSEMBLY_IMAGE_BINDING_INVALID")
            video_clips.append({
                "id": f"clip:video:{shot.shot_id}", "trackId": "track:video", "kind": "video" if visual_media_type == "video" else "image", "sourceId": visual_source,
                "timelineStartMs": cursor, "durationMs": shot.duration_ms,
                **({"sourceInMs": 0, "sourceOutMs": shot.duration_ms} if visual_media_type == "video" else {}),
                "transform": {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1, "anchorX": 0.5, "anchorY": 0.5},
                "sentenceId": segment.sentence_id, "editableInJianying": visual_kind == "asset", "provenanceIds": _unique(selected_provenance),
                "metadata": {"shotId": shot.shot_id, "segmentId": segment.segment_id, "visualSource": "user-material" if visual_kind == "asset" else "d06-image", "visualSourcePriority": list(shot.visual_source_priority)},
            })
            subtitle_clips.append({
                "id": f"clip:subtitle:{segment.segment_id}", "trackId": "track:subtitle", "kind": "subtitle", "timelineStartMs": cursor, "durationMs": segment.duration_ms,
                "editableInJianying": True, "subtitle": {"text": segment.text, "language": "zh-CN", "style": {"fontFamily": "Microsoft YaHei", "fontSize": 56, "color": "#FFFFFF", "backgroundColor": "#00000099", "position": "bottom", "maxLines": 2}},
                "provenanceIds": _unique([*segment_provenance, *fact_refs]), "metadata": {"segmentId": segment.segment_id, "factIds": list(segment.fact_ids), "confirmation": segment.confirmation},
            })
            overlay_clips.append({
                "id": f"clip:overlay:{shot.shot_id}", "trackId": "track:overlay", "kind": "template", "sourceId": layout_source, "timelineStartMs": cursor, "durationMs": shot.duration_ms,
                "sourceInMs": cursor, "sourceOutMs": cursor + shot.duration_ms, "editableInJianying": False, "provenanceIds": _unique([d03_generated, d04_generated, *segment_provenance]),
                "metadata": {"shotId": shot.shot_id, "d04TemplateId": request.d04_plan.template_id, "d04TemplateVersion": request.d04_plan.template_version, "d03CompositionId": request.d03_plan.composition_id},
            })
            cursor += shot.duration_ms
        audio_clip = {
            "id": "clip:audio:tts", "trackId": "track:audio", "kind": "audio", "sourceId": tts_source, "timelineStartMs": 0, "durationMs": storyboard.selected_duration_ms,
            "sourceInMs": 0, "sourceOutMs": storyboard.selected_duration_ms, "volume": 1, "editableInJianying": True, "provenanceIds": [tts_generated],
            "metadata": {"cacheKey": request.tts.cache_key, "providerId": request.tts.provider_id},
        }
        fact_status = [{"factId": item.fact_id, "status": item.status} for item in storyboard.facts]
        raw = {
            "schemaVersion": 1, "id": request.timeline_id, "canvas": {"width": 1080, "height": 1920, "fps": 30}, "durationMs": storyboard.selected_duration_ms,
            "tracks": [
                {"id": "track:video", "kind": "video", "name": "Generated visual assembly", "clips": video_clips, "metadata": {"sourcePolicy": "d05-priority-v1"}},
                {"id": "track:audio", "kind": "audio", "name": "D02 TTS", "clips": [audio_clip], "metadata": {"contractVersion": "tts-contract-v1", "cacheKey": request.tts.cache_key}},
                {"id": "track:subtitle", "kind": "subtitle", "name": "D05 subtitles", "clips": subtitle_clips, "metadata": {"sourceContract": "script-storyboard-v1"}},
                {"id": "track:overlay", "kind": "overlay", "name": "D04 layout / D03 preview seam", "clips": overlay_clips, "metadata": {"d04PlanReference": d04_plan_ref, "d03Plan": {"templateId": request.d03_plan.template_id, "templateVersion": request.d03_plan.template_version, "bundleVersion": request.d03_plan.bundle_version, "runtimeMode": request.d03_plan.runtime_mode}, "factStatus": fact_status, "forbiddenInferences": list(storyboard.forbidden_inferences)}},
            ],
            "sources": sources,
            "provenance": provenance,
        }
        try:
            return validate_timeline_project(raw)
        except (TypeError, ValueError) as error:
            raise MediaError("VIDEO_ASSEMBLY_TIMELINE_INVALID", cause=error) from error


def _reference_id(namespace: str, value: str) -> str:
    return f"{namespace}:{hashlib.sha256(value.encode('utf-8')).hexdigest()[:32]}"


def _unique(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


def _canonical_json(value: Any) -> bytes:
    return json.dumps(_normalize_numbers(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _normalize_numbers(value: Any) -> Any:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key: _normalize_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalize_numbers(item) for item in value]
    return value


__all__ = ["VideoAssemblyService"]
