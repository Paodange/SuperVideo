# C08 正式 MP4 导出 V1

C08 提供 `media.final.export` RPC 和 Desktop `exportFinalMp4` 能力。请求必须同时携带同一项目、同一 `planDigest` 的 C06 `PreviewRenderResult` 与 C07 `PreviewQualityCheckResult`。Core 会再次计算 C06 plan digest，并要求预览为 `ffmpeg/completed/ready` 且无 gaps；C07 必须为 `executed/pass/readyForExport=true`、`executionVerified=true`，所有 issue 都必须是 `pass/verified`。plan、not-run、warning、fail、gaps、工具未验证和篡改输入都不能导出。

输出契约版本为 `final-mp4-export-v1`，导出策略为 `verified-preview-mux-v1`，默认路径为：

```text
exports/videos/final-<planDigest>.mp4
exports/videos/final-<planDigest>.manifest.json
```

也可以传入单个安全的 `.mp4` 文件名；不能包含绝对路径、反斜杠、目录、`.`、`..` 或符号链接。导出目录和父目录都会检查，输出以同目录临时文件、`fsync` 和原子替换提交；已有不同内容的目标返回 `FINAL_EXPORT_OUTPUT_CONFLICT`。匹配的 manifest、大小、SHA-256 和重新探测通过的媒体容器会返回 `cache-hit`，因此相同输入可重复生成。

请求还必须携带同项目、同 Timeline 的 C04 `ArollCutJoinResult` 和音频 SHA-256 fingerprint。C08 会验证 C04 输出仍是计划绑定的 AAC 音频、未被替换且时长与 C06 Timeline 一致，然后通过 FFmpeg 将 C06 视频与该音频 mux/transcode 到正式的 1080x1920 H.264/AAC MP4。最终临时文件必须再次通过 `ffprobe`，并检查 MP4、H.264、AAC、1080x1920 和时长。manifest 记录项目、Timeline、C06 plan、C07 quality digest、C04 audio plan/path/fingerprint、源预览 fingerprint、输出路径、大小、时长、SHA-256 及已验证的容器信息，不记录外部完整路径、命令行或工具 stderr。

稳定错误包括 `FINAL_EXPORT_PREVIEW_NOT_READY`、`FINAL_EXPORT_AUDIO_NOT_READY`、`FINAL_EXPORT_AUDIO_INVALID`、`FINAL_EXPORT_AUDIO_TAMPERED`、`FINAL_EXPORT_QUALITY_NOT_READY`、`FINAL_EXPORT_SOURCE_INVALID`、`FINAL_EXPORT_SOURCE_TAMPERED`、`FINAL_EXPORT_OUTPUT_CONFLICT`、`FINAL_EXPORT_CONTAINER_INVALID`、`FINAL_EXPORT_TOOL_UNAVAILABLE`、`FINAL_EXPORT_TIMEOUT` 和 `FINAL_EXPORT_CANCELLED`。缺少可验证的 C04 音频时，C08 会稳定拒绝导出，不会生成无音轨的正式 MP4。
