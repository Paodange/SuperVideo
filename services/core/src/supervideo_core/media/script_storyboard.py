"""Deterministic D05 script and storyboard planning over C02/C03 contracts."""

from __future__ import annotations

import asyncio
from typing import Any

from .errors import MediaError
from .script_storyboard_models import (
    SCRIPT_STORYBOARD_CONTRACT_VERSION,
    SCRIPT_STORYBOARD_PLANNER_VERSION,
    SCRIPT_STORYBOARD_SCHEMA_VERSION,
    ScriptStoryboardFactAudit,
    ScriptStoryboardParams,
    ScriptStoryboardProvenance,
    ScriptStoryboardResult,
    ScriptStoryboardScript,
    ScriptStoryboardSegment,
    ScriptStoryboardShot,
    source_provenance_id,
)


class ScriptStoryboardPlannerService:
    """Build a bounded plan; it never calls a model, Provider, network, or filesystem."""

    async def plan(self, request: ScriptStoryboardParams, cancelled: asyncio.Event) -> ScriptStoryboardResult:
        if cancelled.is_set():
            raise MediaError("SCRIPT_STORYBOARD_CANCELLED")
        try:
            selected = self._selected_segments(request)
            self._validate_selected_segments(request, selected)
            fact_bindings = {binding.segment_id: tuple(binding.fact_ids) for binding in request.fact_bindings}
            facts_by_id = {fact.id: fact for fact in request.facts}
            input_provenance = {item.id: item for item in request.provenance}
            output_provenance = list(input_provenance.values())
            output_segments: list[ScriptStoryboardSegment] = []
            audits: list[ScriptStoryboardFactAudit] = []
            matched_segment_ids: set[str] = set()
            output_fact_segments: dict[str, list[str]] = {fact.id: [] for fact in request.facts}

            for index, selected_segment in enumerate(selected, start=1):
                if cancelled.is_set():
                    raise MediaError("SCRIPT_STORYBOARD_CANCELLED")
                source_segment = self._source_segment(request, selected_segment.segment_id)
                kind = "c03" if request.duration_plan is not None else "c02"
                derived_provenance_id = source_provenance_id(source_segment, request.source_plan.plan_digest, kind)
                output_provenance.append(ScriptStoryboardProvenance(
                    id=derived_provenance_id,
                    kind="c03-selection" if kind == "c03" else "c02-segment",
                    label="C03 whole-sentence selection" if kind == "c03" else "C02 complete-sentence source",
                    sourceSegmentId=source_segment.segment_id,
                    verified=selected_segment.status == "matched",
                ))
                fact_ids = [fact_id for fact_id in fact_bindings.get(source_segment.segment_id, ()) if fact_id in facts_by_id]
                for fact_id in fact_ids:
                    output_fact_segments[fact_id].append(source_segment.segment_id)
                provenance_ids = [derived_provenance_id]
                for fact_id in fact_ids:
                    provenance_ids.extend(facts_by_id[fact_id].provenance_ids)
                provenance_ids = list(dict.fromkeys(provenance_ids))
                confirmation = self._confirmation(fact_ids, facts_by_id)
                source = selected_segment.source if selected_segment.status == "matched" else None
                sentence_id = selected_segment.candidate_sentence_id if selected_segment.status == "matched" else None
                text = selected_segment.sentence_text if selected_segment.status == "matched" else None
                output_segments.append(ScriptStoryboardSegment(
                    segmentId=selected_segment.segment_id,
                    sourceSegmentId=source_segment.segment_id,
                    order=index,
                    role=selected_segment.role,
                    status=selected_segment.status,
                    sentenceId=sentence_id,
                    text=text,
                    source=source,
                    durationMs=selected_segment.duration_ms,
                    provenanceIds=provenance_ids,
                    factIds=fact_ids,
                    confirmation=confirmation,
                ))
                if selected_segment.status == "matched":
                    matched_segment_ids.add(source_segment.segment_id)

            for fact in request.facts:
                segment_ids = output_fact_segments[fact.id]
                if not segment_ids:
                    status = "unbound"
                elif fact.verification != "verified":
                    status = "needs-user-confirmation"
                else:
                    status = "bound"
                audits.append(ScriptStoryboardFactAudit(
                    factId=fact.id,
                    status=status,
                    provenanceIds=list(fact.provenance_ids),
                    segmentIds=segment_ids,
                ))

            shots = self._build_shots(request, output_segments)
            script = self._build_script(output_segments)
            selected_duration = sum(segment.duration_ms for segment in output_segments)
            lower = int(request.target.duration_ms * 0.8)
            upper = int(request.target.duration_ms * 1.2)
            duration_status = "within-tolerance" if lower <= selected_duration <= upper else "outside-tolerance"
            has_gaps = any(segment.status == "gap" for segment in output_segments)
            needs_confirmation = any(item.status == "needs-user-confirmation" for item in audits)
            status = (
                "gaps" if has_gaps else
                "needs-user-confirmation" if needs_confirmation else
                "ready" if duration_status == "within-tolerance" else
                "needs-duration-optimization"
            )
            return ScriptStoryboardResult(
                schemaVersion=SCRIPT_STORYBOARD_SCHEMA_VERSION,
                contractVersion=SCRIPT_STORYBOARD_CONTRACT_VERSION,
                plannerVersion=SCRIPT_STORYBOARD_PLANNER_VERSION,
                projectId=request.project_id,
                sourcePlanDigest=request.source_plan.plan_digest,
                durationPlanSourceDigest=request.duration_plan.source_plan_digest if request.duration_plan else None,
                targetDurationMs=request.target.duration_ms,
                toleranceLowerMs=lower,
                toleranceUpperMs=upper,
                selectedDurationMs=selected_duration,
                durationStatus=duration_status,
                durationPolicy="c03-bounded-whole-sentence-knapsack-v1" if request.duration_plan else "c02-complete-sentence-v1",
                status=status,
                brief=request.brief,
                forbiddenInferences=list(request.forbidden_inferences),
                provenance=self._unique_provenance(output_provenance),
                facts=audits,
                script=script,
                shots=shots,
            )
        except MediaError:
            raise
        except (TypeError, ValueError) as error:
            raise MediaError("SCRIPT_STORYBOARD_OUTPUT_INVALID", cause=error) from error

    @staticmethod
    def _selected_segments(request: ScriptStoryboardParams) -> list[Any]:
        if request.duration_plan is None:
            return list(request.source_plan.segments)
        return list(request.duration_plan.segments)

    @staticmethod
    def _source_segment(request: ScriptStoryboardParams, segment_id: str) -> Any:
        for segment in request.source_plan.segments:
            if segment.segment_id == segment_id:
                return segment
        raise MediaError("SCRIPT_STORYBOARD_SOURCE_INVALID")

    @classmethod
    def _validate_selected_segments(cls, request: ScriptStoryboardParams, selected: list[Any]) -> None:
        if not selected or len(selected) > 32:
            raise MediaError("SCRIPT_STORYBOARD_INPUT_INVALID")
        source_by_id = {item.segment_id: item for item in request.source_plan.segments}
        seen: set[str] = set()
        for item in selected:
            if item.segment_id in seen or item.segment_id not in source_by_id:
                raise MediaError("SCRIPT_STORYBOARD_SOURCE_INVALID")
            seen.add(item.segment_id)
            source = source_by_id[item.segment_id]
            if item.role != source.role or item.slot_id != source.slot_id:
                raise MediaError("SCRIPT_STORYBOARD_SOURCE_INVALID")
            if item.status == "matched":
                if item.source is None or item.sentence_text is None or item.candidate_sentence_id is None:
                    raise MediaError("SCRIPT_STORYBOARD_SOURCE_INVALID")
                if item.duration_ms != item.source.timecode.end_ms - item.source.timecode.start_ms:
                    raise MediaError("SCRIPT_STORYBOARD_DURATION_INVALID")
            elif item.duration_ms != 0:
                raise MediaError("SCRIPT_STORYBOARD_DURATION_INVALID")

    @staticmethod
    def _confirmation(fact_ids: list[str], facts: dict[str, Any]) -> str:
        if not fact_ids:
            return "not-required"
        return "verified" if all(facts[item].verification == "verified" for item in fact_ids) else "needs-user-confirmation"

    @staticmethod
    def _unique_provenance(items: list[ScriptStoryboardProvenance]) -> list[ScriptStoryboardProvenance]:
        result: list[ScriptStoryboardProvenance] = []
        seen: set[str] = set()
        for item in items:
            if item.id not in seen:
                seen.add(item.id)
                result.append(item)
        return result

    @staticmethod
    def _build_script(segments: list[ScriptStoryboardSegment]) -> ScriptStoryboardScript:
        hooks = [item for item in segments if item.role == "hook"]
        body = [item for item in segments if item.role == "body"]
        ctas = [item for item in segments if item.role == "cta"]
        if len(hooks) != 1 or len(ctas) != 1:
            raise MediaError("SCRIPT_STORYBOARD_ROLE_INVALID")
        return ScriptStoryboardScript(hook=hooks[0], body=body, cta=ctas[0])

    @staticmethod
    def _build_shots(request: ScriptStoryboardParams, segments: list[ScriptStoryboardSegment]) -> list[ScriptStoryboardShot]:
        shots: list[ScriptStoryboardShot] = []
        for index, segment in enumerate(segments, start=1):
            if request.visual_context.has_user_material and segment.status == "matched":
                priority = ["user-material", "licensed-stock", "ai-image", "remotion-template", "text-card"]
                fallback = "planned"
            elif segment.status == "gap":
                priority = ["remotion-template", "ai-image", "text-card"]
                fallback = "source-gap"
            else:
                priority = ["licensed-stock", "ai-image", "remotion-template", "text-card"]
                fallback = "no-user-material"
            shots.append(ScriptStoryboardShot(
                shotId=f"shot-{index}",
                order=index,
                segmentId=segment.segment_id,
                durationMs=segment.duration_ms,
                visualSourcePriority=priority,
                fallbackReason=fallback,
                visualIntent=f"support the {segment.role} with an allowed visual source",
            ))
        return shots
