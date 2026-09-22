"""Controlled media analysis adapters for B02 through B07."""

from .errors import MediaError
from .models import MediaProbeParams, MediaProxyParams
from .transcription_models import TranscriptionParams, TranscriptionResult
from .vad_models import VadParams, VadResult
from .sentence_models import SentenceConfig, SentenceParams, SentenceResult
from .qa_models import SentenceQaParams, SentenceQaSaveParams, SentenceQaContextResult, SentenceQaSaveResult
from .index_models import SentenceIndexParams, SentenceIndexResult
from .retrieval_models import RetrievalFilters, RetrievalParams, RetrievalResult
from .rerank_models import RerankConfig, RerankParams, RerankResult
from .slot_alignment_models import InformationSlot, SlotAlignmentCandidate, SlotAlignmentParams, SlotAlignmentResult
from .narrative_planner_models import NarrativePlanParams, NarrativePlanResult
from .duration_optimizer_models import DurationOptimizationParams, DurationOptimizationResult
from .aroll_cut_join_models import ArollCutJoinParams, ArollCutJoinResult
from .subtitle_plan_models import SubtitlePlanParams, SubtitlePlanResult
from .preview_render_models import PreviewRenderParams, PreviewRenderResult
from .quality_check_models import PreviewQualityCheckParams, PreviewQualityCheckResult
from .final_export_models import FinalMp4ExportParams, FinalMp4ExportResult
__all__ = ["MediaError", "MediaProbeParams", "MediaProxyParams", "MediaService", "SentenceConfig", "SentenceParams", "SentenceResult", "SentenceService", "SentenceQaParams", "SentenceQaSaveParams", "SentenceQaContextResult", "SentenceQaSaveResult", "SentenceQaService", "SentenceIndexParams", "SentenceIndexResult", "SentenceIndexService", "RetrievalFilters", "RetrievalParams", "RetrievalResult", "SentenceRetrievalService", "RerankConfig", "RerankParams", "RerankResult", "SentenceQualityRerankService", "TranscriptionParams", "TranscriptionResult", "TranscriptionService", "VadParams", "VadResult", "VadService", "InformationSlot", "SlotAlignmentCandidate", "SlotAlignmentParams", "SlotAlignmentResult", "InformationSlotAlignmentService", "NarrativePlanParams", "NarrativePlanResult", "NarrativePlannerService", "DurationOptimizationParams", "DurationOptimizationResult", "DurationOptimizerService", "ArollCutJoinParams", "ArollCutJoinResult", "ArollCutJoinService", "SubtitlePlanParams", "SubtitlePlanResult", "SubtitlePlanService", "PreviewRenderParams", "PreviewRenderResult", "PreviewRenderService", "PreviewQualityCheckParams", "PreviewQualityCheckResult", "PreviewQualityCheckService", "FinalMp4ExportParams", "FinalMp4ExportResult", "FinalMp4ExportService"]


def __getattr__(name: str):
    if name == "MediaService":
        from .service import MediaService

        return MediaService
    if name == "TranscriptionService":
        from .transcription import TranscriptionService

        return TranscriptionService
    if name == "VadService":
        from .vad import VadService

        return VadService
    if name == "SentenceService":
        from .sentences import SentenceService

        return SentenceService
    if name == "SentenceQaService":
        from .qa import SentenceQaService

        return SentenceQaService
    if name == "SentenceIndexService":
        from .index import SentenceIndexService

        return SentenceIndexService
    if name == "SentenceRetrievalService":
        from .retrieval import SentenceRetrievalService

        return SentenceRetrievalService
    if name == "SentenceQualityRerankService":
        from .rerank import SentenceQualityRerankService

        return SentenceQualityRerankService
    if name == "InformationSlotAlignmentService":
        from .slot_alignment import InformationSlotAlignmentService

        return InformationSlotAlignmentService
    if name == "NarrativePlannerService":
        from .narrative_planner import NarrativePlannerService

        return NarrativePlannerService
    if name == "DurationOptimizerService":
        from .duration_optimizer import DurationOptimizerService

        return DurationOptimizerService
    if name == "ArollCutJoinService":
        from .aroll_cut_join import ArollCutJoinService

        return ArollCutJoinService
    if name == "SubtitlePlanService":
        from .subtitle_plan import SubtitlePlanService

        return SubtitlePlanService
    if name == "PreviewRenderService":
        from .preview_render import PreviewRenderService

        return PreviewRenderService
    if name == "PreviewQualityCheckService":
        from .quality_check import PreviewQualityCheckService

        return PreviewQualityCheckService
    if name == "FinalMp4ExportService":
        from .final_export import FinalMp4ExportService

        return FinalMp4ExportService
    raise AttributeError(name)
