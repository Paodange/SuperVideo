# D06 AI 图片适配器 V1

D06 提供一个可被 D07 消费的、版本化的图片生成结果。当前实现是离线、确定性的
`fake-image-v1`：它生成最小有效 PNG，不访问网络、不读取 API Key，也不声称已经接入真实
图片服务。未来真实 Provider 只能通过 Electron Main-owned callback seam 接入，凭据只在
`CredentialVault.runWithSecret` 的 callback 内可见。

## 合同

合同位于 `packages/shared/src/image-contract.ts` 与
`services/core/src/supervideo_core/media/image_models.py`，`contractVersion` 和
`schemaVersion` 均为 `1`。`image.generate` 输入绑定：

- `projectId`、`idempotencyKey`、单个 `shotId`；
- 用户允许的 `prompt`；
- `providerId`、`model`；
- 固定结构的 `parameters`：`width`、`height`、`steps`、`seed`；
- `source`（D05 镜头、用户 brief 或事实）和去重的 `provenance`（script/fact/source）。

两端都拒绝未知字段、控制字符、路径、网络 URL、命令、token、credential、secret 等泄漏。
Prompt 上限为 4096 个字符；图片尺寸为 64–1024 且最多 1,048,576 像素；steps 为 1–64；
provenance 最多 32 项；PNG 和结果 JSON 也有字节上限。请求、持久化 job input、manifest
和结果都不包含 `secret` 或 `credentialRef`。

## 离线 fake 与缓存

fake adapter 输出：

```text
<project-root>/generated/images-v1/<sha256-cache-key>.png
<project-root>/generated/images-v1/<sha256-cache-key>.json
```

PNG 的像素、尺寸和受控元数据由输入稳定计算，因此 source/provenance、模型参数和 adapter
选择可被结果与图片检查。cache key 的规范化输入绑定合同/adapter/job type、project、
provider、shot、完整 prompt、model、parameters、source 和 provenance。

PNG 与 manifest 均使用同目录临时文件、flush/fsync、`os.replace` 原子写入。cache-hit
必须重新验证项目、完整选择、manifest/schema/cacheKey、输出目录 boundary、regular-file、
PNG 尺寸、字节数和 SHA-256；任何篡改都会被拒绝并重新生成。输出路径只能是固定的
`generated/images-v1/<64 hex>.png`，不能由调用方指定。

## A07 job 与 Core 边界

固定 RPC 方法为 `job.image.start` 与 `job.image.result`，job type 为 `image.generate`，
使用 A07 的 SQLite 持久状态、幂等冲突、checkpoint、取消、有限重试和 reopen recovery。
checkpoint 只保存 executor/checkpoint version、cacheKey 与有限进度，不保存 prompt、输出
全文、凭据或路径。SQLite 仍是 job/status/event/result 的唯一事实来源。

`image.generate` 至少经过 `prepared` checkpoint 后再生成。重启会验证 checkpoint 与当前
输入计算出的 cacheKey；无效 checkpoint 不猜测恢复。`fake-retry-once` 仅是测试用模型，
用于验证一次失败后重试成功；它不是外部服务。

## D01 Provider capability

Main 的 `resolveImage` 只接受 `image` service 且必须声明 `image.generate` capability；未配置、
未知 provider 或错误 capability 稳定失败。它把非敏感 model 解析后才向 Worker/Core 发送
`ImageJobStartParams`。Worker/Core 不接收 credential metadata。`generateImage` 是未来真实
实现的 Main-only callback seam，默认 fake 仍由 Core 离线执行。

本工作包不实现 D07 Timeline 组装、不实现 D08 fallback、不进行真实网络调用、不配置真实
API Key。D06 结果只提供固定的图片资源与来源/参数元数据，后续 Timeline 组装由 D07 负责。

## 验证

```powershell
npm run typecheck
npm run image:smoke
```

`image:smoke` 会先构建 workspace，再运行 Python D06 cache/job 测试和 TypeScript/Main
contract/provider boundary 测试。fixture 为
`tests/fixtures/d06_image_generation_v1.json`。所有测试使用假数据和假凭据，不联网，不
写入 tracked 项目、真实素材或用户路径。
