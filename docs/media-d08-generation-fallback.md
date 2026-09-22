# D08 生成失败回退 V1

D08 是 D07 之前的离线、确定性 fallback seam。它接收已经版本化的 D05 storyboard、D02 TTS 结果或失败记录、D06 图片结果或失败记录、D04/D03 计划和受控用户素材引用，逐镜头解析可审计的选择，然后在输入足够完整时生成一个原样可交给 D07 的 `video-assembly-v1` request。

D08 不调用网络、Provider、API Key、FFmpeg、Remotion 或 Electron，不写音频/图片文件，也不修改 C01 Timeline IR V1。它只返回结构化策略结果；实际 Timeline 仍由 D07 负责。

## 契约版本

TypeScript 契约位于 `packages/shared/src/generation-fallback-contract.ts`，Python 对应模型和策略位于：

- `services/core/src/supervideo_core/media/fallback_models.py`
- `services/core/src/supervideo_core/media/fallback.py`

固定值为：

```text
schemaVersion: 1
contractVersion: generation-fallback-v1
policyVersion: deterministic-generation-fallback-v1
runtimeMode: offline-deterministic
```

输入强制绑定 `projectId`、`timelineId`、`assemblyId`。D05、D04、D06、D02 结果必须属于同一项目；未知字段、跨项目对象、绝对路径、敏感字段、非法 controlled URI 和未声明的 shot 都会拒绝。

## 解析规则

每个非 gap 镜头按 D05 的 `visualSourcePriority` 从左到右只走一次。`attempts` 只保留已走过的优先级前缀，source 不重复，因此策略不会 fallback loop，也不会把未尝试的候选伪装成失败。

| 来源 | 可用条件 | D07 绑定 |
|---|---|---|
| `user-material` | D05 首选用户素材且存在同 shot 的受控 `supervideo://asset/<sourceId>` | `user-material` |
| `licensed-stock` | D08 当前没有联网素材输入契约，因此稳定标记 unavailable | 无 |
| `ai-image` | 存在同项目、同 shot、通过 D06 校验的 image result；D06 failure 会记录原始稳定 code/stage | `d06-image` |
| `remotion-template` | D04 template plan 存在且该镜头没有 animation failure | 当前仅审计/可视 fallback，不伪造 D06 图片 |
| `text-card` | 有匹配 D05 句子且没有显式 `textCardUnavailableShotIds` | 当前仅审计/可视 fallback，不伪造 D06 图片 |

如果 D05 原本是 `planned`，但用户素材不可用而选择了非用户来源，D08 生成一个 D05 v1 兼容的 `resolvedStoryboard`，将该镜头降为 `no-user-material` 的固定优先级；原始 `d05FallbackReason` 仍保留在每镜头审计中。这样 D07 看到的是合法的 D05 输入，不会被迫猜测 D08 的选择。

每个镜头输出：

- `status`、`chosenSource`、`fallbackReason`；
- 原始 D05 fallback reason；
- ordered `attempts`，每项包含 `outcome`、稳定 `error.code/stage` 和受控 provenance；
- `d07Binding`，只允许 `user-material` 或 `d06-image`；
- 终端 `remotion-template`/`text-card` 会标记 `FALLBACK_D07_SOURCE_UNSUPPORTED`，而不是生成假的 D06 结果；
- 所有候选不可用时返回 `FALLBACK_CANDIDATES_EXHAUSTED`，该镜头为 `unresolved`，其他镜头的选择和审计仍保留。

`source-gap` 保留 D05 的 gap、零时长和 gap provenance，不补句子、不补事实、不生成音频。因为 D07 明确拒绝 gap，这类结果不会产生 D07 request。

## TTS 失败语义

TTS 输入必须是一个通过 D02 校验的成功结果，或一个 D08 `ttsFailure`，不能同时存在。失败时输出：

```text
status: fallback
chosenSource: silence-placeholder
d07Binding: null
diagnostic: FALLBACK_TTS_AUDIO_UNAVAILABLE / tts
```

这里的 silence placeholder 是审计语义，不是音频文件、relativePath 或伪造的 D02 `TtsSynthesisResult`。因此 D08 结果可以保存完整视觉 fallback 和诊断，但 `d07Eligible=false`，不会把不完整输入送进 D07。

## 结果和 digest

`status` 的含义：

- `ready`：所有镜头都有 D07 支持的来源，TTS 成功，`videoAssemblyRequest` 通过 D07 request contract；
- `partial`：镜头已解析，但至少一个镜头只有当前 D07 不接收的 template/text-card 视觉来源；
- `blocked`：存在 source gap、候选耗尽或 TTS failure。

校验器强制 `status` 与结果事实一致：存在 `videoAssemblyRequest` 或 `d07Eligible=true` 时只能是 `ready`；没有 D07 request 时，只要 TTS 是 fallback 或任一镜头为 `unresolved` 就只能是 `blocked`，否则只能是 `partial`。

`inputDigest` 和 `resultDigest` 都使用与 D07 相同的 canonical JSON/SHA-256 规则。`inputDigest` 不只绑定 `sourcePlanDigest`：它还绑定 D05 storyboard 的受控完整 projection（包括状态、hook/body/CTA segments、显式 gap/null 字段、shots 和 fallback 状态），以及完整受控的 D04 layout plan 和 D03 Remotion plan identity。`resultDigest` 的完整投影绑定版本、项目/时间线/装配 ID、`status`、`d07Eligible`、`inputDigest`、原始 `storyboardDigest`、TTS 解析、逐镜头解析、`d07Diagnostic`、完整 `resolvedStoryboard` 和完整 `videoAssemblyRequest`；投影明确不包含 `resultDigest` 本身，避免循环。

跨运行时 projection 保留 D05 契约要求的 null（例如 `durationPlanSourceDigest`、gap segment 的 `sentenceId`/`text`/`source`），只省略 TS 真正可选且为 `undefined` 的字段（例如 image user material 的 `durationMs`）。当前成功夹具的 `inputDigest/resultDigest` 为 `7b6b8a11faaad3503f4be248a8613f1283078d398d8df661781313dbe96345c4` / `528e2d0e7d284ea244ca76a0ef51f83aded8e1e7147c9596c18fdd4fa225dfc0`；同一 source-gap 夹具为 `7373c010c958c5c6d809eb875c4e0d177c8acb3947191199257b578b63107457` / `52e3a2da7d3e104b6dd920b602b1fa55e88ab2155c94cd75333fee93ffcb67d2`。digest 不包含 prompt、密钥、用户路径或隐私 metadata。

## 稳定错误

生成失败记录的 `code` 只允许：`PROVIDER_UNAVAILABLE`、`GENERATION_FAILED`、`OUTPUT_INVALID`、`TIMEOUT`、`CANCELLED`；`stage` 必须与 `component` 一致，分别为 `tts`、`image`、`animation`。D08 自身的诊断包括：

```text
FALLBACK_SOURCE_UNAVAILABLE      / selection
FALLBACK_SOURCE_GAP              / storyboard
FALLBACK_CANDIDATES_EXHAUSTED    / selection
FALLBACK_D07_SOURCE_UNSUPPORTED  / d07-binding
FALLBACK_TTS_AUDIO_UNAVAILABLE    / tts
FALLBACK_D07_INPUT_INVALID        / d07-binding
```

失败不会静默吞掉：每次失败都保留在对应镜头 attempt 或 TTS failure 中；单镜头失败不会清除其他镜头的结果。

## 当前限制

- D08 没有联网 licensed-stock 输入，也没有真实 Provider/RPC/job 接入；这些属于后续工作包。
- 现有 D07 只接受用户素材或 D06 image result。D08 可以审计并选择 Remotion/template 或 text-card，但不会把它们伪装成 D06/provider 结果；若要让这两类来源进入 D07，需要后续扩展 D07 的受控输入契约。
- TTS fallback 不创建静音 WAV；正式音轨交付需要重试 D02 或用户明确补充音频能力。
- 本工作包不实现真实渲染、MP4、FFmpeg、Timeline migration、Electron UI 或持久化 D08 job。

## 验证

```powershell
npm run generation-fallback:smoke
npm run typecheck
npm test
npm run core:test
npm run health
git diff --check
```

专项测试覆盖成功、单镜头图片失败、动画失败、TTS 失败、全部候选耗尽、source gap、用户素材、D07 handoff、跨项目篡改、未知/敏感/绝对路径字段、固定 digest 和无 fallback loop。
