from __future__ import annotations

import asyncio
import hashlib
import unittest
from copy import deepcopy

from pydantic import ValidationError

from supervideo_core.media.recruitment_template_models import build_recruitment_template_render_plan
from supervideo_core.media.video_assembly import VideoAssemblyService, _canonical_json
from supervideo_core.media.video_assembly_models import VideoAssemblyParams, VideoAssemblyResult
from supervideo_core.timeline.models import TimelineProject


PROJECT_ID = "11111111-1111-4111-8111-111111111111"
TIMELINE_ID = "timeline-d07-demo"


def storyboard_payload() -> dict[str, object]:
    digest = "a" * 64
    segments = []
    texts = ["招工机会就在眼前。", "装配线操作工在江苏昆山上班。", "私信岗位名称，确认报名信息。"]
    roles = ["hook", "body", "cta"]
    for index, (role, text) in enumerate(zip(roles, texts, strict=True), start=1):
        segments.append({
            "segmentId": f"segment-{index}", "sourceSegmentId": f"segment-{index}", "order": index, "role": role, "status": "matched",
            "sentenceId": str(index).zfill(64), "text": text,
            "source": {"sourceAssetId": "22222222-2222-4222-8222-222222222222", "sourceSentenceCacheKey": "b" * 64, "sentenceIndex": index, "timecode": {"startMs": (index - 1) * 1000, "endMs": index * 1000}, "previewUri": f"supervideo://asset/22222222-2222-4222-8222-222222222222?kind=audio&startMs={(index - 1) * 1000}&endMs={index * 1000}"},
            "durationMs": 1000, "provenanceIds": (["prov-brief"] if index == 1 else [f"c02:{digest[:16]}:segment-1", "prov-brief"] if index == 2 else [f"c02:{digest[:16]}:segment-2"]), "factIds": ["fact-job", "fact-location"] if index == 2 else [], "confirmation": "verified" if index == 2 else "not-required",
        })
    return {
        "schemaVersion": 1, "contractVersion": "script-storyboard-v1", "plannerVersion": "deterministic-offline-script-storyboard-v1", "projectId": PROJECT_ID,
        "sourcePlanDigest": digest, "durationPlanSourceDigest": None, "targetDurationMs": 3000, "toleranceLowerMs": 2400, "toleranceUpperMs": 3600, "selectedDurationMs": 3000,
        "durationStatus": "within-tolerance", "durationPolicy": "c02-complete-sentence-v1", "status": "ready",
        "brief": {"theme": "招聘", "audience": "求职者", "objective": "说明岗位事实并引导用户确认报名", "language": "zh-CN"},
        "forbiddenInferences": ["不得补充未提供的薪资、福利、资格或录用承诺"],
        "provenance": [
            {"id": "prov-brief", "kind": "user-brief", "label": "用户提供的招聘简报", "verified": True},
            *[{"id": f"c02:{digest[:16]}:segment-{index}", "kind": "c02-segment", "label": "C02 complete-sentence source", "sourceSegmentId": f"segment-{index}", "verified": True} for index in range(1, 4)],
        ],
        "facts": [
            {"factId": "fact-job", "status": "bound", "provenanceIds": ["prov-brief"], "segmentIds": ["segment-2"]},
            {"factId": "fact-location", "status": "bound", "provenanceIds": ["prov-brief"], "segmentIds": ["segment-2"]},
        ],
        "script": {"hook": segments[0], "body": [segments[1]], "cta": segments[2]},
        "shots": [{"shotId": f"shot-{index}", "order": index, "segmentId": f"segment-{index}", "durationMs": 1000, "visualSourcePriority": ["licensed-stock", "ai-image", "remotion-template", "text-card"], "fallbackReason": "no-user-material", "visualIntent": f"support the {roles[index - 1]} with an allowed visual source"} for index in range(1, 4)],
    }


def request_payload() -> dict[str, object]:
    storyboard = storyboard_payload()
    layout_timeline = {
        "schemaVersion": 1, "id": TIMELINE_ID, "canvas": {"width": 1080, "height": 1920, "fps": 30}, "durationMs": 3000,
        "tracks": [{"id": "layout-track", "kind": "overlay", "clips": [{"id": "layout-seed", "trackId": "layout-track", "kind": "text", "timelineStartMs": 0, "durationMs": 3000, "editableInJianying": False, "provenanceIds": ["prov-layout"], "metadata": {"purpose": "D04 layout plan seed"}}]}],
        "sources": [], "provenance": [{"id": "prov-layout", "kind": "user-supplied", "uri": "supervideo://asset/layout-brief", "license": "user-provided"}],
    }
    d04_plan = build_recruitment_template_render_plan({
        "schemaVersion": 1, "contractVersion": "recruitment-template-v1", "runtimeMode": "offline-layout", "projectId": PROJECT_ID,
        "templateId": "recruitment-classic", "templateVersion": "recruitment-classic-v1", "timeline": layout_timeline,
        "content": {"title": "招工直招", "jobTitle": "装配线操作工", "salary": "薪资以用户确认事实为准", "location": "江苏昆山", "benefits": ["岗位事实请确认"], "cta": "私信岗位名称，确认报名信息", "provenanceIds": ["prov-layout"]},
    }).model_dump(by_alias=True)
    tts = {
        "schemaVersion": 1, "contractVersion": 1, "adapterVersion": "fake-tts-v1", "projectId": PROJECT_ID, "cacheStatus": "created", "cacheKey": "d" * 64,
        "providerId": "fake", "model": "fake-tts-v1", "voice": "alloy", "durationMs": 3000,
        "sentences": [{"sentenceId": str(index).zfill(64), "text": text, "startMs": (index - 1) * 1000, "endMs": index * 1000, "provenanceIds": [f"d05:segment-{index}"]} for index, text in enumerate(["招工机会就在眼前。", "装配线操作工在江苏昆山上班。", "私信岗位名称，确认报名信息。"], start=1)],
        "output": {"kind": "audio", "relativePath": f"generated/tts-v1/{'d' * 64}.wav", "sizeBytes": 100, "durationMs": 3000, "outputFingerprint": "e" * 64},
        "provenance": {"kind": "generated", "providerId": "fake", "model": "fake-tts-v1", "voice": "alloy", "adapterVersion": "fake-tts-v1"},
    }
    images = []
    for index in range(1, 4):
        cache_key = chr(96 + index) * 64
        images.append({
            "schemaVersion": 1, "contractVersion": 1, "adapterVersion": "fake-image-v1", "projectId": PROJECT_ID, "cacheStatus": "created", "cacheKey": cache_key,
            "providerId": "fake", "model": "fake-image-v1", "shotId": f"shot-{index}", "prompt": f"A deterministic recruitment visual for shot-{index}.",
            "parameters": {"width": 128, "height": 128, "steps": 8, "seed": 6 + index}, "source": {"kind": "d05-shot", "id": f"d05:shot:{index}"}, "provenance": [{"kind": "script", "id": f"d05:script:shot-{index}"}],
            "output": {"kind": "image", "mimeType": "image/png", "relativePath": f"generated/images-v1/{cache_key}.png", "sizeBytes": 100, "width": 128, "height": 128, "outputFingerprint": ["f", "1", "2"][index - 1] * 64},
            "generationProvenance": {"kind": "generated", "providerId": "fake", "model": "fake-image-v1", "adapterVersion": "fake-image-v1", "source": {"kind": "d05-shot", "id": f"d05:shot:{index}"}, "provenance": [{"kind": "script", "id": f"d05:script:shot-{index}"}]},
        })
    return {
        "schemaVersion": 1, "contractVersion": "video-assembly-v1", "runtimeMode": "offline-deterministic", "projectId": PROJECT_ID, "timelineId": TIMELINE_ID, "assemblyId": "assembly-d07-demo",
        "storyboard": storyboard, "tts": tts, "imageResults": images,
        "d04Plan": d04_plan,
        "d03Plan": {"contractVersion": "remotion-runtime-v1", "renderVersion": "remotion-render-v1", "runtimeMode": "offline-contract", "templateId": "timeline-preview", "templateVersion": "timeline-preview-v1", "bundleVersion": "remotion-bundle-v1", "compositionId": "timeline-preview-v1"},
    }


class D07VideoAssemblyTestCase(unittest.TestCase):
    def test_offline_assembly_is_complete_and_deterministic(self) -> None:
        params = VideoAssemblyParams.model_validate(request_payload())

        async def scenario() -> tuple[dict[str, object], dict[str, object]]:
            service = VideoAssemblyService()
            first = await service.assemble(params, asyncio.Event())
            second = await service.assemble(params, asyncio.Event())
            return first.model_dump(by_alias=True), second.model_dump(by_alias=True)

        first, second = asyncio.run(scenario())
        self.assertEqual(first, second)
        self.assertEqual(first["status"], "assembled")
        self.assertEqual(first["durationMs"], 3000)
        self.assertEqual(first["timelineDigest"], "3aa8f13a147a50065143330b7037fef0f3349ad9b72ff2bd8fcbdbc7d08d785f")
        self.assertEqual([track["kind"] for track in first["timeline"]["tracks"]], ["video", "audio", "subtitle", "overlay"])
        self.assertEqual(first["preview"]["availability"], "contract-only")
        self.assertNotIn("C:\\", str(first))
        self.assertNotIn("credentialRef", str(first))

    def test_binding_errors_are_stable_and_no_fallback_is_applied(self) -> None:
        base = VideoAssemblyParams.model_validate(request_payload())
        wrong_tts = base.tts.model_copy(update={"project_id": "22222222-2222-4222-8222-222222222222"})
        with self.assertRaisesRegex(Exception, "D02 TTS"):
            asyncio.run(VideoAssemblyService().assemble(base.model_copy(update={"tts": wrong_tts}), asyncio.Event()))
        missing_image = base.model_copy(update={"image_results": base.image_results[:2]})
        with self.assertRaisesRegex(Exception, "D06 image"):
            asyncio.run(VideoAssemblyService().assemble(missing_image, asyncio.Event()))
        invalid_storyboard = base.storyboard.model_copy(update={"status": "gaps"})
        with self.assertRaisesRegex(Exception, "D05 storyboard"):
            asyncio.run(VideoAssemblyService().assemble(base.model_copy(update={"storyboard": invalid_storyboard}), asyncio.Event()))

    def test_contract_rejects_unknown_absolute_path_and_secret_fields(self) -> None:
        base = request_payload()
        for update in (
            {"credentialRef": "never"},
            {"d03Plan": {**base["d03Plan"], "command": "ffmpeg"}},
            {"userMaterials": [{"sourceId": "user:1", "shotId": "shot-1", "uri": "C:\\outside.mp4", "mediaType": "video", "durationMs": 1000, "fingerprint": "a" * 64, "provenanceId": "user:p"}]},
        ):
            candidate = deepcopy(base)
            candidate.update(update)
            with self.subTest(update=update):
                with self.assertRaises(ValidationError):
                    VideoAssemblyParams.model_validate(candidate)

    def test_result_rejects_tampered_timeline_metadata_after_digest_rebinding(self) -> None:
        params = VideoAssemblyParams.model_validate(request_payload())
        result = asyncio.run(VideoAssemblyService().assemble(params, asyncio.Event()))
        candidate = result.model_dump(by_alias=True)
        candidate["timeline"]["tracks"][0]["clips"][0]["metadata"]["secret"] = "never"
        timeline = TimelineProject.model_validate(candidate["timeline"])
        digest = hashlib.sha256(_canonical_json(timeline.model_dump(by_alias=True, exclude_none=True))).hexdigest()
        candidate["timelineDigest"] = digest
        candidate["output"]["digest"] = digest
        candidate["output"]["relativePath"] = f"generated/video-assembly-v1/{digest}.json"
        candidate["preview"]["timelineDigest"] = digest
        candidate["preview"]["playbackUri"] = f"supervideo://remotion/{candidate['projectId']}/{digest}"
        with self.assertRaises(ValueError):
            VideoAssemblyResult.model_validate(candidate)

    def test_result_rejects_sensitive_key_separator_variants_after_digest_rebinding(self) -> None:
        params = VideoAssemblyParams.model_validate(request_payload())
        result = asyncio.run(VideoAssemblyService().assemble(params, asyncio.Event()))
        for key in ("credential.ref", "api.key", "api key"):
            with self.subTest(key=key):
                candidate = result.model_dump(by_alias=True)
                candidate["timeline"]["tracks"][0]["clips"][0]["metadata"][key] = "never"
                timeline = TimelineProject.model_validate(candidate["timeline"])
                digest = hashlib.sha256(_canonical_json(timeline.model_dump(by_alias=True, exclude_none=True))).hexdigest()
                candidate["timelineDigest"] = digest
                candidate["output"]["digest"] = digest
                candidate["output"]["relativePath"] = f"generated/video-assembly-v1/{digest}.json"
                candidate["preview"]["timelineDigest"] = digest
                candidate["preview"]["playbackUri"] = f"supervideo://remotion/{candidate['projectId']}/{digest}"
                with self.assertRaisesRegex(ValueError, "forbidden sensitive"):
                    VideoAssemblyResult.model_validate(candidate)


if __name__ == "__main__":
    unittest.main()
