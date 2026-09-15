from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from supervideo_core.project import (
    AssetListRequest,
    AssetReferenceRequest,
    ProjectCreateRequest,
    ProjectError,
    ProjectOpenRequest,
    ProjectService,
)
from supervideo_core.project.paths import sampled_fingerprint


class ProjectServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_root = Path(tempfile.mkdtemp(prefix="supervideo project test "))
        self.project_root = self.temp_root / "项目 with spaces"
        self.project_root.mkdir()
        self.service = ProjectService()

    def tearDown(self) -> None:
        self.service.close()
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def test_create_reference_and_reopen_preserves_external_asset(self) -> None:
        summary = self.service.create(
            ProjectCreateRequest(name="招聘口播项目", targetPlatform="douyin", projectRoot=str(self.project_root))
        )
        self.assertTrue((self.project_root / "project.supervideo.json").is_file())
        self.assertTrue((self.project_root / "data" / "project.db").is_file())
        self.assertTrue((self.project_root / "exports" / "videos").is_dir())
        self.assertFalse((self.project_root / "materials").exists())

        original = self.temp_root / "外部口播 ' sample.mp4"
        original.write_bytes(b"fixed mp4 fixture\x00\x01")
        before = original.read_bytes()
        first = self.service.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(original)]))
        self.assertEqual(first.items[0].reference_status, "added")
        duplicate = self.service.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(original)]))
        self.assertEqual(duplicate.items[0].reference_status, "existing")
        self.assertEqual(duplicate.items[0].asset_id, first.items[0].asset_id)
        self.assertEqual(original.read_bytes(), before)
        self.assertEqual(summary.asset_count, 0)

        self.service.close()
        reopened = ProjectService()
        self.service = reopened
        restored = reopened.open(ProjectOpenRequest(projectRoot=str(self.project_root)))
        self.assertEqual(restored.project_id, summary.project_id)
        self.assertEqual(restored.asset_count, 1)
        listed = reopened.list_assets(AssetListRequest(projectId=summary.project_id, limit=10))
        self.assertEqual([item.asset_id for item in listed.items], [first.items[0].asset_id])
        self.assertEqual(listed.items[0].absolute_path, os.path.normcase(str(original.resolve())))

    def test_changed_asset_and_failed_batch_leave_database_unchanged(self) -> None:
        summary = self.service.create(
            ProjectCreateRequest(name="batch", targetPlatform="douyin", projectRoot=str(self.project_root))
        )
        good = self.temp_root / "good.mp4"
        good.write_bytes(b"good")
        self.service.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(good)]))
        good.write_bytes(b"changed")
        with self.assertRaises(ProjectError) as changed:
            self.service.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(good)]))
        self.assertEqual(changed.exception.code, "ASSET_CHANGED")

        new_file = self.temp_root / "new.mp4"
        new_file.write_bytes(b"new")
        bad_file = self.temp_root / "bad.txt"
        bad_file.write_text("not video", encoding="utf-8")
        with self.assertRaises(ProjectError) as unsupported:
            self.service.reference_assets(
                AssetReferenceRequest(projectId=summary.project_id, paths=[str(new_file), str(bad_file)])
            )
        self.assertEqual(unsupported.exception.code, "UNSUPPORTED_ASSET_TYPE")
        self.assertEqual(self.service.list_assets(AssetListRequest(projectId=summary.project_id)).items.__len__(), 1)

    def test_move_updates_root_without_changing_project_id_or_external_path(self) -> None:
        summary = self.service.create(
            ProjectCreateRequest(name="move", targetPlatform="douyin", projectRoot=str(self.project_root))
        )
        external = self.temp_root / "external.mp4"
        external.write_bytes(b"external")
        self.service.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(external)]))
        self.service.close()
        moved_root = self.temp_root / "移动后的项目"
        self.project_root.rename(moved_root)
        reopened = ProjectService()
        self.service = reopened
        moved = reopened.open(ProjectOpenRequest(projectRoot=str(moved_root)))
        self.assertEqual(moved.project_id, summary.project_id)
        self.assertEqual(moved.project_root, os.path.normcase(str(moved_root.resolve())))
        listed = reopened.list_assets(AssetListRequest(projectId=summary.project_id))
        self.assertEqual(listed.items[0].absolute_path, os.path.normcase(str(external.resolve())))

    def test_invalid_manifest_and_non_empty_create_are_safe(self) -> None:
        existing = self.project_root / "keep.txt"
        existing.write_text("keep", encoding="utf-8")
        with self.assertRaises(ProjectError) as not_empty:
            self.service.create(ProjectCreateRequest(name="new", targetPlatform="douyin", projectRoot=str(self.project_root)))
        self.assertEqual(not_empty.exception.code, "PROJECT_DIRECTORY_NOT_EMPTY")
        self.assertEqual(existing.read_text(encoding="utf-8"), "keep")

        existing.unlink()
        summary = self.service.create(ProjectCreateRequest(name="manifest", targetPlatform="douyin", projectRoot=str(self.project_root)))
        manifest_path = self.project_root / "project.supervideo.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["unexpected"] = True
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        self.service.close()
        with self.assertRaises(ProjectError) as invalid:
            ProjectService().open(ProjectOpenRequest(projectRoot=str(self.project_root)))
        self.assertEqual(invalid.exception.code, "PROJECT_MANIFEST_INVALID")
        self.assertTrue(summary.project_id)

    def test_sampled_fingerprint_is_stable_and_detects_head_and_tail_changes(self) -> None:
        path = self.temp_root / "fingerprint.mp4"
        path.write_bytes(b"a" * (128 * 1024) + b"b" * (128 * 1024))
        first_stat = path.stat()
        first = sampled_fingerprint(path, first_stat)
        self.assertEqual(first, sampled_fingerprint(path, path.stat()))
        path.write_bytes(b"c" + path.read_bytes()[1:])
        self.assertNotEqual(first, sampled_fingerprint(path, path.stat()))
        path.write_bytes(path.read_bytes()[:-1] + b"d")
        self.assertNotEqual(first, sampled_fingerprint(path, path.stat()))


if __name__ == "__main__":
    unittest.main()
