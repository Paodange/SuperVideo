"""Explicit, non-dynamic RPC method registry."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, ValidationError

from supervideo_core.project import ProjectService
from supervideo_core.project.models import (
    AssetListRequest,
    AssetReferenceRequest,
    AssetScanRequest,
    ProjectCreateRequest,
    ProjectInspectRequest,
    ProjectOpenRequest,
)
from supervideo_core.jobs import JobManager, JobSmokeInput
from supervideo_core.media import MediaProbeParams, MediaProxyParams
from supervideo_core.media.transcription_models import TranscriptionParams
from supervideo_core.media.vad_models import VadParams
from supervideo_core.media.sentence_models import SentenceParams
from supervideo_core.media.qa_models import SentenceQaParams, SentenceQaSaveParams
from supervideo_core.media.index_models import SentenceIndexParams
from supervideo_core.media.retrieval_models import RetrievalParams
from supervideo_core.media.rerank_models import RerankParams
from supervideo_core.media.slot_alignment_models import SlotAlignmentParams
from supervideo_core.media.narrative_planner_models import NarrativePlanParams
from supervideo_core.media.duration_optimizer_models import DurationOptimizationParams
from supervideo_core.media.aroll_cut_join_models import ArollCutJoinParams
from supervideo_core.media.subtitle_plan_models import SubtitlePlanParams
from supervideo_core.media.preview_render_models import PreviewRenderParams
from supervideo_core.media.quality_check_models import PreviewQualityCheckParams
from supervideo_core.media.final_export_models import FinalMp4ExportParams
from supervideo_core.media.edit_models import TimelineEditParams
from supervideo_core.media.tts_models import TtsJobStartParams
from supervideo_core.media.remotion_models import RemotionRenderParams
from supervideo_core.timeline.version_models import (
    TimelineVersionActivateParams, TimelineVersionApplyEditParams, TimelineVersionCreateParams,
    TimelineVersionDiffParams, TimelineVersionListParams, TimelineVersionRedoParams,
    TimelineVersionReferenceParams, TimelineVersionUndoParams,
)

from .errors import RpcServiceError
from .models import (
    HealthParams,
    JobEventsListParams,
    JobListParams,
    JobReferenceParams,
    JobSmokeStartParams,
    SmokeCountdownParams,
    health_result,
)

ProgressEmitter = Callable[[int, float, str], Awaitable[None]]


async def health_handler(_params: HealthParams, _emit: ProgressEmitter, _cancelled: asyncio.Event) -> dict[str, object]:
    return health_result()


async def countdown_handler(
    params: SmokeCountdownParams,
    emit: ProgressEmitter,
    cancelled: asyncio.Event,
) -> dict[str, object]:
    for step in range(1, params.steps + 1):
        try:
            await asyncio.wait_for(cancelled.wait(), timeout=params.delay_ms / 1_000)
        except TimeoutError:
            pass
        if cancelled.is_set():
            raise RpcServiceError("REQUEST_CANCELLED")
        await emit(step, step / params.steps, f"step-{step}")
    return {"status": "completed", "steps": params.steps}


async def project_create_handler(
    params: ProjectCreateRequest,
    _emit: ProgressEmitter,
    _cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    result = service.create(params)
    return result.model_dump(by_alias=True)


async def project_open_handler(
    params: ProjectOpenRequest,
    _emit: ProgressEmitter,
    _cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    result = service.open(params)
    return result.model_dump(by_alias=True)


async def project_inspect_handler(
    params: ProjectInspectRequest,
    _emit: ProgressEmitter,
    _cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    result = service.inspect(params)
    return result.model_dump(by_alias=True)


async def asset_reference_handler(
    params: AssetReferenceRequest,
    _emit: ProgressEmitter,
    _cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    result = service.reference_assets(params)
    return result.model_dump(by_alias=True)


async def asset_list_handler(
    params: AssetListRequest,
    _emit: ProgressEmitter,
    _cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    result = service.list_assets(params)
    return result.model_dump(by_alias=True)


async def asset_scan_handler(
    params: AssetScanRequest,
    _emit: ProgressEmitter,
    _cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    result = service.scan_assets(params)
    return result.model_dump(by_alias=True)


async def media_probe_handler(
    params: MediaProbeParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.probe_media(params, cancelled)).model_dump(by_alias=True)


async def media_proxy_handler(
    params: MediaProxyParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.proxy_media(params, cancelled)).model_dump(by_alias=True)


async def media_transcribe_handler(
    params: TranscriptionParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.transcribe_media(params, cancelled)).model_dump(by_alias=True)


async def media_vad_handler(
    params: VadParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.detect_voice_activity(params, cancelled)).model_dump(by_alias=True)


async def media_sentences_handler(
    params: SentenceParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.split_sentences(params, cancelled)).model_dump(by_alias=True)


async def media_sentence_qa_context_handler(
    params: SentenceQaParams,
    _emit: ProgressEmitter,
    _cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return service.inspect_sentence_qa(params).model_dump(by_alias=True)


async def media_sentence_qa_save_handler(
    params: SentenceQaSaveParams,
    _emit: ProgressEmitter,
    _cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return service.save_sentence_qa(params).model_dump(by_alias=True)


async def media_sentence_index_handler(
    params: SentenceIndexParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.index_sentences(params, cancelled)).model_dump(by_alias=True)


async def media_sentence_retrieval_handler(
    params: RetrievalParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.retrieve_sentences(params, cancelled)).model_dump(by_alias=True)


async def media_sentence_rerank_handler(
    params: RerankParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.rerank_sentences(params, cancelled)).model_dump(by_alias=True)


async def media_script_align_handler(
    params: SlotAlignmentParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.align_information_slots(params, cancelled)).model_dump(by_alias=True)


async def plan_create_remix_handler(
    params: NarrativePlanParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.create_remix_plan(params, cancelled)).model_dump(by_alias=True)


async def plan_optimize_duration_handler(
    params: DurationOptimizationParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.optimize_duration(params, cancelled)).model_dump(by_alias=True)


async def media_aroll_cut_join_handler(
    params: ArollCutJoinParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.cut_join_aroll(params, cancelled)).model_dump(by_alias=True)


async def media_subtitle_plan_handler(
    params: SubtitlePlanParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.plan_subtitles(params, cancelled)).model_dump(by_alias=True)


async def media_preview_render_handler(
    params: PreviewRenderParams,
    emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.render_preview(params, cancelled, emit)).model_dump(by_alias=True)


async def media_preview_quality_check_handler(
    params: PreviewQualityCheckParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.check_preview_quality(params, cancelled)).model_dump(by_alias=True)


async def media_final_export_handler(
    params: FinalMp4ExportParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    return (await service.export_final_mp4(params, cancelled)).model_dump(by_alias=True)


async def timeline_edit_handler(
    params: TimelineEditParams,
    _emit: ProgressEmitter,
    cancelled: asyncio.Event,
    service: ProjectService,
) -> dict[str, object]:
    result = await service.edit_timeline(params, cancelled)
    # Shared/Node treats optional wire fields as omitted, not explicit nulls.
    # Keep the top-level rejection discriminator present because it is required
    # by the versioned result contract in both applied and rejected responses.
    payload = result.model_dump(by_alias=True, exclude_none=True)
    if result.rejection is None:
        payload["rejection"] = None
    return payload


async def timeline_version_handler(params, _emit: ProgressEmitter, _cancelled: asyncio.Event, service: ProjectService) -> dict[str, object]:
    handlers = {
        "TimelineVersionCreateParams": service.create_timeline_version,
        "TimelineVersionApplyEditParams": service.apply_timeline_edit,
        "TimelineVersionListParams": service.list_timeline_versions,
        "TimelineVersionReferenceParams": service.get_timeline_version,
        "TimelineVersionActivateParams": service.activate_timeline_version,
        "TimelineVersionUndoParams": service.undo_timeline_version,
        "TimelineVersionRedoParams": service.redo_timeline_version,
        "TimelineVersionDiffParams": service.diff_timeline_versions,
    }
    result = handlers[type(params).__name__](params)
    payload = result.model_dump(by_alias=True, exclude_none=True)
    if "operation" in payload:
        # Keep the result discriminators addressable even when no snapshot or
        # edit result is returned.
        payload.setdefault("version", None)
        payload.setdefault("editResult", None)
    version = payload.get("version")
    if isinstance(version, dict):
        _compact_version_snapshot_wire(version)
    items = payload.get("items")
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict):
                _compact_version_snapshot_wire(item)
    edit_result = payload.get("editResult")
    if isinstance(edit_result, dict) and isinstance(edit_result.get("resultTimeline"), dict):
        edit_result["resultTimeline"] = _compact_timeline_wire(edit_result["resultTimeline"])
    if isinstance(edit_result, dict) and isinstance(edit_result.get("intent"), dict):
        edit_result["intent"] = _compact_timeline_wire(edit_result["intent"])
    if isinstance(edit_result, dict):
        edit_result.setdefault("rejection", None)
    return payload


def _compact_version_snapshot_wire(value: dict[str, object]) -> None:
    """Compact only embedded Timeline IR and preserve version nullable fields."""

    value.setdefault("parentVersionId", None)
    timeline = value.get("timeline")
    if isinstance(timeline, dict):
        value["timeline"] = _compact_timeline_wire(timeline)


def _compact_timeline_wire(value: dict[str, object]) -> dict[str, object]:
    """Omit optional null IR fields while preserving explicit contract nulls."""

    def compact(item: object) -> object:
        if isinstance(item, dict):
            return {key: compact(child) for key, child in item.items() if child is not None}
        if isinstance(item, list):
            return [compact(child) for child in item]
        return item

    return compact(value)  # type: ignore[return-value]


async def _project_create_with_jobs(params: ProjectCreateRequest, registry: "RpcRegistry") -> dict[str, object]:
    previous = registry.job_manager.active_project_id
    await registry.job_manager.pause_for_project_change()
    try:
        result = registry.project_service.create(params)
    except Exception:
        if previous and registry.project_service.active_project_id == previous:
            await registry.job_manager.activate(previous)
        raise
    await registry.job_manager.activate(result.project_id)
    return result.model_dump(by_alias=True)


async def _project_open_with_jobs(params: ProjectOpenRequest, registry: "RpcRegistry") -> dict[str, object]:
    previous = registry.job_manager.active_project_id
    await registry.job_manager.pause_for_project_change()
    try:
        result = registry.project_service.open(params)
    except Exception:
        if previous and registry.project_service.active_project_id == previous:
            await registry.job_manager.activate(previous)
        raise
    await registry.job_manager.activate(result.project_id)
    return result.model_dump(by_alias=True)


async def job_smoke_start_handler(params: JobSmokeStartParams, manager: JobManager) -> dict[str, object]:
    result = await manager.start_smoke(
        params.project_id,
        params.idempotency_key,
        JobSmokeInput(steps=params.steps, delayMs=params.delay_ms, failAttempts=params.fail_attempts),
    )
    return result.model_dump(by_alias=True)


async def job_tts_start_handler(params: TtsJobStartParams, manager: JobManager) -> dict[str, object]:
    result = await manager.start_tts(params)
    return result.model_dump(by_alias=True)


async def job_remotion_start_handler(params: RemotionRenderParams, manager: JobManager) -> dict[str, object]:
    result = await manager.start_remotion(params)
    return result.model_dump(by_alias=True)


class RpcRegistry:
    """Registry whose method names are all explicit source-level entries."""

    def __init__(self, service: ProjectService | None = None, on_job_event: Callable[[object], None] | None = None) -> None:
        self.project_service = service or ProjectService()
        self.job_manager = JobManager(self.project_service, on_event=on_job_event)  # type: ignore[arg-type]
        self._methods: dict[str, tuple[type[BaseModel], Callable[..., Awaitable[dict[str, object]]]]] = {
            "core.health": (HealthParams, health_handler),
            "core.smoke.countdown": (SmokeCountdownParams, countdown_handler),
            "project.create": (
                ProjectCreateRequest,
                lambda params, _emit, _cancelled: _project_create_with_jobs(params, self),
            ),
            "project.open": (
                ProjectOpenRequest,
                lambda params, _emit, _cancelled: _project_open_with_jobs(params, self),
            ),
            "project.inspect": (
                ProjectInspectRequest,
                lambda params, emit, cancelled: project_inspect_handler(params, emit, cancelled, self.project_service),
            ),
            "asset.reference": (
                AssetReferenceRequest,
                lambda params, emit, cancelled: asset_reference_handler(params, emit, cancelled, self.project_service),
            ),
            "asset.list": (
                AssetListRequest,
                lambda params, emit, cancelled: asset_list_handler(params, emit, cancelled, self.project_service),
            ),
            "asset.scan": (
                AssetScanRequest,
                lambda params, emit, cancelled: asset_scan_handler(params, emit, cancelled, self.project_service),
            ),
            "media.probe": (
                MediaProbeParams,
                lambda params, emit, cancelled: media_probe_handler(params, emit, cancelled, self.project_service),
            ),
            "media.proxy": (
                MediaProxyParams,
                lambda params, emit, cancelled: media_proxy_handler(params, emit, cancelled, self.project_service),
            ),
            "media.transcribe": (
                TranscriptionParams,
                lambda params, emit, cancelled: media_transcribe_handler(params, emit, cancelled, self.project_service),
            ),
            "media.vad": (
                VadParams,
                lambda params, emit, cancelled: media_vad_handler(params, emit, cancelled, self.project_service),
            ),
            "media.sentences": (
                SentenceParams,
                lambda params, emit, cancelled: media_sentences_handler(params, emit, cancelled, self.project_service),
            ),
            "media.sentences.qa.context": (
                SentenceQaParams,
                lambda params, emit, cancelled: media_sentence_qa_context_handler(params, emit, cancelled, self.project_service),
            ),
            "media.sentences.qa.save": (
                SentenceQaSaveParams,
                lambda params, emit, cancelled: media_sentence_qa_save_handler(params, emit, cancelled, self.project_service),
            ),
            "media.sentences.index": (
                SentenceIndexParams,
                lambda params, emit, cancelled: media_sentence_index_handler(params, emit, cancelled, self.project_service),
            ),
            "media.sentences.retrieve": (
                RetrievalParams,
                lambda params, emit, cancelled: media_sentence_retrieval_handler(params, emit, cancelled, self.project_service),
            ),
            "media.sentences.rerank": (
                RerankParams,
                lambda params, emit, cancelled: media_sentence_rerank_handler(params, emit, cancelled, self.project_service),
            ),
            "media.script.align": (
                SlotAlignmentParams,
                lambda params, emit, cancelled: media_script_align_handler(params, emit, cancelled, self.project_service),
            ),
            "plan.create_remix": (
                NarrativePlanParams,
                lambda params, emit, cancelled: plan_create_remix_handler(params, emit, cancelled, self.project_service),
            ),
            "plan.optimize_duration": (
                DurationOptimizationParams,
                lambda params, emit, cancelled: plan_optimize_duration_handler(params, emit, cancelled, self.project_service),
            ),
            "media.aroll.cut_join": (
                ArollCutJoinParams,
                lambda params, emit, cancelled: media_aroll_cut_join_handler(params, emit, cancelled, self.project_service),
            ),
            "media.subtitle.plan": (
                SubtitlePlanParams,
                lambda params, emit, cancelled: media_subtitle_plan_handler(params, emit, cancelled, self.project_service),
            ),
            "media.preview.render": (
                PreviewRenderParams,
                lambda params, emit, cancelled: media_preview_render_handler(params, emit, cancelled, self.project_service),
            ),
            "media.preview.quality_check": (
                PreviewQualityCheckParams,
                lambda params, emit, cancelled: media_preview_quality_check_handler(params, emit, cancelled, self.project_service),
            ),
            "media.final.export": (
                FinalMp4ExportParams,
                lambda params, emit, cancelled: media_final_export_handler(params, emit, cancelled, self.project_service),
            ),
            "timeline.edit": (
                TimelineEditParams,
                lambda params, emit, cancelled: timeline_edit_handler(params, emit, cancelled, self.project_service),
            ),
            "timeline.version.create": (TimelineVersionCreateParams, lambda params, emit, cancelled: timeline_version_handler(params, emit, cancelled, self.project_service)),
            "timeline.version.apply_edit": (TimelineVersionApplyEditParams, lambda params, emit, cancelled: timeline_version_handler(params, emit, cancelled, self.project_service)),
            "timeline.version.list": (TimelineVersionListParams, lambda params, emit, cancelled: timeline_version_handler(params, emit, cancelled, self.project_service)),
            "timeline.version.get": (TimelineVersionReferenceParams, lambda params, emit, cancelled: timeline_version_handler(params, emit, cancelled, self.project_service)),
            "timeline.version.activate": (TimelineVersionActivateParams, lambda params, emit, cancelled: timeline_version_handler(params, emit, cancelled, self.project_service)),
            "timeline.version.undo": (TimelineVersionUndoParams, lambda params, emit, cancelled: timeline_version_handler(params, emit, cancelled, self.project_service)),
            "timeline.version.redo": (TimelineVersionRedoParams, lambda params, emit, cancelled: timeline_version_handler(params, emit, cancelled, self.project_service)),
            "timeline.version.diff": (TimelineVersionDiffParams, lambda params, emit, cancelled: timeline_version_handler(params, emit, cancelled, self.project_service)),
            "job.smoke.start": (
                JobSmokeStartParams,
                lambda params, _emit, _cancelled: job_smoke_start_handler(params, self.job_manager),
            ),
            "job.tts.start": (
                TtsJobStartParams,
                lambda params, _emit, _cancelled: job_tts_start_handler(params, self.job_manager),
            ),
            "job.remotion.start": (
                RemotionRenderParams,
                lambda params, _emit, _cancelled: job_remotion_start_handler(params, self.job_manager),
            ),
            "job.tts.result": (
                JobReferenceParams,
                lambda params, _emit, _cancelled: _job_tts_result(params, self.job_manager),
            ),
            "job.remotion.result": (
                JobReferenceParams,
                lambda params, _emit, _cancelled: _job_remotion_result(params, self.job_manager),
            ),
            "job.get": (
                JobReferenceParams,
                lambda params, _emit, _cancelled: _job_get(params, self.job_manager),
            ),
            "job.list": (
                JobListParams,
                lambda params, _emit, _cancelled: _job_list(params, self.job_manager),
            ),
            "job.events.list": (
                JobEventsListParams,
                lambda params, _emit, _cancelled: _job_events(params, self.job_manager),
            ),
            "job.cancel": (
                JobReferenceParams,
                lambda params, _emit, _cancelled: _job_cancel(params, self.job_manager),
            ),
            "job.retry": (
                JobReferenceParams,
                lambda params, _emit, _cancelled: _job_retry(params, self.job_manager),
            ),
        }

    def contains(self, method: str) -> bool:
        return method in self._methods

    def validate_params(self, method: str, params: object) -> BaseModel:
        spec = self._methods.get(method)
        if spec is None:
            raise RpcServiceError("METHOD_NOT_FOUND")
        params_model, _handler = spec
        try:
            return params_model.model_validate(params)
        except ValidationError as error:
            raise RpcServiceError("INVALID_PARAMS") from error

    async def invoke(
        self,
        method: str,
        params: object,
        emit: ProgressEmitter,
        cancelled: asyncio.Event,
    ) -> dict[str, object]:
        spec = self._methods.get(method)
        if spec is None:
            raise RpcServiceError("METHOD_NOT_FOUND")
        params_model = self.validate_params(method, params)
        return await spec[1](params_model, emit, cancelled)

    def close(self) -> None:
        self.project_service.close()

    async def shutdown(self) -> None:
        await self.job_manager.shutdown()
        self.project_service.close()


async def _job_get(params: JobReferenceParams, manager: JobManager) -> dict[str, object]:
    return manager.get(params.project_id, params.job_id).model_dump(by_alias=True)


async def _job_list(params: JobListParams, manager: JobManager) -> dict[str, object]:
    return manager.list(params.project_id, params.statuses, params.cursor, params.limit).model_dump(by_alias=True)


async def _job_events(params: JobEventsListParams, manager: JobManager) -> dict[str, object]:
    return manager.events(params.project_id, params.job_id, params.after_sequence, params.cursor, params.limit).model_dump(by_alias=True)


async def _job_cancel(params: JobReferenceParams, manager: JobManager) -> dict[str, object]:
    return (await manager.cancel(params.project_id, params.job_id)).model_dump(by_alias=True)


async def _job_retry(params: JobReferenceParams, manager: JobManager) -> dict[str, object]:
    return (await manager.retry(params.project_id, params.job_id)).model_dump(by_alias=True)


async def _job_tts_result(params: JobReferenceParams, manager: JobManager) -> dict[str, object]:
    return manager.get_tts_result(params.project_id, params.job_id).model_dump(by_alias=True)


async def _job_remotion_result(params: JobReferenceParams, manager: JobManager) -> dict[str, object]:
    return manager.get_remotion_result(params.project_id, params.job_id).model_dump(by_alias=True)
