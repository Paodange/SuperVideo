# D05 脚本到分镜 V1

D05 的边界是：把已版本化的 C02 narrative plan（以及可选的 C03 duration
optimization result）转换成可供后续 D07 消费的脚本与镜头计划。D05 是本地、离线、
确定性的 Core service；它不调用 LLM、网络、Provider、凭据、命令或文件路径，也不
创建持久 Job。

## 合同

合同版本为 `script-storyboard-v1`，`schemaVersion` 固定为 `1`。输入必须包含：

- `projectId`、受限的 `brief`（中文主题、受众、目标）；
- 明确 `facts`，每个薪资、地点、福利、资格、岗位和工作内容事实都必须引用已声明的 `provenanceIds`，并标注 `verified`、`unverified` 或 `needs-user-confirmation`；
- `forbiddenInferences`，用于记录不得补充的承诺或推断；
- 目标平台固定为 `douyin`、画幅固定为 `9:16`，时长为 1–60 秒且容差固定为 ±20%；
- `sourcePlan` 为完整 C02 `narrative-remix-plan-v1`，可选 `durationPlan` 为完整 C03 `duration-optimization-v1`；
- `visualContext.hasUserMaterial`，只影响声明式优先级，不选择真实 Provider。

输入和输出均拒绝未知字段、绝对路径、网络下载地址、Provider、command、prompt、
token、credentialRef 和 secret。文本、数组、段数、镜头数和 JSON 字节数都有上限。

## 绑定与校验

Core 在构建结果前会检查：

1. C02 plan 的 digest 与 project/target duration 一致；
2. C03（若存在）的 `sourcePlanDigest` 与 C02 一致，且所选 segment 仍属于 C02、role/slot 一致；
3. 所有 matched 句子保留原始完整文本、sentence ID、source asset、cache key、preview URI 和 `endMs - startMs` 时长；gap 不会被静默改写；
4. 输出脚本始终按 `hook` → `body` → `cta` 排序，`script` 与 `shots` 一一绑定，selected duration 等于完整句时长之和；
5. 每个事实输出 `factAudit`，明确为 `bound`、`unbound` 或 `needs-user-confirmation`。未经验证的事实不会被标记为已验证，也不会被改写成承诺。

输出会为每个源 segment 增加确定性的 `c02:<digest-prefix>:<segmentId>` 或
`c03:<digest-prefix>:<segmentId>` provenance 记录。它们只是来源绑定，不代表 D05 已
下载或生成素材。

稳定 Core 错误为 `SCRIPT_STORYBOARD_INPUT_INVALID`、`SCRIPT_STORYBOARD_SOURCE_INVALID`、
`SCRIPT_STORYBOARD_DURATION_INVALID`、`SCRIPT_STORYBOARD_ROLE_INVALID`、
`SCRIPT_STORYBOARD_OUTPUT_INVALID` 和 `SCRIPT_STORYBOARD_CANCELLED`。

## 镜头优先级

`visualSourcePriority` 只能使用固定 allowlist：

`user-material`、`licensed-stock`、`ai-image`、`remotion-template`、`text-card`。

有真人素材且句子已匹配时，默认优先用户素材；没有真人素材时，D05 输出
`licensed-stock` → `ai-image` → `remotion-template` → `text-card`；source gap 时输出
`remotion-template` → `ai-image` → `text-card`。D05 只描述优先级和 fallback 原因，D06
负责 Provider，D07 负责 Timeline 装配，D08 负责 fallback 策略。

## 离线演示与验证

招聘主题 fixture 位于 `tests/fixtures/d05_script_storyboard_v1.mjs`，覆盖完整
hook/body/CTA、事实来源绑定、完整句时长、无真人素材视觉优先级以及非法 key、Provider、
路径和 secret 拒绝。

运行：

```powershell
npm run script-storyboard:smoke
```
