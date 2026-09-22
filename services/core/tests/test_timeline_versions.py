"""C10 immutable Timeline version and navigation coverage."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from supervideo_core.project.models import ProjectCreateRequest
from supervideo_core.project.service import ProjectService
from supervideo_core.timeline.models import TimelineProject
from supervideo_core.timeline.version_errors import TimelineVersionError
from supervideo_core.timeline.version_models import (
    TimelineVersionApplyEditParams,
    TimelineVersionCreateParams,
    TimelineVersionDiffParams,
    TimelineVersionRedoParams,
    TimelineVersionUndoParams,
)
from supervideo_core.timeline.version_service import TimelineVersionService


class TimelineVersionServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="supervideo c10 "))
        self.projects = ProjectService()
        summary = self.projects.create(ProjectCreateRequest(name="C10", targetPlatform="douyin", projectRoot=str(self.root)))
        self.project_id = summary.project_id
        fixture = Path(__file__).parents[3] / "tests" / "fixtures" / "c01_timeline_ir_v1.json"
        self.timeline = TimelineProject.model_validate(json.loads(fixture.read_text(encoding="utf-8")))
        self.versions = TimelineVersionService()

    def tearDown(self) -> None:
        self.projects.close()

    def create_root(self):
        return self.versions.create(
            TimelineVersionCreateParams(
                schemaVersion=1,
                versioningVersion="timeline-version-v1",
                projectId=self.project_id,
                timeline=self.timeline,
                idempotencyKey="root-c10",
            ),
            self.projects.active_database,
        )

    def test_edit_undo_redo_and_diff_keep_full_ir(self) -> None:
        root = self.create_root()
        edited = self.versions.apply_edit(
            TimelineVersionApplyEditParams(
                schemaVersion=1,
                versioningVersion="timeline-version-v1",
                projectId=self.project_id,
                instruction="删除 clip-camera-a",
                idempotencyKey="edit-c10",
            ),
            self.projects.active_database,
        )
        self.assertNotEqual(root.active_version_id, edited.active_version_id)
        self.assertIsNotNone(edited.edit_result)
        undone = self.versions.undo(
            TimelineVersionUndoParams(schemaVersion=1, versioningVersion="timeline-version-v1", projectId=self.project_id),
            self.projects.active_database,
        )
        self.assertEqual(undone.active_version_id, root.active_version_id)
        redone = self.versions.redo(
            TimelineVersionRedoParams(schemaVersion=1, versioningVersion="timeline-version-v1", projectId=self.project_id),
            self.projects.active_database,
        )
        self.assertEqual(redone.active_version_id, edited.active_version_id)
        diff = self.versions.diff(
            TimelineVersionDiffParams(
                schemaVersion=1,
                versioningVersion="timeline-version-v1",
                projectId=self.project_id,
                fromVersionId=root.active_version_id,
                toVersionId=edited.active_version_id,
            ),
            self.projects.active_database,
        )
        self.assertEqual(diff.summary["removedClipIds"], ["clip-camera-a"])
        self.assertEqual(diff.summary["diffVersion"], "timeline-diff-v1")

    def test_idempotency_and_concurrency_guard(self) -> None:
        first = self.create_root()
        second = self.create_root()
        self.assertEqual(first.active_version_id, second.active_version_id)
        with self.assertRaises(TimelineVersionError) as error:
            self.versions.undo(
                TimelineVersionUndoParams(
                    schemaVersion=1,
                    versioningVersion="timeline-version-v1",
                    projectId=self.project_id,
                    expectedActiveVersionId="11111111-1111-4111-8111-111111111111",
                ),
                self.projects.active_database,
            )
        self.assertEqual(error.exception.code, "TIMELINE_VERSION_CONFLICT")


if __name__ == "__main__":
    unittest.main()
