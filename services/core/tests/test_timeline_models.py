import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from supervideo_core.timeline.models import TimelineProject, validate_timeline_project, validate_timeline_size


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


if __name__ == "__main__":
    unittest.main()
