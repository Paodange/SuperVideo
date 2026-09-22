"""Strict Python/Core contract for D04 recruitment layouts.

The contract deliberately stops at a deterministic layout artifact.  It does
not load a renderer, execute a command, or resolve an absolute media path.
"""

from __future__ import annotations

import json
import re
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from supervideo_core.timeline.models import TimelineProject, validate_timeline_size

RECRUITMENT_TEMPLATE_SCHEMA_VERSION = 1
RECRUITMENT_TEMPLATE_CONTRACT_VERSION = "recruitment-template-v1"
RECRUITMENT_TEMPLATE_RUNTIME_MODE = "offline-layout"
RECRUITMENT_CANVAS = {"width": 1080, "height": 1920, "fps": 30}
RECRUITMENT_SAFE_AREA = {"left": 96, "top": 192, "right": 96, "bottom": 240}
RECRUITMENT_MIN_DURATION_MS = 1_000
RECRUITMENT_MAX_DURATION_MS = 60_000
RECRUITMENT_MAX_INPUT_BYTES = 768 * 1024
RECRUITMENT_MAX_OUTPUT_BYTES = 256 * 1024
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
CONTROLLED_URI_PATTERN = re.compile(r"^supervideo://(?:asset|generated|external)/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?:\?[A-Za-z0-9._=&:-]{0,256})?$")
FORBIDDEN_KEY_PATTERN = re.compile(r"(?:secret|credential|token|password|command|executable|rendererpath|absolutepath)", re.IGNORECASE)

RecruitmentTemplateId = Literal["recruitment-classic", "recruitment-bold", "recruitment-split", "recruitment-photo-pan"]
RecruitmentTemplateVersion = Literal["recruitment-classic-v1", "recruitment-bold-v1", "recruitment-split-v1", "recruitment-photo-pan-v1"]


class RecruitmentTemplateModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class RecruitmentContent(RecruitmentTemplateModel):
    title: str = Field(min_length=1, max_length=24)
    job_title: str = Field(alias="jobTitle", min_length=1, max_length=32)
    salary: str = Field(min_length=1, max_length=24)
    location: str = Field(min_length=1, max_length=32)
    benefits: list[str] = Field(min_length=1, max_length=5)
    cta: str = Field(min_length=1, max_length=40)
    provenance_ids: list[str] = Field(alias="provenanceIds", min_length=1, max_length=32)

    @field_validator("title", "job_title", "salary", "location", "cta")
    @classmethod
    def validate_text(cls, value: str) -> str:
        return _text(value)

    @field_validator("benefits")
    @classmethod
    def validate_benefits(cls, value: list[str]) -> list[str]:
        return [_text(item, 20) for item in value]

    @field_validator("provenance_ids")
    @classmethod
    def validate_provenance_ids(cls, value: list[str]) -> list[str]:
        return _unique_ids(value, "content provenanceIds")


class RecruitmentMedia(RecruitmentTemplateModel):
    image_source_id: str = Field(alias="imageSourceId")
    provenance_ids: list[str] = Field(alias="provenanceIds", min_length=1, max_length=32)

    @field_validator("image_source_id")
    @classmethod
    def validate_image_source_id(cls, value: str) -> str:
        return _identifier(value, "media.imageSourceId")

    @field_validator("provenance_ids")
    @classmethod
    def validate_provenance_ids(cls, value: list[str]) -> list[str]:
        return _unique_ids(value, "media provenanceIds")


class RecruitmentTemplateProps(RecruitmentTemplateModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal[RECRUITMENT_TEMPLATE_CONTRACT_VERSION] = Field(alias="contractVersion")
    runtime_mode: Literal[RECRUITMENT_TEMPLATE_RUNTIME_MODE] = Field(alias="runtimeMode")
    project_id: str = Field(alias="projectId")
    template_id: RecruitmentTemplateId = Field(alias="templateId")
    template_version: RecruitmentTemplateVersion = Field(alias="templateVersion")
    timeline: TimelineProject
    content: RecruitmentContent
    media: RecruitmentMedia | None = None

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid recruitment project id")
        return value

    @model_validator(mode="after")
    def validate_recruitment_input(self) -> "RecruitmentTemplateProps":
        expected_version = TEMPLATE_REGISTRY[self.template_id]["templateVersion"]
        if self.template_version != expected_version:
            raise ValueError("templateVersion does not match templateId")
        validate_timeline_size(self.timeline)
        if self.timeline.canvas.width != 1080 or self.timeline.canvas.height != 1920 or self.timeline.canvas.fps != 30:
            raise ValueError("timeline canvas must be fixed 1080x1920@30")
        if not RECRUITMENT_MIN_DURATION_MS <= self.timeline.duration_ms <= RECRUITMENT_MAX_DURATION_MS:
            raise ValueError("timeline duration must be between 1000 and 60000 ms")
        _validate_timeline_bindings(self)
        _reject_forbidden_keys(self.model_dump(by_alias=True))
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > RECRUITMENT_MAX_INPUT_BYTES:
            raise ValueError("recruitment template input exceeds the size limit")
        return self


class RecruitmentLayoutBox(RecruitmentTemplateModel):
    x: int = Field(strict=True, gt=0, le=1080)
    y: int = Field(strict=True, gt=0, le=1920)
    width: int = Field(strict=True, gt=0, le=1080)
    height: int = Field(strict=True, gt=0, le=1920)


class RecruitmentTextComponent(RecruitmentTemplateModel):
    id: Literal["title", "job", "salary", "location", "benefits", "cta"]
    kind: Literal["text"]
    role: Literal["title", "job", "salary", "location", "benefits", "cta"]
    box: RecruitmentLayoutBox
    text: str = Field(min_length=1, max_length=120)
    font_size: int = Field(alias="fontSize", strict=True, ge=1, le=96)
    line_height: float = Field(alias="lineHeight", strict=True, ge=1, le=2)
    max_lines: int = Field(alias="maxLines", strict=True, ge=1, le=4)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$")
    background_color: str = Field(alias="backgroundColor", pattern=r"^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$")

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        return _text(value, 120)


class RecruitmentImagePanComponent(RecruitmentTemplateModel):
    id: Literal["image-pan"]
    kind: Literal["image-pan"]
    source_id: str = Field(alias="sourceId")
    box: RecruitmentLayoutBox
    motion: Literal["slow-zoom-in"]
    scale_from: Literal[1] = Field(alias="scaleFrom")
    scale_to: Literal[1.08] = Field(alias="scaleTo")

    @field_validator("source_id")
    @classmethod
    def validate_source_id(cls, value: str) -> str:
        return _identifier(value, "component.sourceId")


RecruitmentLayoutComponent = Annotated[Union[RecruitmentTextComponent, RecruitmentImagePanComponent], Field(discriminator="kind")]


class RecruitmentTemplateRenderPlan(RecruitmentTemplateModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal[RECRUITMENT_TEMPLATE_CONTRACT_VERSION] = Field(alias="contractVersion")
    runtime_mode: Literal[RECRUITMENT_TEMPLATE_RUNTIME_MODE] = Field(alias="runtimeMode")
    project_id: str = Field(alias="projectId")
    timeline_id: str = Field(alias="timelineId")
    template_id: RecruitmentTemplateId = Field(alias="templateId")
    template_version: RecruitmentTemplateVersion = Field(alias="templateVersion")
    canvas: dict[str, int]
    safe_area: dict[str, int] = Field(alias="safeArea")
    components: list[RecruitmentLayoutComponent] = Field(max_length=7)
    source_ids: list[str] = Field(alias="sourceIds", max_length=32)
    provenance_ids: list[str] = Field(alias="provenanceIds", min_length=1, max_length=32)
    overlap_rule: Literal["background-image-pan-may-overlap-foreground", "no-overlap"] = Field(alias="overlapRule")

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid plan project id")
        return value

    @field_validator("timeline_id")
    @classmethod
    def validate_timeline_id(cls, value: str) -> str:
        return _identifier(value, "timelineId")

    @field_validator("source_ids", "provenance_ids")
    @classmethod
    def validate_reference_ids(cls, value: list[str]) -> list[str]:
        return _unique_ids(value, "plan references")

    @model_validator(mode="after")
    def validate_layout(self) -> "RecruitmentTemplateRenderPlan":
        if self.template_version != TEMPLATE_REGISTRY[self.template_id]["templateVersion"]:
            raise ValueError("templateVersion does not match templateId")
        if self.canvas != RECRUITMENT_CANVAS or self.safe_area != RECRUITMENT_SAFE_AREA:
            raise ValueError("plan canvas or safe area is not fixed")
        expected_count = 7 if self.template_id == "recruitment-photo-pan" else 6
        if len(self.components) != expected_count:
            raise ValueError("plan component count is not fixed")
        if self.template_id == "recruitment-photo-pan" and len(self.source_ids) != 1:
            raise ValueError("photo-pan must expose exactly one source identifier")
        if self.template_id != "recruitment-photo-pan" and self.source_ids:
            raise ValueError("non-photo templates cannot expose media sources")
        _validate_layout_components(self)
        _reject_forbidden_keys(self.model_dump(by_alias=True))
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > RECRUITMENT_MAX_OUTPUT_BYTES:
            raise ValueError("recruitment layout plan exceeds the size limit")
        return self


def _definition(version: str, boxes: dict[str, dict[str, int]], font_sizes: dict[str, int], colors: dict[str, str]) -> dict[str, Any]:
    return {"templateVersion": version, "boxes": boxes, "fontSizes": font_sizes, "colors": colors}


def _box(x: int, y: int, width: int, height: int) -> dict[str, int]:
    return {"x": x, "y": y, "width": width, "height": height}


TEMPLATE_REGISTRY: dict[str, dict[str, Any]] = {
    "recruitment-classic": _definition("recruitment-classic-v1", {
        "title": _box(128, 240, 824, 150), "job": _box(128, 430, 824, 150), "salary": _box(128, 640, 824, 160),
        "location": _box(128, 840, 824, 100), "benefits": _box(128, 990, 824, 240), "cta": _box(128, 1330, 824, 180),
    }, {"title": 64, "job": 52, "salary": 72, "location": 36, "benefits": 32, "cta": 42}, {
        "title": "#FFFFFF", "job": "#FFFFFF", "salary": "#FFD166", "location": "#E8EEF7", "benefits": "#E8EEF7", "cta": "#111827",
    }),
    "recruitment-bold": _definition("recruitment-bold-v1", {
        "title": _box(128, 224, 824, 170), "job": _box(128, 430, 824, 155), "salary": _box(128, 660, 824, 180),
        "location": _box(128, 880, 824, 100), "benefits": _box(128, 1020, 824, 250), "cta": _box(128, 1370, 824, 190),
    }, {"title": 70, "job": 54, "salary": 80, "location": 38, "benefits": 34, "cta": 44}, {
        "title": "#111827", "job": "#111827", "salary": "#B42318", "location": "#344054", "benefits": "#344054", "cta": "#FFFFFF",
    }),
    "recruitment-split": _definition("recruitment-split-v1", {
        "title": _box(128, 228, 824, 145), "job": _box(128, 420, 824, 145), "salary": _box(128, 635, 824, 170),
        "location": _box(128, 850, 824, 105), "benefits": _box(128, 1010, 824, 270), "cta": _box(128, 1400, 824, 185),
    }, {"title": 60, "job": 50, "salary": 76, "location": 36, "benefits": 32, "cta": 44}, {
        "title": "#0B3B60", "job": "#0B3B60", "salary": "#0B3B60", "location": "#276749", "benefits": "#334155", "cta": "#FFFFFF",
    }),
    "recruitment-photo-pan": _definition("recruitment-photo-pan-v1", {
        "title": _box(128, 300, 824, 150), "job": _box(128, 480, 824, 150), "salary": _box(128, 690, 824, 170),
        "location": _box(128, 900, 824, 105), "benefits": _box(128, 1050, 824, 250), "cta": _box(128, 1390, 824, 190),
    }, {"title": 62, "job": 52, "salary": 76, "location": 36, "benefits": 32, "cta": 44}, {
        "title": "#FFFFFF", "job": "#FFFFFF", "salary": "#FFE08A", "location": "#FFFFFF", "benefits": "#FFFFFF", "cta": "#111827",
    }),
}


def build_recruitment_template_render_plan(value: RecruitmentTemplateProps | dict[str, Any]) -> RecruitmentTemplateRenderPlan:
    props = value if isinstance(value, RecruitmentTemplateProps) else RecruitmentTemplateProps.model_validate(value)
    definition = TEMPLATE_REGISTRY[props.template_id]
    content = props.content
    components: list[dict[str, Any]] = [
        _text_component("title", content.title, definition),
        _text_component("job", content.job_title, definition),
        _text_component("salary", content.salary, definition),
        _text_component("location", content.location, definition),
        _text_component("benefits", " · ".join(content.benefits), definition),
        _text_component("cta", content.cta, definition),
    ]
    source_ids: list[str] = []
    if props.template_id == "recruitment-photo-pan":
        assert props.media is not None
        components.insert(0, {"id": "image-pan", "kind": "image-pan", "sourceId": props.media.image_source_id, "box": _box(96, 192, 888, 1488), "motion": "slow-zoom-in", "scaleFrom": 1, "scaleTo": 1.08})
        source_ids.append(props.media.image_source_id)
    return RecruitmentTemplateRenderPlan.model_validate({
        "schemaVersion": 1,
        "contractVersion": RECRUITMENT_TEMPLATE_CONTRACT_VERSION,
        "runtimeMode": RECRUITMENT_TEMPLATE_RUNTIME_MODE,
        "projectId": props.project_id,
        "timelineId": props.timeline.id,
        "templateId": props.template_id,
        "templateVersion": props.template_version,
        "canvas": RECRUITMENT_CANVAS,
        "safeArea": RECRUITMENT_SAFE_AREA,
        "components": components,
        "sourceIds": source_ids,
        "provenanceIds": list(dict.fromkeys([*content.provenance_ids, *(props.media.provenance_ids if props.media else [])])),
        "overlapRule": "background-image-pan-may-overlap-foreground" if props.template_id == "recruitment-photo-pan" else "no-overlap",
    })


def validate_recruitment_template_props(value: RecruitmentTemplateProps | dict[str, Any]) -> RecruitmentTemplateProps:
    return value if isinstance(value, RecruitmentTemplateProps) else RecruitmentTemplateProps.model_validate(value)


def validate_recruitment_template_render_plan(value: RecruitmentTemplateRenderPlan | dict[str, Any]) -> RecruitmentTemplateRenderPlan:
    return value if isinstance(value, RecruitmentTemplateRenderPlan) else RecruitmentTemplateRenderPlan.model_validate(value)


def _text_component(role: str, text: str, definition: dict[str, Any]) -> dict[str, Any]:
    return {"id": role, "kind": "text", "role": role, "box": definition["boxes"][role], "text": text, "fontSize": definition["fontSizes"][role], "lineHeight": 1.25, "maxLines": 4 if role == "benefits" else 2, "color": definition["colors"][role], "backgroundColor": "#00000000"}


def _text(value: str, maximum: int | None = None) -> str:
    if maximum is not None and len(value) > maximum:
        raise ValueError(f"text exceeds {maximum} characters")
    if value.strip() == "" or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("text must contain printable non-whitespace characters")
    return value


def _identifier(value: str, path: str) -> str:
    if ID_PATTERN.fullmatch(value) is None:
        raise ValueError(f"invalid identifier at {path}")
    return value


def _unique_ids(values: list[str], path: str) -> list[str]:
    if len(values) != len(set(values)) or any(ID_PATTERN.fullmatch(value) is None for value in values):
        raise ValueError(f"{path} must contain unique valid identifiers")
    return values


def _validate_timeline_bindings(props: RecruitmentTemplateProps) -> None:
    provenance = {item.id: item for item in props.timeline.provenance}
    sources = {item.id: item for item in props.timeline.sources}
    if any(item not in provenance for item in props.content.provenance_ids):
        raise ValueError("content provenanceIds must reference declared Timeline provenance")
    if props.template_id == "recruitment-photo-pan":
        if props.media is None:
            raise ValueError("media is required by recruitment-photo-pan")
        source = sources.get(props.media.image_source_id)
        if source is None or source.media_type != "image":
            raise ValueError("imageSourceId must reference a declared image source")
        if any(item not in provenance for item in props.media.provenance_ids):
            raise ValueError("media provenanceIds must reference declared Timeline provenance")
        if any(item not in (source.provenance_ids or []) for item in props.media.provenance_ids):
            raise ValueError("media provenanceIds must be bound to the image source provenance")
    elif props.media is not None:
        raise ValueError("media is only allowed for recruitment-photo-pan")
    for source in props.timeline.sources:
        if CONTROLLED_URI_PATTERN.fullmatch(source.uri) is None:
            raise ValueError("Timeline source URI is not a controlled supervideo reference")
    for item in props.timeline.provenance:
        if item.uri is not None and CONTROLLED_URI_PATTERN.fullmatch(item.uri) is None:
            raise ValueError("Timeline provenance URI is not a controlled supervideo reference")


def _validate_layout_components(plan: RecruitmentTemplateRenderPlan) -> None:
    definition = TEMPLATE_REGISTRY[plan.template_id]
    text_components = [component for component in plan.components if isinstance(component, RecruitmentTextComponent)]
    image_components = [component for component in plan.components if isinstance(component, RecruitmentImagePanComponent)]
    if plan.template_id == "recruitment-photo-pan":
        if len(image_components) != 1 or image_components[0].box.model_dump() != _box(96, 192, 888, 1488):
            raise ValueError("photo-pan must contain its fixed background image component")
        if len(plan.source_ids) != 1 or image_components[0].source_id != plan.source_ids[0]:
            raise ValueError("photo-pan sourceIds must match the image-pan source binding")
        if plan.overlap_rule != "background-image-pan-may-overlap-foreground":
            raise ValueError("photo-pan must declare the fixed overlap rule")
    elif image_components or plan.overlap_rule != "no-overlap":
        raise ValueError("non-photo templates cannot use image-pan or overlap")
    if {component.id for component in text_components} != {"title", "job", "salary", "location", "benefits", "cta"}:
        raise ValueError("text component allowlist is incomplete or duplicated")
    boxes: list[RecruitmentLayoutBox] = []
    for component in text_components:
        role = component.role
        if component.id != role or component.box.model_dump() != definition["boxes"][role]:
            raise ValueError(f"component {role} does not use its fixed box")
        if component.font_size != definition["fontSizes"][role] or component.line_height != 1.25 or component.max_lines != (4 if role == "benefits" else 2) or component.color != definition["colors"][role] or component.background_color != "#00000000":
            raise ValueError(f"component {role} does not use its fixed style")
        _validate_safe_box(component.box)
        boxes.append(component.box)
    if plan.overlap_rule == "no-overlap":
        if _has_overlap(boxes):
            raise ValueError("foreground components may not overlap")
    else:
        _validate_safe_box(image_components[0].box)


def _validate_safe_box(box: RecruitmentLayoutBox) -> None:
    if box.x < 96 or box.y < 192 or box.x + box.width > 984 or box.y + box.height > 1680:
        raise ValueError("component bounding box leaves the fixed Douyin safe area")


def _has_overlap(boxes: list[RecruitmentLayoutBox]) -> bool:
    for index, left in enumerate(boxes):
        for right in boxes[index + 1:]:
            if left.x < right.x + right.width and left.x + left.width > right.x and left.y < right.y + right.height and left.y + left.height > right.y:
                return True
    return False


def _reject_forbidden_keys(value: Any, depth: int = 0) -> None:
    if depth > 16:
        raise ValueError("recruitment template nesting is too deep")
    if isinstance(value, dict):
        for key, item in value.items():
            if FORBIDDEN_KEY_PATTERN.search(str(key)):
                raise ValueError("secret, credential, command, or absolute path fields are forbidden")
            _reject_forbidden_keys(item, depth + 1)
    elif isinstance(value, list):
        if len(value) > 2_048:
            raise ValueError("recruitment template array is too large")
        for item in value:
            _reject_forbidden_keys(item, depth + 1)


__all__ = [
    "RECRUITMENT_CANVAS", "RECRUITMENT_MAX_INPUT_BYTES", "RECRUITMENT_MAX_OUTPUT_BYTES", "RECRUITMENT_SAFE_AREA",
    "RECRUITMENT_TEMPLATE_CONTRACT_VERSION", "RECRUITMENT_TEMPLATE_RUNTIME_MODE", "RECRUITMENT_TEMPLATE_SCHEMA_VERSION",
    "RecruitmentContent", "RecruitmentMedia", "RecruitmentTemplateProps", "RecruitmentTemplateRenderPlan",
    "RecruitmentTextComponent", "RecruitmentImagePanComponent", "TEMPLATE_REGISTRY",
    "build_recruitment_template_render_plan", "validate_recruitment_template_props", "validate_recruitment_template_render_plan",
]
