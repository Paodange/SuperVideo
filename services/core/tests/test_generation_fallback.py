from __future__ import annotations

import copy
import unittest

from pydantic import ValidationError

from supervideo_core.media.fallback import GenerationFallbackService
from supervideo_core.media.fallback_models import GenerationFallbackParams, GenerationFallbackResult
from supervideo_core.media.video_assembly import VideoAssemblyService
try:
    from .test_video_assembly import request_payload
except ImportError:  # unittest discovery imports tests as top-level modules.
    from test_video_assembly import request_payload


PROJECT_ID = "11111111-1111-4111-8111-111111111111"


def failure(component: str, shot_id: str | None = None, code: str = "GENERATION_FAILED") -> dict[str, object]:
    return {"projectId": PROJECT_ID, "component": component, "stage": component, "shotId": shot_id, "code": code, "retryable": False}


def request(**overrides: object) -> GenerationFallbackParams:
    d07 = request_payload()
    value: dict[str, object] = {
        "schemaVersion": 1,
        "contractVersion": "generation-fallback-v1",
        "policyVersion": "deterministic-generation-fallback-v1",
        "runtimeMode": "offline-deterministic",
        "projectId": d07["projectId"],
        "timelineId": d07["timelineId"],
        "assemblyId": "assembly-d08-demo",
        "storyboard": copy.deepcopy(d07["storyboard"]),
        "tts": copy.deepcopy(d07["tts"]),
        "ttsFailure": None,
        "imageResults": copy.deepcopy(d07["imageResults"]),
        "imageFailures": [],
        "animationFailures": [],
        "textCardUnavailableShotIds": [],
        "d04Plan": copy.deepcopy(d07["d04Plan"]),
        "d03Plan": copy.deepcopy(d07["d03Plan"]),
        "userMaterials": [],
    }
    value.update(overrides)
    return GenerationFallbackParams.model_validate(value)


class GenerationFallbackTests(unittest.TestCase):
    def test_success_is_cross_runtime_deterministic_and_d07_ready(self) -> None:
        params = request()
        service = GenerationFallbackService()
        first = service.resolve(params)
        second = service.resolve(GenerationFallbackParams.model_validate(params.model_dump(by_alias=True)))
        self.assertEqual(first, second)
        self.assertEqual(first.status, "ready")
        self.assertTrue(first.d07_eligible)
        self.assertEqual(first.result_digest, "7703dbe9eb3088b87a2e78f64ae7e20b6c92823b207078740cd2df7bf3f5ecd1")
        self.assertEqual(first.input_digest, "ce97428802d7e6030bef28c688b4a8a7647be6b360c0c285c49dac5f8cca307c")
        self.assertIsNotNone(first.video_assembly_request)

    def test_failed_image_is_isolated_and_falls_back_to_remotion(self) -> None:
        base = request()
        value = base.model_dump(by_alias=True)
        value["imageResults"] = value["imageResults"][1:]
        value["imageFailures"] = [failure("image", "shot-1", "OUTPUT_INVALID")]
        result = GenerationFallbackService().resolve(GenerationFallbackParams.model_validate(value))
        shot = result.shots[0]
        self.assertEqual(result.status, "partial")
        self.assertEqual(shot.chosen_source, "remotion-template")
        self.assertEqual(shot.fallback_reason, "generation-failed")
        self.assertEqual([item.outcome for item in shot.attempts], ["unavailable", "failed", "selected"])
        self.assertEqual(shot.attempts[1].error.stage, "image")
        self.assertEqual(result.shots[1].chosen_source, "ai-image")
        self.assertEqual(result.shots[2].chosen_source, "ai-image")

    def test_animation_failure_falls_through_to_text_card_without_d07_binding(self) -> None:
        base = request().model_dump(by_alias=True)
        base["imageResults"] = base["imageResults"][1:]
        base["animationFailures"] = [failure("animation", "shot-1", "TIMEOUT")]
        result = GenerationFallbackService().resolve(GenerationFallbackParams.model_validate(base))
        shot = result.shots[0]
        self.assertEqual(shot.chosen_source, "text-card")
        self.assertIsNone(shot.d07_binding)
        self.assertEqual(shot.attempts[2].outcome, "failed")
        self.assertEqual(shot.attempts[3].outcome, "selected")
        self.assertFalse(result.d07_eligible)

    def test_all_visual_candidates_are_audited_as_exhausted_without_a_loop(self) -> None:
        base = request().model_dump(by_alias=True)
        base["imageResults"] = base["imageResults"][1:]
        base["imageFailures"] = [failure("image", "shot-1", "GENERATION_FAILED")]
        base["animationFailures"] = [failure("animation", "shot-1", "OUTPUT_INVALID")]
        base["textCardUnavailableShotIds"] = ["shot-1"]
        result = GenerationFallbackService().resolve(GenerationFallbackParams.model_validate(base))
        self.assertEqual(result.shots[0].status, "unresolved")
        self.assertEqual(result.shots[0].fallback_reason, "candidates-exhausted")
        self.assertEqual(len(result.shots[0].attempts), 4)
        self.assertEqual(result.shots[0].diagnostic.code, "FALLBACK_CANDIDATES_EXHAUSTED")
        self.assertEqual(result.shots[1].chosen_source, "ai-image")

    def test_tts_failure_is_silence_audit_without_audio_artifact(self) -> None:
        base = request().model_dump(by_alias=True)
        base["tts"] = None
        base["ttsFailure"] = failure("tts", None, "PROVIDER_UNAVAILABLE")
        result = GenerationFallbackService().resolve(GenerationFallbackParams.model_validate(base))
        self.assertEqual(result.status, "blocked")
        self.assertEqual(result.tts.chosen_source, "silence-placeholder")
        self.assertIsNone(result.tts.d07_binding)
        self.assertIsNone(result.video_assembly_request)
        self.assertNotIn("generated/tts-v1/", str(result.model_dump(by_alias=True)))

    def test_source_gap_is_preserved_and_other_shots_are_still_resolved(self) -> None:
        base = request().model_dump(by_alias=True)
        storyboard = base["storyboard"]
        storyboard["script"]["body"][0] = {**storyboard["script"]["body"][0], "status": "gap", "sentenceId": None, "text": None, "source": None, "durationMs": 0, "factIds": [], "confirmation": "not-required"}
        storyboard["facts"] = [{**fact, "status": "unbound", "segmentIds": []} for fact in storyboard["facts"]]
        storyboard["selectedDurationMs"] = 2000
        storyboard["durationStatus"] = "outside-tolerance"
        storyboard["status"] = "gaps"
        storyboard["shots"][1] = {**storyboard["shots"][1], "durationMs": 0, "fallbackReason": "source-gap", "visualSourcePriority": ["remotion-template", "ai-image", "text-card"]}
        result = GenerationFallbackService().resolve(GenerationFallbackParams.model_validate(base))
        self.assertEqual(result.shots[1].fallback_reason, "source-gap")
        self.assertEqual(result.shots[1].status, "unresolved")
        self.assertEqual(result.shots[1].diagnostic.code, "FALLBACK_SOURCE_GAP")
        self.assertFalse(result.d07_eligible)

    def test_validation_rejects_cross_project_sensitive_stage_and_loop_data(self) -> None:
        base = request().model_dump(by_alias=True)
        with self.assertRaises(ValidationError):
            GenerationFallbackParams.model_validate({**base, "credentialRef": "never"})
        wrong_project = copy.deepcopy(base)
        wrong_project["tts"]["projectId"] = "22222222-2222-4222-8222-222222222222"
        with self.assertRaises(ValidationError):
            GenerationFallbackParams.model_validate(wrong_project)
        wrong_stage = copy.deepcopy(base)
        wrong_stage["imageFailures"] = [{**failure("image", "shot-1"), "stage": "tts"}]
        with self.assertRaises(ValidationError):
            GenerationFallbackParams.model_validate(wrong_stage)
        result = GenerationFallbackService().resolve(request())
        forged = result.model_dump(by_alias=True)
        forged["shots"][0]["attempts"].append({"source": "ai-image", "outcome": "selected", "error": None, "provenance": []})
        with self.assertRaises(ValidationError):
            GenerationFallbackResult.model_validate(forged)

    def test_d07_request_can_be_consumed_by_the_existing_strict_assembler(self) -> None:
        result = GenerationFallbackService().resolve(request())
        self.assertIsNotNone(result.video_assembly_request)
        VideoAssemblyService._validate_bindings(result.video_assembly_request)

    def test_result_digest_rejects_tampered_status_input_storyboard_and_d07_request(self) -> None:
        base = GenerationFallbackService().resolve(request()).model_dump(by_alias=True)
        mutations = [
            lambda value: value.update(status="partial"),
            lambda value: value.update(inputDigest="0" * 64),
            lambda value: (value["resolvedStoryboard"]["shots"][0].update(visualIntent="tampered"), value["videoAssemblyRequest"].update(storyboard=copy.deepcopy(value["resolvedStoryboard"]))),
            lambda value: value["videoAssemblyRequest"].update(assemblyId="assembly-d08-tampered"),
        ]
        for mutate in mutations:
            forged = copy.deepcopy(base)
            mutate(forged)
            with self.assertRaises(ValidationError):
                GenerationFallbackResult.model_validate(forged)

    def test_planned_user_material_missing_is_downgraded_to_no_user_material_for_d07(self) -> None:
        base = request().model_dump(by_alias=True)
        base["storyboard"]["shots"] = [
            {**shot, "visualSourcePriority": ["user-material", "licensed-stock", "ai-image", "remotion-template", "text-card"], "fallbackReason": "planned"}
            for shot in base["storyboard"]["shots"]
        ]
        result = GenerationFallbackService().resolve(GenerationFallbackParams.model_validate(base))
        self.assertEqual(result.status, "ready")
        self.assertEqual(result.resolved_storyboard.shots[0].fallback_reason, "no-user-material")
        self.assertEqual(result.resolved_storyboard.shots[0].visual_source_priority, ["licensed-stock", "ai-image", "remotion-template", "text-card"])
        self.assertEqual(result.video_assembly_request.storyboard.shots[0].fallback_reason, "no-user-material")
        VideoAssemblyService._validate_bindings(result.video_assembly_request)


if __name__ == "__main__":
    unittest.main()
