# D07 生成式视频组装

## 交付边界

D07 将 D05 script/storyboard、D02 TTS 结果、D06 离线图片结果、D04 受控版式计划、D03 preview/render plan 和可选用户素材引用组装为 `video-assembly-v1` 请求，并产出经过 C01 唯一 Timeline IR V1 validator 校验的完整 assembly plan。

当前实现固定为 `offline-deterministic`。它只生成可消费的 Timeline IR、项目内受控相对 plan 引用、provenance 和稳定 digest，不生成 MP4，不调用网络、模型、API key、FFmpeg 或实际 Remotion render。无真人素材时，fixture 使用假 D06 图片和假 D02 TTS 结果，仍能得到完整、连续、可预览输入的 assembly plan；这不代表已经完成真实视频渲染。

## 契约与输入

契约由 `packages/shared/src/video-assembly-contract.ts` 和 Python Core 的 `video_assembly_models.py` 共同实现，版本为 `video-assembly-v1`。请求固定绑定 `projectId`、`timelineId`、`assemblyId`、D05 storyboard、D02 TTS、D06 image results、D04 plan 和 D03 plan；未知字段、绝对路径、网络 URL、secret/credential/provider command 等非允许字段、越界时长/片段数/文本及字节数都会被拒绝。

用户素材必须是 `supervideo://asset/<sourceId>` 形式的受控引用，并与 D05 镜头的 `user-material` 优先级和 D04 plan source 对齐。D07 不读取或复制原始素材文件。

## Timeline 组装

每个 D05 镜头生成稳定的 video/image clip；D06 图片优先作为 generated source，D05 明确选择 `user-material` 时使用受控用户素材 source。D02 生成一个连续 audio track，字幕来自 D05，overlay/layout track 引用 D04 计划。所有 source、clip 和 provenance 引用必须可解析，镜头时间连续，片段 duration 与 source in/out 一致。

输出包含 `track:video`、`track:audio`、`track:subtitle`、`track:overlay`，以及 D03 的 `timeline-preview-v1` contract-only preview seam。输出 URI 仅允许 `supervideo://asset|generated|external/<id>` 的受控单段引用；计划文件为 `generated/video-assembly-v1/<timelineDigest>.json`，不泄漏完整路径、密钥或凭据。

## 失败语义与后续边界

组装失败返回稳定的 D07 error code/stage，例如 project mismatch、storyboard gap、TTS/image binding、material、plan 或 Timeline validation 错误。D07 不实现 D08 的多级 fallback，也不凭空补齐缺失素材、事实或 provenance；缺失或不匹配输入会明确拒绝。

本工作包提供 Core service 和 TS/Python smoke，不改变 Main API 或 A07 jobs。后续若接入固定 `video.assemble` job，应继续以 SQLite 为事实源，并复用本契约实现幂等、取消、有限重试和恢复；checkpoint 不得记录秘密。真实 Remotion/FFmpeg/provider 渲染、C09/C10 timeline 编辑和剪映导出属于后续范围。

## 验证

```powershell
npm run video-assembly:smoke
npm test
npm run core:test
npm run typecheck
npm run health
git diff --check
```

专项 fixture 位于 `tests/fixtures/d07_video_assembly_v1.mjs`，覆盖无真人素材完整预览、D02/D06 绑定、用户素材分支、稳定 digest、项目边界、provenance/路径/secret/未知字段和时序拒绝。
