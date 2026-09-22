"""C09 deterministic natural-language edit coverage."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from supervideo_core.media.edit_models import TimelineEditParams
from supervideo_core.media.edit_service import TimelineEditService
from supervideo_core.rpc.models import validate_request

PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000"
FIXTURE = Path(__file__).parents[3] / "tests" / "fixtures" / "c01_timeline_ir_v1.json"


def timeline() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def structured(operation: str, clip_id: str, **extra: object) -> TimelineEditParams:
    data = timeline()
    return TimelineEditParams(
        schemaVersion=1,
        editVersion="timeline-edit-v1",
        policy="deterministic-natural-language-v1",
        projectId=PROJECT_ID,
        timeline=data,
        intent={
            "schemaVersion": 1,
            "editVersion": "edit-intent-v1",
            "policy": "deterministic-natural-language-v1",
            "operation": operation,
            "targetClipId": clip_id,
            **extra,
        },
    )


def test_all_eight_operations_are_bounded_and_preserve_references() -> None:
    service = TimelineEditService()
    cases = [
        structured("delete", "clip-camera-a"),
        structured("replace", "clip-camera-a", replacementClipId="clip-title-card"),
        structured("move-forward", "clip-title-card"),
        structured("move-backward", "clip-title-card"),
        structured("shorten", "clip-title-card", amountMs=500),
        structured("extend", "clip-title-card", amountMs=500),
        structured("subtitle", "clip-subtitle-0001", text="新的字幕"),
        structured("cta", "clip-title-card", text="请私信我领取岗位表"),
    ]
    for item in cases:
        result = service.edit(item)
        if result.status == "rejected":
            assert result.rejection is not None
            assert result.rejection.code in {"EDIT_OPERATION_UNSAFE", "EDIT_COMPLETE_SENTENCE_REQUIRED"}
            continue
        assert result.result_timeline.id != item.timeline.id
        assert {source.id for source in result.result_timeline.sources} == {source.id for source in item.timeline.sources}
        assert {provenance.id for provenance in result.result_timeline.provenance} == {provenance.id for provenance in item.timeline.provenance}


def test_chinese_templates_are_local_and_deterministic() -> None:
    data = timeline()
    params = TimelineEditParams(
        schemaVersion=1,
        editVersion="timeline-edit-v1",
        policy="deterministic-natural-language-v1",
        projectId=PROJECT_ID,
        timeline=data,
        instruction="删除 clip-camera-a",
    )
    service = TimelineEditService()
    first = service.edit(params)
    second = service.edit(params)
    assert first.status == second.status == "applied"
    assert first.determinism_digest == second.determinism_digest
    assert first.result_timeline.model_dump(by_alias=True) == second.result_timeline.model_dump(by_alias=True)


def test_complete_sentence_and_missing_target_are_structured_rejections() -> None:
    service = TimelineEditService()
    sentence_result = service.edit(structured("shorten", "clip-camera-a", amountMs=500))
    assert sentence_result.status == "rejected"
    assert sentence_result.rejection.code == "EDIT_COMPLETE_SENTENCE_REQUIRED"  # type: ignore[union-attr]
    missing = service.edit(structured("delete", "clip-does-not-exist"))
    assert missing.status == "rejected"
    assert missing.rejection.code == "EDIT_TARGET_NOT_FOUND"  # type: ignore[union-attr]


def test_schema_unknown_fields_and_rpc_method_are_rejected_or_accepted_strictly() -> None:
    with unittest.TestCase().assertRaises(ValidationError):
        TimelineEditParams(
            schemaVersion=1,
            editVersion="timeline-edit-v1",
            policy="deterministic-natural-language-v1",
            projectId=PROJECT_ID,
            timeline=timeline(),
            intent={
                "schemaVersion": 1,
                "editVersion": "edit-intent-v1",
                "policy": "deterministic-natural-language-v1",
                "operation": "delete",
                "targetClipId": "clip-camera-a",
                "unexpected": "nope",
            },
        )
    message = {
        "jsonrpc": "2.0",
        "id": "c09",
        "method": "timeline.edit",
        "params": {
            "schemaVersion": 1,
            "editVersion": "timeline-edit-v1",
            "policy": "deterministic-natural-language-v1",
            "projectId": PROJECT_ID,
            "timeline": timeline(),
            "instruction": "删除 clip-camera-a",
        },
    }
    assert validate_request(message).method == "timeline.edit"


class TimelineEditTests(unittest.TestCase):
    def test_all_eight_operations_are_bounded_and_preserve_references(self) -> None:
        test_all_eight_operations_are_bounded_and_preserve_references()

    def test_chinese_templates_are_local_and_deterministic(self) -> None:
        test_chinese_templates_are_local_and_deterministic()

    def test_complete_sentence_and_missing_target_are_structured_rejections(self) -> None:
        test_complete_sentence_and_missing_target_are_structured_rejections()

    def test_schema_unknown_fields_and_rpc_method_are_rejected_or_accepted_strictly(self) -> None:
        test_schema_unknown_fields_and_rpc_method_are_rejected_or_accepted_strictly()
