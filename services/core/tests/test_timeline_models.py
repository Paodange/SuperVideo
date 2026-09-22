import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from supervideo_core.timeline.models import TIMELINE_IR_MAX_PROJECT_BYTES, TimelineProject, TimelineProvenance, validate_timeline_project, validate_timeline_size


class TimelineIrModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        fixture_path = Path(__file__).parents[3] / "tests" / "fixtures" / "c01_timeline_ir_v1.json"
        cls.fixture = json.loads(fixture_path.read_text(encoding="utf-8"))

    def test_fixture_round_trips_as_version_one(self) -> None:
        project = validate_timeline_project(self.fixture)
        self.assertIsInstance(project, TimelineProject)
        self.assertEqual(project.schema_version, 1)
        self.assertEqual(len(project.tracks), 4)
        self.assertEqual(sum(len(track.clips) for track in project.tracks), 4)
        self.assertEqual(validate_timeline_size(project), project)

    def test_source_span_must_match_clip_duration(self) -> None:
        invalid = json.loads(json.dumps(self.fixture))
        invalid["tracks"][0]["clips"][0]["sourceOutMs"] = 4_999
        with self.assertRaises(ValidationError):
            validate_timeline_project(invalid)

    def test_source_in_and_out_must_be_a_pair(self) -> None:
        invalid = json.loads(json.dumps(self.fixture))
        invalid["tracks"][0]["clips"][0].pop("sourceOutMs")
        with self.assertRaises(ValidationError):
            validate_timeline_project(invalid)

    def test_source_range_must_be_ordered_and_within_source_duration(self) -> None:
        reversed_range = json.loads(json.dumps(self.fixture))
        reversed_range["tracks"][0]["clips"][0].update({"sourceInMs": 4_000, "sourceOutMs": 3_000, "durationMs": 1_000})
        with self.assertRaises(ValidationError):
            validate_timeline_project(reversed_range)

        exceeds_source = json.loads(json.dumps(self.fixture))
        exceeds_source["durationMs"] = 70_000
        exceeds_source["tracks"][0]["clips"][0].update({"durationMs": 60_001, "sourceInMs": 0, "sourceOutMs": 60_001})
        with self.assertRaises(ValidationError):
            validate_timeline_project(exceeds_source)

    def test_references_and_boundaries_are_strict(self) -> None:
        invalid = json.loads(json.dumps(self.fixture))
        invalid["tracks"][1]["clips"][0]["trackId"] = "track-video"
        invalid["tracks"][1]["clips"][0]["sourceId"] = "not-declared"
        invalid["tracks"][1]["clips"][0]["volume"] = 5
        with self.assertRaises(ValidationError):
            validate_timeline_project(invalid)

        unknown = json.loads(json.dumps(self.fixture))
        unknown["unexpected"] = True
        with self.assertRaises(ValidationError):
            validate_timeline_project(unknown)

    def test_subtitle_and_provenance_require_declared_context(self) -> None:
        invalid_subtitle = json.loads(json.dumps(self.fixture))
        invalid_subtitle["tracks"][2]["clips"][0].pop("subtitle")
        with self.assertRaises(ValidationError):
            validate_timeline_project(invalid_subtitle)

        invalid_provenance = json.loads(json.dumps(self.fixture))
        invalid_provenance["tracks"][0]["clips"][0]["provenanceIds"] = ["not-declared"]
        with self.assertRaises(ValidationError):
            validate_timeline_project(invalid_provenance)

        invalid_non_subtitle = json.loads(json.dumps(self.fixture))
        invalid_non_subtitle["tracks"][3]["clips"][0]["subtitle"] = {"text": "not allowed"}
        with self.assertRaises(ValidationError):
            validate_timeline_project(invalid_non_subtitle)

    def test_transitions_must_fit_inside_clip_duration(self) -> None:
        invalid = json.loads(json.dumps(self.fixture))
        invalid["tracks"][0]["clips"][0]["transitionIn"] = {"kind": "fade", "durationMs": 2_500}
        invalid["tracks"][0]["clips"][0]["transitionOut"] = {"kind": "dissolve", "durationMs": 2_000}
        with self.assertRaises(ValidationError):
            validate_timeline_project(invalid)

    def test_subtitle_colors_are_hex_rgb_or_rgba(self) -> None:
        for key, value in (("color", "#FFF"), ("backgroundColor", "#GGGGGG")):
            invalid = json.loads(json.dumps(self.fixture))
            invalid["tracks"][2]["clips"][0]["subtitle"]["style"][key] = value
            with self.assertRaises(ValidationError):
                validate_timeline_project(invalid)

    def test_metadata_rejects_non_finite_float_and_keeps_bounds(self) -> None:
        invalid = json.loads(json.dumps(self.fixture))
        invalid["tracks"][0]["clips"][0]["metadata"]["nonFinite"] = float("nan")
        with self.assertRaises(ValidationError):
            validate_timeline_project(invalid)

        too_deep = json.loads(json.dumps(self.fixture))
        too_deep["tracks"][0]["clips"][0]["metadata"] = {"a": {"b": {"c": {"d": {"e": {"f": 1}}}}}}
        with self.assertRaises(ValidationError):
            validate_timeline_project(too_deep)

    def test_project_size_has_fixed_512_kib_upper_bound(self) -> None:
        base = validate_timeline_project(self.fixture)
        oversized = TimelineProject.model_construct(
            schema_version=1,
            id="oversized-project",
            canvas=base.canvas,
            duration_ms=base.duration_ms,
            tracks=base.tracks,
            sources=base.sources,
            provenance=[TimelineProvenance.model_construct(
                id="oversized-provenance",
                kind="generated",
                metadata={"padding": "x" * (TIMELINE_IR_MAX_PROJECT_BYTES + 1)},
            )],
        )
        with self.assertRaises(ValueError):
            validate_timeline_project(oversized)
        with self.assertRaises(ValueError):
            validate_timeline_size(oversized, TIMELINE_IR_MAX_PROJECT_BYTES * 2)


if __name__ == "__main__":
    unittest.main()
