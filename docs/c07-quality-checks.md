# C07 预览质量检查

C07 提供版本化的 `media.preview.quality_check` RPC，用于检查 C06 `PreviewRenderResult`。请求携带 `projectId`、完整的 `previewResult` 和可选 `timeoutMs`，结果版本为 `preview-quality-v1`。

质量结果包含 `status`（`pass`、`warning` 或 `fail`）、`phase`（`plan` 或 `executed`）、`executionVerified`、`readyForExport` 和稳定的 `issues[]`。每个问题项包含 `checkId`、稳定 `code`、`severity`、`status`（`verified` 或 `not-run`）和不含路径/媒体内容的固定消息。

计划阶段只检查 C04/C05 映射：来源绑定唯一且非空、canonical plan digest、字幕顺序、时间范围、覆盖关系和 gap。它始终返回 `QA_EXECUTION_NOT_RUN`，不伪造输出校验，`readyForExport` 为 `false`。

执行阶段额外检查预览文件是否位于 `previews/preview-render-v1/<planDigest>.mp4`、播放 URI 是否绑定当前项目和 digest、是否为非空普通文件、大小和 SHA-256 是否匹配 C06 结果、manifest 是否逐字段匹配，以及声明时长和 ffprobe 实测容器/视频流信息。ffprobe 不可用时对应项目为 `warning/not-run`，执行结果仍不可宣称完全验证；任一失败项都会阻止导出。

取消和超时分别使用 `PREVIEW_QUALITY_CANCELLED`、`PREVIEW_QUALITY_TIMEOUT`。输入或结果契约错误使用 `PREVIEW_QUALITY_INPUT_INVALID`、`PREVIEW_QUALITY_OUTPUT_INVALID`；这些错误只返回稳定错误码，不记录密钥、媒体内容或完整外部路径。
