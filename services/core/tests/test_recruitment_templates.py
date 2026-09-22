from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from supervideo_core.media.recruitment_template_models import (
    RecruitmentTemplateProps,
    build_recruitment_template_render_plan,
    validate_recruitment_template_render_plan,
)


ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "c01_timeline_ir_v1.json").read_text(encoding="utf-8"))
PROJECT_ID = "11111111-1111-4111-8111-111111111111"


def props(template_id: str = "recruitment-classic", template_version: str | None = None) -> dict:
    return {
        "schemaVersion": 1,
        "contractVersion": "recruitment-template-v1",
        "runtimeMode": "offline-layout",
        "projectId": PROJECT_ID,
        "templateId": template_id,
        "templateVersion": template_version or f"{template_id}-v1",
        "timeline": copy.deepcopy(FIXTURE),
        "content": {
            "title": "招工直招",
            "jobTitle": "装配线操作工",
            "salary": "6000-8500元/月",
            "location": "江苏昆山",
            "benefits": ["包吃住", "五险", "长白班"],
            "cta": "私信岗位名称，马上报名",
            "provenanceIds": ["prov-camera-a"],
        },
    }


def photo_props() -> dict:
    value = props("recruitment-photo-pan")
    value["timeline"]["sources"].append({
        "id": "source-factory-image",
        "kind": "external",
        "uri": "supervideo://external/source-factory-image",
        "mediaType": "image",
        "provenanceIds": ["prov-factory-image"],
    })
    value["timeline"]["provenance"].append({
        "id": "prov-factory-image",
        "kind": "external",
        "sourceId": "source-factory-image",
        "uri": "supervideo://external/source-factory-image",
        "license": "licensed-test",
    })
    value["media"] = {"imageSourceId": "source-factory-image", "provenanceIds": ["prov-factory-image"]}
    return value


class RecruitmentTemplateTestCase(unittest.TestCase):
    def test_all_fixed_templates_build_offline_layouts(self) -> None:
        for template_id in ("recruitment-classic", "recruitment-bold", "recruitment-split"):
            plan = build_recruitment_template_render_plan(props(template_id))
            self.assertEqual(plan.runtime_mode, "offline-layout")
            self.assertEqual(len(plan.components), 6)
            self.assertEqual(plan.safe_area, {"left": 96, "top": 192, "right": 96, "bottom": 240})
        photo = build_recruitment_template_render_plan(photo_props())
        self.assertEqual(len(photo.components), 7)
        self.assertEqual(photo.components[0].kind, "image-pan")

    def test_contract_rejects_unknown_fields_versions_and_oversized_text(self) -> None:
        invalid = props()
        invalid["extra"] = True
        with self.assertRaises(ValidationError):
            RecruitmentTemplateProps.model_validate(invalid)
        invalid = props(template_version="attacker-v1")
        with self.assertRaises(ValidationError):
            RecruitmentTemplateProps.model_validate(invalid)
        invalid = props()
        invalid["content"]["title"] = "x" * 25
        with self.assertRaises(ValidationError):
            RecruitmentTemplateProps.model_validate(invalid)
        invalid = props()
        invalid["timeline"]["durationMs"] = 60_001
        with self.assertRaises(ValidationError):
            RecruitmentTemplateProps.model_validate(invalid)

    def test_timeline_provenance_and_photo_binding_are_required(self) -> None:
        invalid = props()
        invalid["content"]["provenanceIds"] = ["missing"]
        with self.assertRaises(ValidationError):
            RecruitmentTemplateProps.model_validate(invalid)
        with self.assertRaises(ValidationError):
            RecruitmentTemplateProps.model_validate(props("recruitment-photo-pan"))
        invalid = photo_props()
        invalid["media"]["provenanceIds"] = ["prov-camera-a"]
        with self.assertRaises(ValidationError):
            RecruitmentTemplateProps.model_validate(invalid)

    def test_layout_plan_rejects_out_of_safe_area_and_overlap(self) -> None:
        plan = build_recruitment_template_render_plan(props())
        invalid = plan.model_dump(by_alias=True)
        invalid["components"][1]["box"]["x"] = 0
        with self.assertRaises(ValidationError):
            validate_recruitment_template_render_plan(invalid)
        invalid = plan.model_dump(by_alias=True)
        invalid["components"][1]["box"]["y"] = invalid["components"][0]["box"]["y"]
        with self.assertRaises(ValidationError):
            validate_recruitment_template_render_plan(invalid)
        invalid = plan.model_dump(by_alias=True)
        invalid["secret"] = "never"
        with self.assertRaises(ValidationError):
            validate_recruitment_template_render_plan(invalid)


if __name__ == "__main__":
    unittest.main()
