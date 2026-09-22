# C09 自然语言修改 V1

C09 提供本地、确定性的 `timeline.edit` RPC，并通过 Agent Worker 与受限 Desktop API 暴露 `editTimeline`。它在传入的 Timeline IR V1 上生成候选下一状态；C09 不写数据库、不覆盖旧 IR，也不调用网络或真实 LLM，因此 C10 可以把结果保存为不可变版本。

## 契约

请求固定携带 `schemaVersion: 1`、`editVersion: "timeline-edit-v1"`、`policy: "deterministic-natural-language-v1"`、`projectId` 和完整 `timeline`。`instruction` 与 `intent` 必须二选一：

```json
{
  "schemaVersion": 1,
  "editVersion": "timeline-edit-v1",
  "policy": "deterministic-natural-language-v1",
  "projectId": "<uuid>",
  "intent": {
    "schemaVersion": 1,
    "editVersion": "edit-intent-v1",
    "policy": "deterministic-natural-language-v1",
    "operation": "subtitle",
    "targetClipId": "clip-subtitle-0001",
    "text": "新的字幕"
  },
  "timeline": { "...": "Timeline IR V1" }
}
```

结构化 `EditIntent` 只允许一个目标选择器：`targetClipId`、`targetSentenceId` 或 `targetText`。八个操作为 `delete`、`replace`、`move-forward`、`move-backward`、`shorten`、`extend`、`subtitle`、`cta`。替换必须引用当前 Timeline 中同轨道的 `replacementClipId`；时长操作使用 `amountMs`；字幕和 CTA 使用有界 `text`。

结果包括 `status`、解析后的 intent、`sourceTimelineId`、`resultTimeline`、差异摘要和 64 位 `determinismDigest`。成功结果的 Timeline ID 是基于规范化输入的 `:edit-<digest>`，拒绝结果保留源 Timeline。`preservedSourceIds` 与 `preservedProvenanceIds` 必须完整保真。

## 支持模板

- `删除 clip-camera-a`、`删除第 2 条`
- `把 clip-a 前移` / `把 clip-a 后移`
- `把 clip-a 换成 clip-b`（自然语言替换需要唯一匹配现有 clip）
- `把 clip-a 缩短 500 毫秒` / `加长 1 秒`
- `把字幕改成“新的字幕”`
- `把 clip-title-card 的 CTA 改成“请私信我领取岗位表”`

解析只做有限模板匹配。目标或替换素材不唯一、无法从当前 IR 无损执行、删除最后一个 clip，或会截断带 `sentenceId` 的完整句时返回 `status: "rejected"`，不会猜测素材或路径。

## 稳定错误码

`EDIT_UNSUPPORTED_INSTRUCTION`、`EDIT_TARGET_NOT_FOUND`、`EDIT_AMBIGUOUS_TARGET`、`EDIT_REPLACEMENT_NOT_FOUND`、`EDIT_COMPLETE_SENTENCE_REQUIRED`、`EDIT_TIMELINE_EMPTY`、`EDIT_OPERATION_UNSAFE`、`EDIT_TIMELINE_INVALID`。请求 schema、未知字段、版本/policy、Timeline IR 引用或大小越界属于边界 `INVALID_PARAMS`；拒绝原因则结构化放在结果中。

## 限制与 C10 接入点

C09 不保存版本、不实现撤销/重做、不渲染预览，也不从素材库搜索候选替换片段。C10 应将 `sourceTimelineId`、`intent`、`resultTimeline`、`diff` 和 `determinismDigest` 作为不可变版本记录，并通过 active-version 指针实现撤销/对比。重新渲染应重新消费 `resultTimeline`，不能依赖自然语言再次解析。
