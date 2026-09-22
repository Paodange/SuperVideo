"""Create/open project orchestration and read-only external asset references."""

from __future__ import annotations

import asyncio
import os
import stat
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from supervideo_core.storage import (
    AssetCreate,
    AssetRepository,
    DATABASE_SCHEMA_VERSION,
    Database,
    MigrationReport,
    ProjectCreate,
    ProjectRecord,
    ProjectRepository,
    StorageError,
    new_id,
    utc_now_ms,
)
from supervideo_core.media import ArollCutJoinService, DurationOptimizerService, InformationSlotAlignmentService, MediaService, PreviewQualityCheckService, SentenceIndexService, SentenceQaService, SentenceQualityRerankService, SentenceRetrievalService, SentenceService, SubtitlePlanService, TranscriptionService, VadService
from supervideo_core.media.models import MediaProbeParams, MediaProbeResult, MediaProxyParams, MediaProxyResult
from supervideo_core.media.transcription_models import TranscriptionParams, TranscriptionResult
from supervideo_core.media.vad_models import VadParams, VadResult
from supervideo_core.media.sentence_models import SentenceParams, SentenceResult
from supervideo_core.media.qa_models import SentenceQaContextResult, SentenceQaParams, SentenceQaSaveParams, SentenceQaSaveResult
from supervideo_core.media.index_models import SentenceIndexParams, SentenceIndexResult
from supervideo_core.media.retrieval_models import RetrievalParams, RetrievalResult
from supervideo_core.media.rerank_models import RerankParams, RerankResult
from supervideo_core.media.slot_alignment_models import SlotAlignmentParams, SlotAlignmentResult
from supervideo_core.media.narrative_planner import NarrativePlannerService
from supervideo_core.media.narrative_planner_models import NarrativePlanParams, NarrativePlanResult
from supervideo_core.media.duration_optimizer_models import DurationOptimizationParams, DurationOptimizationResult
from supervideo_core.media.aroll_cut_join_models import ArollCutJoinParams, ArollCutJoinResult
from supervideo_core.media.subtitle_plan_models import SubtitlePlanParams, SubtitlePlanResult
from supervideo_core.media.preview_render_models import PreviewRenderParams, PreviewRenderResult
from supervideo_core.media.preview_render import PreviewRenderService
from supervideo_core.media.quality_check_models import PreviewQualityCheckParams, PreviewQualityCheckResult
from supervideo_core.media.final_export_models import FinalMp4ExportParams, FinalMp4ExportResult
from supervideo_core.media.final_export import FinalMp4ExportService
from supervideo_core.media.edit_models import TimelineEditParams, TimelineEditResult
from supervideo_core.media.edit_service import TimelineEditService

from .errors import ProjectError, from_storage_error
from .manifest import (
    PROJECT_MANIFEST_SCHEMA_VERSION,
    ProjectManifest,
    atomic_write_manifest,
    read_manifest,
)
from .models import (
    AssetListRequest,
    AssetListResult,
    AssetReferenceBatchResult,
    AssetReferenceRequest,
    AssetScanRequest,
    AssetScanResult,
    AssetSummary,
    ProjectCreateRequest,
    ProjectOpenRequest,
    ProjectSummary,
)
from .paths import (
    FINGERPRINT_ALGORITHM,
    asset_kind_for,
    canonical_asset_path,
    database_path_for,
    ensure_project_directories,
    normalize_project_root,
    canonical_asset_directory,
    sampled_fingerprint,
    stat_signature,
    SUPPORTED_ASSET_EXTENSIONS,
)


@dataclass
class _ActiveSession:
    root: Path
    manifest: ProjectManifest
    project: ProjectRecord
    database: Database


@dataclass(frozen=True)
class _ScannedAsset:
    path: Path
    kind: str
    size_bytes: int
    modified_at_ms: int
    fingerprint: str


class ProjectService:
    def __init__(self, media_service: MediaService | None = None, transcription_service: TranscriptionService | None = None, vad_service: VadService | None = None, sentence_service: SentenceService | None = None, sentence_qa_service: SentenceQaService | None = None, sentence_index_service: SentenceIndexService | None = None, sentence_retrieval_service: SentenceRetrievalService | None = None, sentence_rerank_service: SentenceQualityRerankService | None = None, slot_alignment_service: InformationSlotAlignmentService | None = None, narrative_planner_service: NarrativePlannerService | None = None, duration_optimizer_service: DurationOptimizerService | None = None, aroll_cut_join_service: ArollCutJoinService | None = None, subtitle_plan_service: SubtitlePlanService | None = None, preview_render_service: PreviewRenderService | None = None, preview_quality_check_service: PreviewQualityCheckService | None = None, final_export_service: FinalMp4ExportService | None = None, edit_service: TimelineEditService | None = None) -> None:
        self._active: _ActiveSession | None = None
        self.media_service = media_service or MediaService()
        self.transcription_service = transcription_service or TranscriptionService()
        self.vad_service = vad_service or VadService()
        self.sentence_service = sentence_service or SentenceService(transcription_service=self.transcription_service, vad_service=self.vad_service)
        self.sentence_qa_service = sentence_qa_service or SentenceQaService()
        self.sentence_index_service = sentence_index_service or SentenceIndexService()
        self.sentence_retrieval_service = sentence_retrieval_service or SentenceRetrievalService()
        self.sentence_rerank_service = sentence_rerank_service or SentenceQualityRerankService(self.sentence_retrieval_service, self.sentence_qa_service)
        self.slot_alignment_service = slot_alignment_service or InformationSlotAlignmentService(self.sentence_retrieval_service, self.sentence_rerank_service)
        self.narrative_planner_service = narrative_planner_service or NarrativePlannerService(self.slot_alignment_service)
        self.duration_optimizer_service = duration_optimizer_service or DurationOptimizerService()
        self.aroll_cut_join_service = aroll_cut_join_service or ArollCutJoinService()
        self.subtitle_plan_service = subtitle_plan_service or SubtitlePlanService()
        self.preview_render_service = preview_render_service or PreviewRenderService()
        self.preview_quality_check_service = preview_quality_check_service or PreviewQualityCheckService()
        self.final_export_service = final_export_service or FinalMp4ExportService()
        self.edit_service = edit_service or TimelineEditService()

    @property
    def active_project_id(self) -> str | None:
        return self._active.project.id if self._active is not None else None

    @property
    def active_database(self) -> Database | None:
        """The current trusted database for the Core-owned job manager."""

        return self._active.database if self._active is not None else None

    def close(self) -> None:
        active = self._active
        self._active = None
        if active is not None:
            active.database.close()

    async def probe_media(self, request: MediaProbeParams, cancelled: asyncio.Event) -> MediaProbeResult:
        active = self._require_active(request.project_id)
        self.media_service.bind_session(active.root, active.database)
        return await self.media_service.probe(request, cancelled)

    async def proxy_media(self, request: MediaProxyParams, cancelled: asyncio.Event) -> MediaProxyResult:
        active = self._require_active(request.project_id)
        self.media_service.bind_session(active.root, active.database)
        return await self.media_service.proxy(request, cancelled)

    async def transcribe_media(self, request: TranscriptionParams, cancelled: asyncio.Event) -> TranscriptionResult:
        active = self._require_active(request.project_id)
        self.transcription_service.bind_session(active.root, active.database)
        return await self.transcription_service.transcribe(request, cancelled)

    async def detect_voice_activity(self, request: VadParams, cancelled: asyncio.Event) -> VadResult:
        active = self._require_active(request.project_id)
        self.vad_service.bind_session(active.root, active.database)
        return await self.vad_service.detect(request, cancelled)

    async def split_sentences(self, request: SentenceParams, cancelled: asyncio.Event) -> SentenceResult:
        active = self._require_active(request.project_id)
        self.transcription_service.bind_session(active.root, active.database)
        self.vad_service.bind_session(active.root, active.database)
        self.sentence_service.bind_session(active.root, active.database)
        return await self.sentence_service.split(request, cancelled)

    def inspect_sentence_qa(self, request: SentenceQaParams) -> SentenceQaContextResult:
        active = self._require_active(request.project_id)
        self.sentence_qa_service.bind_session(active.root, active.database)
        return self.sentence_qa_service.inspect(request)

    def save_sentence_qa(self, request: SentenceQaSaveParams) -> SentenceQaSaveResult:
        active = self._require_active(request.project_id)
        self.sentence_qa_service.bind_session(active.root, active.database)
        return self.sentence_qa_service.save(request)

    async def index_sentences(self, request: SentenceIndexParams, cancelled: asyncio.Event) -> SentenceIndexResult:
        active = self._require_active(request.project_id)
        self.sentence_index_service.bind_session(active.root, active.database)
        return await self.sentence_index_service.build(request, cancelled)

    async def retrieve_sentences(self, request: RetrievalParams, cancelled: asyncio.Event) -> RetrievalResult:
        active = self._require_active(request.project_id)
        self.sentence_retrieval_service.bind_session(active.root, active.database)
        return await self.sentence_retrieval_service.search(request, cancelled)

    async def rerank_sentences(self, request: RerankParams, cancelled: asyncio.Event) -> RerankResult:
        active = self._require_active(request.project_id)
        self.sentence_rerank_service.bind_session(active.root, active.database)
        return await self.sentence_rerank_service.rerank(request, cancelled)

    async def align_information_slots(self, request: SlotAlignmentParams, cancelled: asyncio.Event) -> SlotAlignmentResult:
        active = self._require_active(request.project_id)
        self.slot_alignment_service.bind_session(active.root, active.database)
        return await self.slot_alignment_service.align(request, cancelled)

    async def create_remix_plan(self, request: NarrativePlanParams, cancelled: asyncio.Event) -> NarrativePlanResult:
        active = self._require_active(request.project_id)
        self.narrative_planner_service.bind_session(active.root, active.database)
        return await self.narrative_planner_service.create_remix(request, cancelled)

    async def optimize_duration(self, request: DurationOptimizationParams, cancelled: asyncio.Event) -> DurationOptimizationResult:
        active = self._require_active(request.project_id)
        del active
        return await self.duration_optimizer_service.optimize(request, cancelled)

    async def cut_join_aroll(self, request: ArollCutJoinParams, cancelled: asyncio.Event) -> ArollCutJoinResult:
        active = self._require_active(request.project_id)
        self.aroll_cut_join_service.bind_session(active.root, active.database)
        return await self.aroll_cut_join_service.cut_join(request, cancelled)

    async def plan_subtitles(self, request: SubtitlePlanParams, cancelled: asyncio.Event) -> SubtitlePlanResult:
        self._require_active(request.project_id)
        return await self.subtitle_plan_service.plan(request, cancelled)

    async def render_preview(self, request: PreviewRenderParams, cancelled: asyncio.Event, emit=None) -> PreviewRenderResult:
        active = self._require_active(request.project_id)
        self.preview_render_service.bind_session(active.root, active.database)
        return await self.preview_render_service.render(request, cancelled, emit)

    async def check_preview_quality(self, request: PreviewQualityCheckParams, cancelled: asyncio.Event) -> PreviewQualityCheckResult:
        active = self._require_active(request.project_id)
        self.preview_quality_check_service.bind_session(active.root, active.database)
        return await self.preview_quality_check_service.check(request, cancelled)

    async def export_final_mp4(self, request: FinalMp4ExportParams, cancelled: asyncio.Event) -> FinalMp4ExportResult:
        active = self._require_active(request.project_id)
        self.final_export_service.bind_session(active.root, active.database)
        return await self.final_export_service.export(request, cancelled)

    async def edit_timeline(self, request: TimelineEditParams, cancelled: asyncio.Event) -> TimelineEditResult:
        self._require_active(request.project_id)
        del cancelled
        return self.edit_service.edit(request)

    def create(self, request: ProjectCreateRequest) -> ProjectSummary:
        try:
            name = request.name
            if not name.strip() or any(ord(character) < 32 or ord(character) == 127 for character in name):
                raise ProjectError("INVALID_PROJECT_NAME")
            root = normalize_project_root(request.project_root)
        except ValidationError as error:
            raise ProjectError("INVALID_PROJECT_NAME", cause=error) from error
        if (root / "project.supervideo.json").exists():
            raise ProjectError("PROJECT_ALREADY_EXISTS")
        try:
            if next(root.iterdir(), None) is not None:
                raise ProjectError("PROJECT_DIRECTORY_NOT_EMPTY")
        except ProjectError:
            raise
        except OSError as error:
            raise ProjectError("FILE_ACCESS_DENIED", cause=error) from error

        created_directories: list[Path] = []
        database: Database | None = None
        database_path = database_path_for(root)
        database_existed = database_path.exists()
        try:
            created_directories = ensure_project_directories(root)
            database = Database.open(database_path)
            migration_report = database.migrate()
            project = ProjectRecord(
                id=new_id(),
                name=name,
                project_root=str(root),
                target_platform=request.target_platform,
                created_at_ms=utc_now_ms(),
                updated_at_ms=utc_now_ms(),
            )
            ProjectRepository(database).create(project)
            self._quick_validate(database)
            manifest = ProjectManifest(
                schemaVersion=PROJECT_MANIFEST_SCHEMA_VERSION,
                projectId=project.id,
                name=project.name,
                targetPlatform=project.target_platform,
                database="data/project.db",
                createdAtMs=project.created_at_ms,
                updatedAtMs=project.updated_at_ms,
            )
            atomic_write_manifest(root, manifest, must_not_exist=True)
            self.close()
            self._active = _ActiveSession(root=root, manifest=manifest, project=project, database=database)
            self.media_service.bind_session(root, database)
            database = None
            return self._summary(self._active, migration_report.current_version)
        except ProjectError:
            raise
        except StorageError as error:
            raise from_storage_error(error) from error
        except (OSError, ValidationError, ValueError) as error:
            raise ProjectError("INVALID_PROJECT_ROOT", cause=error) from error
        finally:
            if database is not None:
                database.close()
                if not database_existed:
                    for candidate in (database_path, Path(f"{database_path}-wal"), Path(f"{database_path}-shm")):
                        try:
                            candidate.unlink(missing_ok=True)
                        except OSError:
                            pass
                self._remove_created_directories(root, created_directories)

    def open(self, request: ProjectOpenRequest) -> ProjectSummary:
        root = normalize_project_root(request.project_root)
        manifest = read_manifest(root)
        database_path = database_path_for(root)
        try:
            database_stat = os.lstat(database_path)
            database_real = Path(os.path.realpath(database_path))
            if (
                not stat.S_ISREG(database_stat.st_mode)
                or database_path.is_symlink()
                or os.path.commonpath([str(root), str(database_real)]) != str(root)
            ):
                raise ProjectError("PROJECT_DATABASE_MISSING")
        except (OSError, ValueError) as error:
            raise ProjectError("PROJECT_DATABASE_MISSING", cause=error) from error

        database: Database | None = None
        try:
            database = Database.open(database_path)
            migration_report = database.migrate()
            self._quick_validate(database)
            projects = ProjectRepository(database)
            try:
                project = projects.get(manifest.project_id)
            except StorageError as error:
                if error.code == "RECORD_NOT_FOUND":
                    raise ProjectError("PROJECT_ID_MISMATCH", cause=error) from error
                raise
            if project.name != manifest.name or project.target_platform != manifest.target_platform:
                raise ProjectError("PROJECT_ID_MISMATCH")
            normalized_root = str(root)
            if project.project_root != normalized_root:
                conflict = projects.get_by_root(normalized_root)
                if conflict is not None and conflict.id != project.id:
                    raise ProjectError("PROJECT_PATH_CONFLICT")
                old_root = project.project_root
                updated_at_ms = utc_now_ms()
                try:
                    project = projects.update_location(project.id, normalized_root, updated_at_ms)
                except StorageError as error:
                    if error.code == "CONSTRAINT_VIOLATION":
                        raise ProjectError("PROJECT_PATH_CONFLICT", cause=error) from error
                    raise
                refreshed = manifest.model_copy(update={"updated_at_ms": updated_at_ms})
                try:
                    atomic_write_manifest(root, refreshed)
                except ProjectError:
                    with database.transaction() as connection:
                        connection.execute(
                            "UPDATE projects SET project_root = ?, updated_at_ms = ?, revision = MAX(revision - 1, 0) WHERE id = ?",
                            (old_root, manifest.updated_at_ms, project.id),
                        )
                    raise
                manifest = refreshed
            created_directories = ensure_project_directories(root)
            self.close()
            self._active = _ActiveSession(root=root, manifest=manifest, project=project, database=database)
            self.media_service.bind_session(root, database)
            database = None
            return self._summary(self._active, migration_report.current_version)
        except ProjectError:
            raise
        except StorageError as error:
            if error.code == "SCHEMA_TOO_NEW":
                raise ProjectError("PROJECT_SCHEMA_TOO_NEW", cause=error) from error
            raise from_storage_error(error) from error
        except sqlite3.Error as error:
            raise ProjectError("DATABASE_CORRUPT", cause=error) from error
        finally:
            if database is not None:
                database.close()

    def inspect(self, request: ProjectOpenRequest) -> ProjectSummary:
        return self.open(request)

    def list_assets(self, request: AssetListRequest) -> AssetListResult:
        active = self._require_active(request.project_id)
        try:
            assets = AssetRepository(active.database).list_for_project(active.project.id, request.limit)
        except StorageError as error:
            raise from_storage_error(error) from error
        return AssetListResult(
            projectId=active.project.id,
            items=[self._asset_summary(asset, "existing") for asset in assets],
        )

    def reference_assets(self, request: AssetReferenceRequest) -> AssetReferenceBatchResult:
        active = self._require_active(request.project_id)
        if len(request.paths) > 100:
            raise ProjectError("TOO_MANY_ASSETS")
        scanned: list[_ScannedAsset] = []
        for raw_path in request.paths:
            path, before = canonical_asset_path(raw_path)
            kind = asset_kind_for(path)
            fingerprint = sampled_fingerprint(path, before)
            try:
                after = path.stat()
            except OSError as error:
                raise ProjectError("FILE_ACCESS_DENIED", cause=error) from error
            if stat_signature(before) != stat_signature(after):
                raise ProjectError("ASSET_CHANGED_DURING_REFERENCE")
            scanned.append(
                _ScannedAsset(
                    path=path,
                    kind=kind,
                    size_bytes=int(after.st_size),
                    modified_at_ms=int(after.st_mtime_ns // 1_000_000),
                    fingerprint=fingerprint,
                )
            )
        return AssetReferenceBatchResult(
            projectId=active.project.id,
            items=self._register_scanned_assets(active, scanned),
        )

    def scan_assets(self, request: AssetScanRequest) -> AssetScanResult:
        active = self._require_active(request.project_id)
        directory, _directory_stat = canonical_asset_directory(request.directory)
        try:
            entries = sorted(directory.iterdir(), key=lambda item: str(item).casefold())
        except OSError as error:
            raise ProjectError("FILE_ACCESS_DENIED", cause=error) from error

        scanned: list[_ScannedAsset] = []
        seen_paths: set[str] = set()
        for entry in entries:
            # Directory scans are intentionally shallow and ignore unrelated
            # files. A matching extension that is not a regular file is an
            # actionable path error rather than a silent partial result.
            if entry.suffix.lower() not in SUPPORTED_ASSET_EXTENSIONS:
                continue
            path, before = canonical_asset_path(str(entry))
            kind = asset_kind_for(path)
            key = str(path)
            if key in seen_paths:
                continue
            seen_paths.add(key)
            fingerprint = sampled_fingerprint(path, before)
            try:
                after = path.stat()
            except OSError as error:
                raise ProjectError("FILE_ACCESS_DENIED", cause=error) from error
            if stat_signature(before) != stat_signature(after):
                raise ProjectError("ASSET_CHANGED_DURING_REFERENCE")
            scanned.append(
                _ScannedAsset(
                    path=path,
                    kind=kind,
                    size_bytes=int(after.st_size),
                    modified_at_ms=int(after.st_mtime_ns // 1_000_000),
                    fingerprint=fingerprint,
                )
            )
            if len(scanned) > 100:
                raise ProjectError("TOO_MANY_ASSETS")

        return AssetScanResult(
            projectId=active.project.id,
            directory=str(directory),
            items=self._register_scanned_assets(active, scanned),
        )

    def _register_scanned_assets(self, active: _ActiveSession, scanned: list[_ScannedAsset]) -> list[AssetSummary]:
        repository = AssetRepository(active.database)
        new_records: list[AssetCreate] = []
        results: list[tuple[str, str, AssetCreate | object]] = []
        known_new: dict[str, AssetCreate] = {}
        for item in scanned:
            key = str(item.path)
            if key in known_new:
                results.append((key, "existing", known_new[key]))
                continue
            try:
                existing = repository.get_by_path(active.project.id, key)
            except StorageError as error:
                raise from_storage_error(error) from error
            if existing is not None:
                if (
                    existing.size_bytes != item.size_bytes
                    or existing.modified_at_ms != item.modified_at_ms
                    or existing.content_fingerprint != item.fingerprint
                ):
                    raise ProjectError("ASSET_CHANGED")
                results.append((key, "existing", existing))
                continue
            record = AssetCreate(
                id=new_id(),
                project_id=active.project.id,
                absolute_path=key,
                kind=item.kind,
                size_bytes=item.size_bytes,
                modified_at_ms=item.modified_at_ms,
                content_fingerprint=item.fingerprint,
                source_type="external",
                created_at_ms=utc_now_ms(),
                updated_at_ms=utc_now_ms(),
            )
            known_new[key] = record
            new_records.append(record)
            results.append((key, "added", record))

        try:
            inserted = repository.create_many(new_records) if new_records else []
        except StorageError as error:
            raise from_storage_error(error) from error
        by_path = {record.absolute_path: record for record in inserted}
        output: list[AssetSummary] = []
        for key, status, record in results:
            selected = by_path.get(key, record)
            output.append(self._asset_summary(selected, status))  # type: ignore[arg-type]
        return output

    def _require_active(self, project_id: str) -> _ActiveSession:
        active = self._active
        if active is None or active.project.id != project_id:
            raise ProjectError("PROJECT_NOT_ACTIVE")
        return active

    def _summary(self, active: _ActiveSession, database_schema_version: int) -> ProjectSummary:
        try:
            count = int(active.database.connection.execute("SELECT COUNT(*) FROM assets WHERE project_id = ?", (active.project.id,)).fetchone()[0])
        except sqlite3.Error as error:
            raise ProjectError("DATABASE_CORRUPT", cause=error) from error
        return ProjectSummary(
            projectId=active.project.id,
            name=active.project.name,
            targetPlatform=active.project.target_platform,
            projectRoot=str(active.root),
            manifestSchemaVersion=active.manifest.schema_version,
            databaseSchemaVersion=database_schema_version,
            assetCount=count,
            createdAtMs=active.project.created_at_ms,
            updatedAtMs=active.project.updated_at_ms,
        )

    @staticmethod
    def _asset_summary(asset: object, status: str) -> AssetSummary:
        return AssetSummary(
            assetId=asset.id,
            projectId=asset.project_id,
            fileName=Path(asset.absolute_path).name,
            absolutePath=asset.absolute_path,
            kind=asset.kind,
            sizeBytes=asset.size_bytes,
            modifiedAtMs=asset.modified_at_ms,
            fingerprintAlgorithm=asset.content_fingerprint.split(":", 1)[0],
            referenceStatus=status,
        )

    @staticmethod
    def _quick_validate(database: Database) -> None:
        try:
            quick = [str(row[0]) for row in database.connection.execute("PRAGMA quick_check").fetchall()]
            foreign_keys = database.connection.execute("PRAGMA foreign_key_check").fetchall()
        except sqlite3.Error as error:
            raise ProjectError("DATABASE_CORRUPT", cause=error) from error
        if quick != ["ok"] or foreign_keys:
            raise ProjectError("DATABASE_CORRUPT")

    @staticmethod
    def _remove_created_directories(root: Path, created: list[Path]) -> None:
        for directory in reversed(created):
            try:
                if os.path.commonpath([str(root), str(directory)]) != str(root):
                    continue
                directory.rmdir()
            except (OSError, ValueError):
                continue
