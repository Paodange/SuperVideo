from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from supervideo_core.storage import (
    AssetCreate,
    AssetRepository,
    Database,
    JobCreate,
    JobRepository,
    MessageCreate,
    MessageRepository,
    Migration,
    MigrationRunner,
    ProjectCreate,
    ProjectRepository,
    StorageError,
    TimelineVersionCreate,
    TimelineVersionRepository,
    discover_migrations,
    migration_checksum,
)


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "services" / "core" / "src"


class StorageTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_root = Path(tempfile.mkdtemp(prefix="supervideo storage test "))
        self.project_root = self.temp_root / "项目 with spaces"
        self.data_root = self.project_root / "data"
        self.data_root.mkdir(parents=True)
        self.database_path = self.data_root / "project.db"
        self.database = Database.open(self.database_path)
        self.database.migrate()
        self.projects = ProjectRepository(self.database)
        self.assets = AssetRepository(self.database)
        self.jobs = JobRepository(self.database)
        self.messages = MessageRepository(self.database)
        self.timelines = TimelineVersionRepository(self.database)

    def tearDown(self) -> None:
        self.database.close()
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def make_project(self, number: int = 1):
        project_id = f"{number:08d}-1111-4111-8111-111111111111"
        return self.projects.create(
            ProjectCreate(
                id=project_id,
                name=f"项目 {number} with quote ' and 中文",
                project_root=str(self.project_root / f"root-{number}"),
                target_platform="douyin",
                config_json={"locale": "zh-CN", "label": "it's safe"},
                created_at_ms=1_700_000_000_000 + number,
                updated_at_ms=1_700_000_000_000 + number,
            )
        )

    def assert_storage_error(self, code: str, callback) -> None:
        with self.assertRaises(StorageError) as context:
            callback()
        self.assertEqual(context.exception.code, code)
        self.assertNotIn(str(self.database_path), str(context.exception))


class MigrationTests(StorageTestCase):
    def test_fresh_and_repeat_migration_and_pragmas(self) -> None:
        fresh_path = self.temp_root / "fresh"
        fresh_path.mkdir()
        first_database = Database.open(fresh_path / "project.db")
        try:
            first = first_database.migrate()
            second = first_database.migrate()
            self.assertTrue(first.changed)
            self.assertTrue(second.no_op)
        finally:
            first_database.close()

        self.assertEqual(first.current_version, 1)
        self.assertEqual(second.applied_versions, (1,))
        self.assertEqual(
            self.database.pragma_values(),
            {"foreign_keys": 1, "journal_mode": "wal", "synchronous": 1, "busy_timeout": 5_000},
        )
        tables = {
            row[0]
            for row in self.database.connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        self.assertTrue({"schema_migrations", "projects", "assets", "jobs", "messages", "timeline_versions"} <= tables)

    def test_migration_checksum_tamper_is_rejected(self) -> None:
        self.database.close()
        with sqlite3.connect(self.database_path) as connection:
            connection.execute("UPDATE schema_migrations SET checksum = ? WHERE version = 1", ("0" * 64,))
        tampered = Database.open(self.database_path)
        try:
            self.assert_storage_error("MIGRATION_CHECKSUM_MISMATCH", tampered.migrate)
        finally:
            tampered.close()
        self.database = Database.open(self.database_path)

    def test_migration_name_tamper_is_rejected(self) -> None:
        self.database.close()
        with sqlite3.connect(self.database_path) as connection:
            connection.execute("UPDATE schema_migrations SET name = ? WHERE version = 1", ("0001_changed",))
        tampered = Database.open(self.database_path)
        try:
            self.assert_storage_error("MIGRATION_CHECKSUM_MISMATCH", tampered.migrate)
        finally:
            tampered.close()
        self.database = Database.open(self.database_path)

    def test_database_schema_too_new_is_rejected(self) -> None:
        self.database.close()
        with sqlite3.connect(self.database_path) as connection:
            connection.execute(
                "INSERT INTO schema_migrations(version, name, checksum, applied_at_ms) VALUES (?, ?, ?, ?)",
                (99, "0099_future", "f" * 64, 1_700_000_000_000),
            )
        too_new = Database.open(self.database_path)
        try:
            self.assert_storage_error("SCHEMA_TOO_NEW", too_new.migrate)
        finally:
            too_new.close()
        self.database = Database.open(self.database_path)

    def test_failed_migration_rolls_back_schema_and_record(self) -> None:
        path = self.data_root / "failed.db"
        database = Database.open(path)
        try:
            bad = Migration(1, "0001_failure", "CREATE TABLE partial_table (id TEXT);\nSELECT no_such_table;")
            self.assert_storage_error("MIGRATION_FAILED", lambda: MigrationRunner(database, [bad]).migrate())
            self.assertIsNone(
                database.connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial_table'"
                ).fetchone()
            )
            self.assertIsNone(
                database.connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
                ).fetchone()
            )
            self.assertTrue(MigrationRunner(database, discover_migrations()).migrate().changed)
        finally:
            database.close()

    def test_migration_names_and_checksum_are_normalized(self) -> None:
        self.assertEqual(migration_checksum("select 1;\n"), migration_checksum("select 1;\r\n"))
        self.assertEqual([item.name for item in discover_migrations()], ["0001_initial"])
        with self.assertRaises(StorageError):
            MigrationRunner(self.database, [Migration(2, "0002_gap", "SELECT 1;")])
        with self.assertRaises(StorageError):
            MigrationRunner(
                self.database,
                [Migration(1, "0001_one", "SELECT 1;"), Migration(1, "0001_duplicate", "SELECT 2;")],
            )


class RepositoryTests(StorageTestCase):
    def test_all_repositories_round_trip_and_project_isolation(self) -> None:
        project_a = self.make_project(1)
        project_b = self.make_project(2)
        external_path = self.project_root / "素材 ' 中文.mp4"
        asset = self.assets.create(
            AssetCreate(
                project_id=project_a.id,
                absolute_path=str(external_path),
                kind="video",
                size_bytes=0,
                modified_at_ms=1_700_000_000_000,
                content_fingerprint="not-computed-by-a05",
                source_type="external",
                license_json={"description": "user reference"},
                metadata_json={"title": "it's 中文"},
                created_at_ms=1_700_000_000_000,
                updated_at_ms=1_700_000_000_000,
            )
        )
        job = self.jobs.create(
            JobCreate(
                project_id=project_a.id,
                job_type="preview",
                status="queued",
                progress=0.0,
                stage="initial",
                input_json={"text": "it's safe", "language": "中文"},
                result_json=None,
                created_at_ms=1_700_000_000_001,
                updated_at_ms=1_700_000_000_001,
            )
        )
        first_message = self.messages.append(
            MessageCreate(
                project_id=project_a.id,
                conversation_id="conversation-a",
                role="user",
                message_type="text",
                content_json={"text": "你好，it's safe"},
                created_at_ms=1_700_000_000_002,
            )
        )
        second_message = self.messages.append(
            MessageCreate(
                project_id=project_a.id,
                conversation_id="conversation-a",
                role="assistant",
                message_type="text",
                content_json=["ok", "中文"],
                created_at_ms=1_700_000_000_003,
            )
        )
        timeline = self.timelines.append(
            TimelineVersionCreate(
                project_id=project_a.id,
                timeline_json={"schemaVersion": 1, "tracks": []},
                edit_intent_json={"kind": "initial"},
                diff_summary_json={"added": 0},
                created_at_ms=1_700_000_000_004,
            )
        )
        child_timeline = self.timelines.append(
            TimelineVersionCreate(
                project_id=project_a.id,
                parent_version_id=timeline.id,
                timeline_json={"schemaVersion": 1, "tracks": [{"id": "t1"}]},
                edit_intent_json={"kind": "edit"},
                diff_summary_json={"added": 1},
                created_at_ms=1_700_000_000_005,
            )
        )

        self.assertEqual(self.projects.get(project_a.id), project_a)
        self.assertEqual(self.assets.get(asset.id, project_a.id), asset)
        self.assertEqual(self.jobs.get(job.id, project_a.id), job)
        self.assertEqual([item.sequence for item in self.messages.list_for_conversation(project_a.id, "conversation-a")], [1, 2])
        self.assertEqual(self.messages.list_for_conversation(project_b.id, "conversation-a"), [])
        self.assertEqual([item.version_number for item in self.timelines.list_for_project(project_a.id)], [1, 2])
        self.assertEqual(self.timelines.get(child_timeline.id, project_a.id).parent_version_id, timeline.id)
        self.assertEqual(self.assets.list_for_project(project_b.id), [])
        self.assertEqual(self.jobs.list_for_project(project_b.id), [])
        self.assertEqual(first_message.sequence, 1)
        self.assertEqual(second_message.sequence, 2)

    def test_constraints_and_timeline_append_only(self) -> None:
        project = self.make_project(1)
        invalid_project_id = "99999999-9999-4999-8999-999999999999"
        self.assert_storage_error(
            "CONSTRAINT_VIOLATION",
            lambda: self.assets.create(
                AssetCreate(
                    project_id=invalid_project_id,
                    absolute_path=str(self.project_root / "missing.mp4"),
                    kind="video",
                    size_bytes=1,
                    modified_at_ms=1,
                    content_fingerprint="fingerprint",
                    source_type="external",
                )
            ),
        )
        asset = AssetCreate(
            project_id=project.id,
            absolute_path=str(self.project_root / "same.mp4"),
            kind="video",
            size_bytes=1,
            modified_at_ms=1,
            content_fingerprint="fingerprint",
            source_type="external",
        )
        self.assets.create(asset)
        self.assert_storage_error("CONSTRAINT_VIOLATION", lambda: self.assets.create(asset))
        with self.assertRaises(ValidationError):
            JobCreate(project_id=project.id, job_type="bad", progress=1.1, input_json={})
        with self.assertRaises(ValidationError):
            MessageCreate(project_id=project.id, conversation_id="c", role="not-a-role", message_type="text", content_json={})

        version = self.timelines.append(
            TimelineVersionCreate(project_id=project.id, timeline_json={"schemaVersion": 1})
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.database.connection.execute(
                "UPDATE timeline_versions SET timeline_json = ? WHERE id = ?",
                (json.dumps({"schemaVersion": 999}), version.id),
            )
        self.assertEqual(self.timelines.get(version.id).timeline_json, {"schemaVersion": 1})

    def test_transaction_rolls_back_all_repository_writes(self) -> None:
        project_id = "66666666-6666-4666-8666-666666666666"
        invalid_project_id = "77777777-7777-4777-8777-777777777777"
        with self.assertRaises(StorageError):
            with self.database.transaction():
                self.projects.create(
                    ProjectCreate(
                        id=project_id,
                        name="rolled back",
                        project_root=str(self.project_root / "rollback"),
                    )
                )
                self.assets.create(
                    AssetCreate(
                        project_id=invalid_project_id,
                        absolute_path=str(self.project_root / "rollback.mp4"),
                        kind="video",
                        size_bytes=1,
                        modified_at_ms=1,
                        content_fingerprint="fingerprint",
                        source_type="external",
                    )
                )
        self.assert_storage_error("RECORD_NOT_FOUND", lambda: self.projects.get(project_id))

    def test_project_cascade_does_not_touch_external_material(self) -> None:
        project = self.make_project(1)
        sentinel = self.temp_root / "external-original.mp4"
        sentinel.write_text("fixed external fixture", encoding="utf-8")
        self.assets.create(
            AssetCreate(
                project_id=project.id,
                absolute_path=str(sentinel),
                kind="video",
                size_bytes=sentinel.stat().st_size,
                modified_at_ms=1,
                content_fingerprint="fixture",
                source_type="external",
            )
        )
        self.messages.append(
            MessageCreate(
                project_id=project.id,
                conversation_id="c",
                role="user",
                message_type="text",
                content_json={"fixed": True},
            )
        )
        timeline = self.timelines.append(
            TimelineVersionCreate(project_id=project.id, timeline_json={"schemaVersion": 1})
        )
        self.timelines.append(
            TimelineVersionCreate(
                project_id=project.id,
                parent_version_id=timeline.id,
                timeline_json={"schemaVersion": 1, "parent": timeline.id},
            )
        )
        with self.database.transaction():
            self.database.connection.execute("DELETE FROM projects WHERE id = ?", (project.id,))
        self.assertTrue(sentinel.exists())
        self.assertEqual(self.database.connection.execute("SELECT COUNT(*) FROM assets").fetchone()[0], 0)
        self.assertEqual(self.database.connection.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 0)
        self.assertEqual(self.database.connection.execute("SELECT COUNT(*) FROM timeline_versions").fetchone()[0], 0)

    def test_locked_database_is_reported_without_sqlite_details(self) -> None:
        project = self.make_project(1)
        holder = sqlite3.connect(self.database_path, timeout=0, isolation_level=None)
        try:
            holder.execute("BEGIN IMMEDIATE")
            self.assert_storage_error(
                "DATABASE_BUSY",
                lambda: self.projects.create(
                    ProjectCreate(
                        name="blocked",
                        project_root=str(self.project_root / "blocked"),
                    )
                ),
            )
            self.assertEqual(self.projects.get(project.id), project)
        finally:
            holder.rollback()
            holder.close()

    def test_invalid_and_corrupt_json_are_stable_errors(self) -> None:
        project = self.make_project(1)
        secret_project = ProjectCreate(project_root=str(self.project_root / "bad"), name="bad", config_json={"apiKey": "never"})
        self.assert_storage_error("INVALID_RECORD", lambda: self.projects.create(secret_project))
        with self.assertRaises(ValidationError):
            ProjectCreate(project_root=str(self.project_root / "bad2"), name="bad", config_json={"n": float("nan")})
        with self.assertRaises(ValidationError):
            ProjectCreate(project_root=str(self.project_root / "bad3"), name="bad", config_json={"x": "x" * (256 * 1024)})

        corrupt_id = "88888888-8888-4888-8888-888888888888"
        with self.database.transaction():
            self.database.connection.execute(
                """
                INSERT INTO projects(id, name, project_root, target_platform, config_json,
                                     created_at_ms, updated_at_ms, revision)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    corrupt_id,
                    "corrupt fixture",
                    str(self.project_root / "corrupt"),
                    "douyin",
                    "not-json",
                    1,
                    1,
                    0,
                ),
            )
        self.assert_storage_error("INVALID_RECORD", lambda: self.projects.get(corrupt_id))
        self.assertEqual(self.projects.get(project.id).name, project.name)


class ProcessPersistenceTests(unittest.TestCase):
    def test_two_independent_python_processes_preserve_storage(self) -> None:
        temp_root = Path(tempfile.mkdtemp(prefix="supervideo process storage "))
        try:
            project_root = temp_root / "项目 with spaces"
            database_path = project_root / "data" / "project.db"
            database_path.parent.mkdir(parents=True)
            environment = {**os.environ, "PYTHONPATH": str(SOURCE)}
            command = [sys.executable, "-m", "supervideo_core.storage.smoke", "--db", str(database_path)]
            first = subprocess.run(
                [*command, "--phase", "write"], cwd=ROOT, env=environment, capture_output=True, text=True, check=False
            )
            self.assertEqual(first.returncode, 0, first.stderr)
            second = subprocess.run(
                [*command, "--phase", "verify"], cwd=ROOT, env=environment, capture_output=True, text=True, check=False
            )
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertIn("schema version 1", second.stdout)
            self.assertIn("projects=1", second.stdout)
            self.assertNotIn(str(database_path), second.stdout + second.stderr)
        finally:
            shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
