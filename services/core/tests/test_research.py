from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from supervideo_core.research import (
    DeterministicFakeResearchTransport,
    ResearchError,
    ResearchSaveSourceParams,
    ResearchSearchParams,
    ResearchService,
)
from supervideo_core.research.url_security import canonicalize_public_url
from supervideo_core.storage import Database, ProjectRecord, ProjectRepository, ResearchRepository


PROJECT_A = "11111111-1111-4111-8111-111111111111"
PROJECT_B = "22222222-2222-4222-8222-222222222222"


def search_params(project_id: str = PROJECT_A, **overrides: object) -> ResearchSearchParams:
    value: dict[str, object] = {
        "schemaVersion": 1,
        "contractVersion": "research-v1",
        "projectId": project_id,
        "requestId": "request-1",
        "idempotencyKey": "search-key-1",
        "topic": "招聘岗位",
        "audience": "求职者",
        "query": "招聘岗位",
        "limit": 2,
        "timeoutMs": 1000,
    }
    value.update(overrides)
    return ResearchSearchParams.model_validate(value)


class ResearchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database = Database.open(str(Path(self.temp_dir.name) / "project.db"))
        self.database.migrate()
        projects = ProjectRepository(self.database)
        projects.create(ProjectRecord(id=PROJECT_A, name="A", project_root=str(Path(self.temp_dir.name) / "a")))
        projects.create(ProjectRecord(id=PROJECT_B, name="B", project_root=str(Path(self.temp_dir.name) / "b")))

    def tearDown(self) -> None:
        self.database.close()
        self.temp_dir.cleanup()

    def test_search_is_sorted_replayable_and_source_digest_is_stable(self) -> None:
        async def run() -> None:
            service = ResearchService()
            service.bind_session(self.database)
            request = search_params()
            first = await service.search(request, asyncio.Event())
            replay = await service.search(request, asyncio.Event())
            self.assertEqual([item.rank for item in first.results], [1, 2])
            self.assertEqual([item.match_score for item in first.results], sorted([item.match_score for item in first.results], reverse=True))
            self.assertEqual(first.results[0].source_digest, replay.results[0].source_digest)
            self.assertEqual(replay.status, "replayed")
            self.assertEqual(len(ResearchRepository(self.database).list_sources(PROJECT_A)), 0)

        asyncio.run(run())

    def test_save_source_is_idempotent_and_project_scoped(self) -> None:
        async def run() -> None:
            service = ResearchService()
            service.bind_session(self.database)
            result = await service.search(search_params(), asyncio.Event())
            source = result.results[0].model_dump(mode="json", by_alias=True)
            source.pop("rank")
            source.pop("matchScore")
            save = ResearchSaveSourceParams(
                schemaVersion=1,
                contractVersion="research-v1",
                projectId=PROJECT_A,
                requestId="save-1",
                idempotencyKey="save-key-1",
                source=source,
            )
            created = service.save_source(save)
            existing = service.save_source(save)
            duplicate = service.save_source(save.model_copy(update={"request_id": "save-2", "idempotency_key": "save-key-2"}))
            self.assertEqual(created.status, "created")
            self.assertEqual(existing.status, "existing")
            self.assertEqual(duplicate.status, "duplicate")
            self.assertEqual(created.record.source_id, existing.record.source_id)
            self.assertEqual(created.record.source_id, duplicate.record.source_id)
            self.assertEqual(len(ResearchRepository(self.database).list_sources(PROJECT_A)), 1)
            other_project = service.save_source(save.model_copy(update={"idempotency_key": "save-key-3", "request_id": "save-3", "project_id": PROJECT_B}))
            self.assertEqual(other_project.status, "created")
            self.assertNotEqual(created.record.source_id, other_project.record.source_id)
            self.assertEqual(len(ResearchRepository(self.database).list_sources(PROJECT_B)), 1)

        asyncio.run(run())

    def test_url_and_contract_boundaries_reject_secrets_paths_and_unknown_fields(self) -> None:
        for value in (
            "file:///private/source",
            "javascript:alert(1)",
            "https://user:password@example.com/a",
            "https://127.0.0.1/a",
            "https://192.168.1.10/a",
            "https://localhost/a",
            "https://example.com/a?signature=fixture-value",
            "https://example.com/a/../b",
        ):
            with self.assertRaises(ResearchError):
                canonicalize_public_url(value)
        with self.assertRaises(ValidationError):
            ResearchSearchParams.model_validate({**search_params().model_dump(by_alias=True), "unknown": True})
        with self.assertRaises(ValidationError):
            ResearchSearchParams.model_validate({**search_params().model_dump(by_alias=True), "query": "apiKey=secret"})
        with self.assertRaises(ValidationError):
            ResearchSearchParams.model_validate({**search_params().model_dump(by_alias=True), "topic": "C:\\private\\topic.txt"})

    def test_transport_timeout_and_cancel_are_stable(self) -> None:
        async def run() -> None:
            timeout_service = ResearchService(DeterministicFakeResearchTransport(mode="timeout"))
            timeout_service.bind_session(self.database)
            with self.assertRaises(ResearchError) as timeout_error:
                await timeout_service.search(search_params(idempotencyKey="timeout-key", timeoutMs=1), asyncio.Event())
            self.assertEqual(timeout_error.exception.code, "RESEARCH_TIMEOUT")

            cancel_service = ResearchService(DeterministicFakeResearchTransport(mode="cancel"))
            cancel_service.bind_session(self.database)
            with self.assertRaises(ResearchError) as cancel_error:
                await cancel_service.search(search_params(idempotencyKey="cancel-key"), asyncio.Event())
            self.assertEqual(cancel_error.exception.code, "RESEARCH_CANCELLED")

        asyncio.run(run())

    def test_tampered_digest_is_rejected(self) -> None:
        async def run() -> None:
            service = ResearchService()
            service.bind_session(self.database)
            result = await service.search(search_params(requestId="request-tamper", idempotencyKey="search-tamper"), asyncio.Event())
            source = result.results[0].model_dump(mode="json", by_alias=True)
            source.pop("rank")
            source.pop("matchScore")
            source["summary"] = "篡改后的摘要"
            save = ResearchSaveSourceParams(
                schemaVersion=1,
                contractVersion="research-v1",
                projectId=PROJECT_A,
                requestId="save-tamper",
                idempotencyKey="save-tamper",
                source=source,
            )
            with self.assertRaises(ResearchError) as error:
                service.save_source(save)
            self.assertEqual(error.exception.code, "RESEARCH_SOURCE_INVALID")

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
