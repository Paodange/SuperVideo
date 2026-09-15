"""Controlled two-phase storage smoke used by the repository root command.

This is intentionally a fixed-fixture module, not a general SQLite or SQL
CLI.  The root Node script creates the temporary database path and is the only
caller used by the documented smoke command.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .database import Database
from .errors import StorageError
from .models import AssetCreate, JobCreate, MessageCreate, ProjectCreate, TimelineVersionCreate
from .repositories import AssetRepository, JobRepository, MessageRepository, ProjectRepository, TimelineVersionRepository


PROJECT_ID = "11111111-1111-4111-8111-111111111111"
ASSET_ID = "22222222-2222-4222-8222-222222222222"
JOB_ID = "33333333-3333-4333-8333-333333333333"
MESSAGE_ID = "44444444-4444-4444-8444-444444444444"
TIMELINE_ID = "55555555-5555-4555-8555-555555555555"
FIXED_TIME_MS = 1_700_000_000_000


def write_fixture(database_path: Path) -> dict[str, int]:
    database = Database.open(database_path)
    try:
        migration = database.migrate()
        if not migration.changed:
            raise StorageError("MIGRATION_FAILED")
        project = ProjectRepository(database).create(
            ProjectCreate(
                id=PROJECT_ID,
                name="Storage smoke project",
                project_root=str(database_path.parent.parent),
                target_platform="douyin",
                config_json={"fixture": "a05", "language": "zh-CN"},
                created_at_ms=FIXED_TIME_MS,
                updated_at_ms=FIXED_TIME_MS,
            )
        )
        AssetRepository(database).create(
            AssetCreate(
                id=ASSET_ID,
                project_id=project.id,
                absolute_path=str(database_path.parent.parent / "外部素材 quote ' A.mp4"),
                kind="video",
                size_bytes=123,
                modified_at_ms=FIXED_TIME_MS,
                content_fingerprint="fixture-fingerprint",
                source_type="external",
                license_json={"kind": "user-referenced"},
                metadata_json={"caption": "中文素材"},
                created_at_ms=FIXED_TIME_MS,
                updated_at_ms=FIXED_TIME_MS,
            )
        )
        JobRepository(database).create(
            JobCreate(
                id=JOB_ID,
                project_id=project.id,
                job_type="storage-smoke",
                input_json={"quote": "it's safe", "number": 1},
                created_at_ms=FIXED_TIME_MS,
                updated_at_ms=FIXED_TIME_MS,
            )
        )
        MessageRepository(database).append(
            MessageCreate(
                id=MESSAGE_ID,
                project_id=project.id,
                conversation_id="fixed-conversation",
                role="user",
                message_type="text",
                content_json={"text": "固定测试消息，不含用户数据"},
                created_at_ms=FIXED_TIME_MS,
            )
        )
        TimelineVersionRepository(database).append(
            TimelineVersionCreate(
                id=TIMELINE_ID,
                project_id=project.id,
                schema_version=1,
                timeline_json={"schemaVersion": 1, "tracks": []},
                edit_intent_json={"kind": "initial"},
                diff_summary_json={"added": 0},
                created_at_ms=FIXED_TIME_MS,
            )
        )
        report = database.integrity_report()
        if not report.ok:
            raise StorageError("DATABASE_CORRUPT")
        return {"schema_version": migration.current_version, "projects": 1, "assets": 1, "jobs": 1, "messages": 1, "timeline_versions": 1}
    finally:
        database.close()


def verify_fixture(database_path: Path) -> dict[str, int]:
    database = Database.open(database_path)
    try:
        migration = database.migrate()
        if not migration.no_op:
            raise StorageError("MIGRATION_FAILED")
        project = ProjectRepository(database).get(PROJECT_ID)
        assets = AssetRepository(database).list_for_project(project.id)
        jobs = JobRepository(database).list_for_project(project.id)
        messages = MessageRepository(database).list_for_conversation(project.id, "fixed-conversation")
        timelines = TimelineVersionRepository(database).list_for_project(project.id)
        if len(assets) != 1 or len(jobs) != 1 or len(messages) != 1 or len(timelines) != 1:
            raise StorageError("INVALID_RECORD")
        if messages[0].content_json != {"text": "固定测试消息，不含用户数据"}:
            raise StorageError("INVALID_RECORD")
        if timelines[0].timeline_json.get("schemaVersion") != 1:
            raise StorageError("INVALID_RECORD")
        if not database.integrity_report().ok:
            raise StorageError("DATABASE_CORRUPT")
        return {"schema_version": migration.current_version, "projects": 1, "assets": 1, "jobs": 1, "messages": 1, "timeline_versions": 1}
    finally:
        database.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the fixed A05 storage smoke phase.")
    parser.add_argument("--db", required=True, help="Temporary database path supplied by the root smoke script.")
    parser.add_argument("--phase", choices=("write", "verify"), required=True)
    args = parser.parse_args(argv)
    database_path = Path(args.db)
    if not database_path.is_absolute():
        print("[storage-smoke] failed: DATABASE_OPEN_FAILED", file=sys.stderr)
        return 1
    try:
        summary = write_fixture(database_path) if args.phase == "write" else verify_fixture(database_path)
    except StorageError as error:
        print(f"[storage-smoke] failed: {error.code}", file=sys.stderr)
        return 1
    print(
        "Storage smoke passed "
        f"(schema version {summary['schema_version']}; "
        f"projects={summary['projects']}; assets={summary['assets']}; jobs={summary['jobs']}; "
        f"messages={summary['messages']}; timeline_versions={summary['timeline_versions']})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
