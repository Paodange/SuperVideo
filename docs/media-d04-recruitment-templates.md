# D04 招聘信息模板 V1

D04 提供四个固定的招聘信息模板和一个确定性的 `offline-layout` render-plan
合同。它只生成可验证的布局 artifact，不生成 MP4，不加载 Remotion，不执行
命令，也不接受 Renderer 提供的 bundle、组件名、代码或路径。

## 固定模板 registry

| templateId | templateVersion | 受控范围 |
| --- | --- | --- |
| `recruitment-classic` | `recruitment-classic-v1` | 标题、岗位、薪资、地点、福利、CTA 的常规信息卡 |
| `recruitment-bold` | `recruitment-bold-v1` | 更大标题和薪资字号的信息卡 |
| `recruitment-split` | `recruitment-split-v1` | 分区式信息卡 |
| `recruitment-photo-pan` | `recruitment-photo-pan-v1` | 受控图片背景 + 固定慢速放大运镜 + 信息卡前景 |

只有上表中的 `templateId/templateVersion` 组合有效。输入没有坐标、颜色、字号、
组件路径、代码、命令或自定义组件字段，所有这些值来自 registry。四个模板都覆盖
标题、岗位、薪资、地点、福利和 CTA；`photo-pan` 额外固定一个 `image-pan` 组件。

## 版本化合同

实现位于：

- TypeScript: `packages/shared/src/recruitment-template-contract.ts`
- Python/Core: `services/core/src/supervideo_core/media/recruitment_template_models.py`

输入固定为：

```json
{
  "schemaVersion": 1,
  "contractVersion": "recruitment-template-v1",
  "runtimeMode": "offline-layout",
  "projectId": "<UUID>",
  "templateId": "<fixed allowlist>",
  "templateVersion": "<matching fixed version>",
  "timeline": "C01 TimelineProject V1",
  "content": {
    "title": "1-24 个可打印字符",
    "jobTitle": "1-32 个可打印字符",
    "salary": "1-24 个可打印字符",
    "location": "1-32 个可打印字符",
    "benefits": ["1-5 个，每项 1-20 个可打印字符"],
    "cta": "1-40 个可打印字符",
    "provenanceIds": ["已存在的 Timeline provenance ID"]
  },
  "media": {
    "imageSourceId": "仅 photo-pan 使用的已存在 image source ID",
    "provenanceIds": ["绑定在该 image source 上的 provenance ID"]
  }
}
```

`media` 只允许用于 `recruitment-photo-pan`，并且 `imageSourceId` 必须解析到
当前 Timeline 的 `mediaType: image` source；其 provenance 必须同时存在于该
source 的 `provenanceIds`。文本 provenance 也必须存在于同一份 Timeline。
Timeline 由 C01 的唯一 validator 校验，D04 不创建第二套 IR；画布必须为
`1080x1920@30`，时长为 `1000-60000ms`。所有 source/provenance URI 必须是
受控的 `supervideo://asset|generated|external/...` 引用。

输入、输出和潜在的跨进程载荷都拒绝额外 key、超限 JSON、控制字符、重复 ID，
以及包含 `secret`、`credential`、`token`、`command`、`executable` 或绝对路径
语义的字段。合同中没有 `credentialRef`、token、命令、绝对路径或外部 bundle。

## 抖音安全区与布局规则

固定画布为 `1080x1920`。安全区是：

- left: `96`
- right: `96`
- top: `192`
- bottom: `240`

因此任何组件 bounding box 必须满足 `96 <= x`、`192 <= y`、
`x + width <= 984`、`y + height <= 1680`。输入不能提供坐标绕过检查；输出计划
中的坐标也会按 registry 的固定坐标再次校验。

六个前景信息组件之间禁止正面积重叠。普通模板的 overlap rule 是
`no-overlap`。`photo-pan` 的背景图片固定为安全区全框，并显式声明唯一例外
`background-image-pan-may-overlap-foreground`；只有该背景组件可以和前景重叠。
字号、颜色、行数同样来自固定 registry，超大文本在输入阶段拒绝。

## D03 seam 与后续边界

D03 当前是 `offline-contract` 的 fixed Remotion seam，仓库没有真实 Remotion
依赖。D04 使用不同且诚实的 `runtimeMode: offline-layout`，产物是结构化布局
计划，不是视频、Player 或可执行 bundle。后续若接入 D03，必须继续复用固定的
IPC/Worker/Core allowlist、A07 SQLite job source of truth、project isolation 和
idempotency/recovery；D04 本身不复制 JobManager，也不增加新的 job/RPC。

本包明确不实现：

- D05 脚本、分镜和内容规划；
- D06 图片 Provider、联网检索、下载或授权判断；
- D07 Timeline 组装、真实 Remotion/FFmpeg 渲染和导出；
- E/F 的剪映、批量生成和其他产品能力。

D07 可以把 D04 render-plan 作为受控输入消费，再负责将已验证内容组装到已有
Timeline/渲染链路；本包不会声称已经完成这些工作。

## 验证

Node 合同测试为 `tests/recruitment-template-contract.test.mjs`，Python/Core
测试为 `services/core/tests/test_recruitment_templates.py`。离线 smoke 可通过：

```powershell
node scripts/recruitment-template-smoke.mjs
```

smoke 只打印项目相对安全区、模板版本、组件计数和 runtime mode，不打印原始路径、
凭据或完整用户文本。
