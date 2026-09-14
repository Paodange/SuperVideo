# SuperVideo 第一阶段技术方案

> 状态：需求已确认，关键架构验证已通过，可进入工程实施。
>
> 更新日期：2026-09-15

## 1. 产品目标

SuperVideo 是一个面向个人创作者的本地视频创作智能体。第一阶段优先服务抖音上的“个人 IP 知识口播”，首个业务场景是招聘主题：主播从事人力资源服务，视频主要面向求职者，尤其是工厂、流水线和操作类岗位人群，引导观众在后台联系主播。

产品交互以自然语言为主。用户创建项目，将素材放入项目文件夹，或直接告诉智能体素材所在路径，然后描述想法、文案、目标时长和期望数量。智能体先一键生成可观看的完整初稿，用户再通过自然语言统一修改。最终交付物是：

1. 可直接发布的竖屏 MP4 成片；
2. Windows 剪映专业版 10.7.0 可继续人工调整的剪映草稿。

## 2. 第一阶段范围

### 2.1 支持的创作方式

#### A. 语义混剪

- 从多段不同内容的普通话、单人主讲口播素材中挑选完整句子，重新组织成一个主题视频；
- 可跨文件、跨拍摄批次使用素材；
- 根据用户提供的文案或大纲，在素材中检索语义对应的句子并组装；
- AI 可以改写文案、调整句序、增加过渡；
- 素材缺口可以使用独立 AI 音色、文字画面、程序化动画、图库素材或 AI 生成画面补齐；
- 完整句子不能被截断，这是硬约束；
- 目标时长由用户指定，允许上下浮动 20%。偏差过大时优先更换、增删完整句子，而不是在句中裁切。

#### B. 从想法生成完整视频

- 支持完全没有真人口播素材的作品；
- AI 根据用户想法生成或改写脚本，使用独立 AI 音色配音；
- 画面混合使用文字与程序化动画、用户素材、可商用网络素材、AI 图片，必要时使用 AI 视频；
- AI 视频失败、成本过高或一致性不足时，自动回退到图片运镜或程序化动画；
- 第一阶段不做主播音色克隆，接口预留到后续阶段。

### 2.2 招聘 Excel 批量生成

- 支持固定格式 `.xlsx` 模板；
- 只有当用户在提示词中明确要求“根据这个 Excel 的哪些内容创建什么视频”时，智能体才读取并使用表格；
- Excel 不是每个项目的必填项，也不强制用户先选择岗位；
- 用户可指定生成数量或行范围；
- 第一轮批量生成预览视频，用户选中满意项后再生成正式成片和剪映草稿；
- 行级失败可以单独重试，不影响其他行。

建议模板字段：`job_id`、`岗位名称`、`企业/行业`、`工作地点`、`薪资范围`、`年龄要求`、`学历要求`、`经验要求`、`班次`、`食宿`、`福利`、`工作内容`、`任职要求`、`招聘人数`、`报名方式`、`补充卖点`。字段映射放在配置中，不写死在生成逻辑里。

### 2.3 历史风格学习

- 用户提供本地历史成片文件夹；
- 系统分析主播常用语气、开头钩子、脚本结构、视频时长、字幕样式、画面节奏和视觉风格；
- 生成可查看、可修改的“创作者风格档案”；
- 新视频默认继承该档案，也允许用户在某次任务中覆盖；
- 第一阶段不从抖音主页自动抓取历史视频。

### 2.4 主动联网研究与素材获取

- 智能体可以围绕选题、招聘岗位和受众主动联网研究；
- 可以搜索并下载标记为可商用的图片、视频和音乐；
- 每项网络素材保存来源 URL、作者或平台、下载时间、许可说明和本地文件指纹；
- “可商用”不能只由模型主观判断；没有明确授权信息的素材默认不进入最终成片；
- 用户自行负责第三方账号和服务配置，系统在导出前展示素材来源清单。

### 2.5 明确不做

- 多人访谈、对话剪辑、说话人分离；
- 主播音色克隆；
- 从抖音主页自动获取视频；
- 自动发布到抖音；
- 应用内专业时间线编辑器；
- 读取用户在剪映中手动修改后的草稿并继续编辑；
- 跨设备项目迁移；
- 全版本剪映兼容；第一阶段仅支持当前电脑的 Windows 剪映专业版 10.7.0；
- 对模型调用、生成服务和素材下载做预算上限管理。

## 3. 总体架构决策

采用“Electron 产品壳 + TypeScript Agent Worker + Python 媒体内核 + Remotion/FFmpeg 渲染 + 剪映 UI 自动化”的混合架构。

```mermaid
flowchart LR
    UI[Electron + React 项目/对话界面]
    MAIN[Electron Main 安全边界]
    AGENT[TypeScript Agent Worker<br/>Pi agent-core + pi-ai]
    CORE[Python Core<br/>分析/检索/编排/任务调度]
    DB[(SQLite)]
    MEDIA[FFmpeg / faster-whisper<br/>PySceneDetect / Embedding]
    REM[Remotion 模板与渲染]
    WEB[联网研究与素材服务]
    JY[剪映 10.7 UI 自动化适配器]

    UI <-->|受限 IPC| MAIN
    MAIN <-->|消息端口| AGENT
    AGENT <-->|版本化 JSON-RPC| CORE
    CORE <--> DB
    CORE --> MEDIA
    CORE --> REM
    CORE --> WEB
    CORE --> JY
```

核心原则：

- Agent 负责理解意图、规划和选择工具，不直接修改数据库、执行任意命令或操作文件系统；
- Python Core 负责所有确定性业务规则、长任务、持久化和副作用；
- 中间视频描述 `Timeline IR` 是唯一事实来源，成片渲染器和剪映导出器都消费同一份 IR；
- 原始素材默认只读引用，任何裁切、转码和生成结果写入项目工作目录；
- 长任务不依赖 Agent 进程存活，应用重启后可从 SQLite 恢复。

## 4. 为什么只使用 Pi 的核心包

采用用户提出的 Pi，但只引入：

- `@earendil-works/pi-ai`：统一模型供应商、流式响应和 OpenAI 兼容服务；
- `@earendil-works/pi-agent-core`：工具循环、事件流、取消和多轮状态。

不引入 Pi 的 coding agent、终端 UI 和通用编码工具。原因是视频产品需要自己的权限边界、项目模型、媒体任务状态和 UI；把通用编码智能体整体嵌入会扩大权限面并增加不必要耦合。

Pi 不是工作流引擎。转写、渲染、下载和剪映操作由自研任务调度器持久化；Agent 只创建任务、查询任务、取消任务、读取结果。这样即使模型请求或 Agent Worker 崩溃，媒体任务仍可恢复。

## 5. 进程与安全边界

### 5.1 Electron Renderer

- React + TypeScript；
- 只负责项目页、对话、任务进度、脚本预览、素材溯源、版本选择和系统设置；
- 开启 `contextIsolation` 和 sandbox；
- 不暴露 Node.js、文件系统或任意 IPC；
- preload 只暴露按业务命名的最小 API。

### 5.2 Electron Main

- 管理窗口、文件选择器、系统托盘和应用生命周期；
- 使用 `utilityProcess.fork()` 启动 Agent Worker；
- 验证所有 Renderer 请求；
- 不承载 LLM 循环和媒体计算，避免阻塞界面。

### 5.3 Agent Worker

- 运行 Pi；
- 维护当前对话上下文和工具事件流；
- 将工具调用转换为白名单 JSON-RPC 请求；
- API Key 不写入对话、Prompt、项目文件或日志；
- Electron utility process 的入口使用薄 CommonJS 启动文件，再动态导入 ESM Agent 模块。此约束来自本项目实际验证。

### 5.4 Python Core

- 建议 Python 3.12，与 `SuperAgent` 已验证环境保持一致；
- 提供本地 RPC 服务、SQLite 仓储、任务调度器、媒体分析和导出适配器；
- RPC 方法逐项注册并用 JSON Schema/Pydantic 校验；
- 禁止 Agent 传入任意可执行命令；FFmpeg 参数由 Core 根据结构化请求生成。

### 5.5 密钥

- 用户自行配置模型、TTS、图片和视频生成服务的 API Key；
- Windows 端使用 Electron `safeStorage`/DPAPI 加密保存密钥；
- 项目数据库只存 `credential_ref`，不存明文；
- 日志统一做 Header、Query 参数、Prompt 中疑似密钥脱敏。

## 6. 项目和存储模型

### 6.1 推荐目录

```text
项目目录/
├─ project.supervideo.json       # 可读项目元数据，不含密钥
├─ data/project.db               # SQLite
├─ cache/                        # 波形、代理文件、缩略图、转写缓存
├─ generated/                    # TTS、AI 图片、动画、网络素材副本
├─ previews/                     # 初稿和版本预览
├─ exports/videos/               # 最终 MP4
├─ exports/jianying/             # 导出过程记录、字幕和素材清单
└─ logs/                         # 脱敏日志
```

外部原始素材只记录绝对路径、文件大小、修改时间和内容指纹，不复制进项目。首次扫描后若文件发生变化或丢失，任务进入 `needs_attention`，不静默替换。

### 6.2 主要数据表

- `projects`：项目配置、目标平台、默认风格；
- `assets`：素材路径、类型、指纹、来源、许可；
- `media_analyses`：技术参数、镜头、转写、质量指标；
- `utterances`：完整句子、字词级时间戳、向量、主题和质量；
- `creator_profiles`：历史风格档案及版本；
- `conversations/messages`：对话与工具事件；
- `plans`：脚本计划和选择理由；
- `timeline_versions`：不可变 Timeline IR 版本；
- `jobs/job_events`：长任务、进度、重试和取消；
- `generations`：模型请求、模型名、参数、结果和费用元数据；
- `exports`：成片和剪映草稿导出结果；
- `source_records`：网络研究和素材许可溯源。

## 7. Timeline IR

Timeline IR 必须比 `SuperAgent` 当前的简单 video/audio/subtitle/image 模型更丰富，但保持渲染器无关。

```ts
interface TimelineProject {
  schemaVersion: 1;
  id: string;
  canvas: { width: 1080; height: 1920; fps: 30 };
  durationMs: number;
  tracks: TimelineTrack[];
  sources: SourceRef[];
  provenance: ProvenanceRef[];
}

interface TimelineClip {
  id: string;
  trackId: string;
  kind: "video" | "audio" | "image" | "text" | "subtitle" | "template";
  sourceId?: string;
  timelineStartMs: number;
  durationMs: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  transform?: Transform;
  volume?: number;
  transitionIn?: Transition;
  transitionOut?: Transition;
  sentenceId?: string;
  editableInJianying: boolean;
  metadata?: Record<string, unknown>;
}
```

每次自然语言修改都从上一版本产生新的不可变 IR，保存修改意图和差异。撤销就是切换活动版本，不覆盖旧版本。

## 8. 素材分析与完整句约束

### 8.1 分析流水线

1. `ffprobe` 获取分辨率、帧率、音轨、时长和编码；
2. 创建低码率代理、缩略图和音频代理；
3. 本地 `faster-whisper` 完成普通话转写和字词级时间戳；
4. 根据标点、停顿、语义完整性和最大时长生成候选句；
5. VAD 修正句首句尾，保留可配置的呼吸边界；
6. 计算清晰度、响度、静音、重复、抖动和画面质量；
7. 生成句级向量和主题标签，写入检索库。

### 8.2 句子边界规则

- 默认裁切点是完整句边界；
- 候选入点向前保留约 80–180ms，出点向后保留约 120–250ms，实际值受 VAD 和相邻语音约束；
- 句尾若只有停顿但语义未完成，不视为完整句；
- ASR 置信度低、句界不确定或音画不同步时标记为 `needs_review`；
- 输出前执行二次 ASR 对齐检查，发现句首/句尾缺字则更换候选或扩大边界；
- 时长优化只能以完整句为最小操作单元。

## 9. 两条生成流水线

### 9.1 语义混剪

```mermaid
flowchart TD
    A[用户主题/大纲/文案/时长] --> B[生成叙事计划与必要信息槽位]
    B --> C[混合检索：关键词 + 向量 + 元数据]
    C --> D[按完整句、内容质量、画面质量重排]
    D --> E[选择句子并处理跨片衔接]
    E --> F{存在素材缺口?}
    F -- 否 --> H[生成 Timeline IR]
    F -- 是 --> G[改写 / AI 配音 / 文字动画 / 补充画面]
    G --> H
    H --> I[时长与完整句校验]
    I --> J[预览成片]
```

检索评分建议由以下信号组成：语义相关度、关键词覆盖、角色/岗位字段一致性、句子独立完整度、口播质量、画面质量、与相邻句衔接度、重复惩罚和来源多样性。权重应可配置并保存到计划版本中。

当用户给出完整文案时，先将文案拆成“信息槽位”，逐槽检索素材，而不是要求原文逐字命中。允许对过渡语和缺失槽位做 AI 改写；关键事实（薪资、地点、年龄等）来自 Excel 或用户提供数据时不可擅自改动。

### 9.2 从想法生成视频

1. 研究主题、受众和事实边界；
2. 生成钩子、主体、行动号召组成的脚本；
3. 按镜头拆分脚本并决定视觉类型；
4. 生成 TTS；
5. 为每段选择用户素材、合规图库、AI 图片、AI 视频或 Remotion 模板；
6. 建立 Timeline IR 并渲染；
7. 自动检查字幕、音量、黑帧、静帧、时长和素材许可；
8. 输出预览，接受自然语言修改。

招聘视频的默认结构可以作为可选模板：痛点/机会钩子 → 岗位与地点 → 薪资福利 → 工作内容与门槛 → 适合人群 → 私信 CTA。它不能覆盖用户明确提示，也不能强制每次使用。

## 10. Remotion、FFmpeg 与 AI 视频的分工

### Remotion

适合确定性的程序化画面：标题卡、岗位信息卡、薪资数字动画、地图和地点、步骤说明、数据图表、字幕强调、图片运镜、品牌片头片尾。优点是可复现、可模板化、文字准确，适合招聘信息表达。

### FFmpeg

负责代理文件、裁切、转码、音频标准化、画面拼接、格式检查和部分高效滤镜处理。简单口播混剪无需全部经过浏览器渲染。

### 真正的 AI 视频

由生成模型产生新的像素和运动，适合真实感 B-roll 或难以拍摄的场景，但可控性、一致性、成本和等待时间更差。第一阶段把它作为某些镜头的可选素材来源，而不是整条视频的基础渲染器。

### 推荐策略

- 信息表达、字幕、品牌组件优先 Remotion；
- 真人口播裁切和基础媒体处理优先 FFmpeg；
- 氛围和场景补充优先合规图库或 AI 图片运镜；
- 只有视觉收益明显时才调用 AI 视频；
- Remotion 模板以版本号固定，构建后 bundle 复用；商用前单独核对其当前许可证条件。

## 11. 成片和剪映草稿

### 11.1 成片

- 由 Timeline IR 经 FFmpeg/Remotion 组合渲染；
- 默认 1080×1920、30fps、H.264 + AAC，参数可在导出预设中调整；
- 预览使用较低码率，用户确认后生成正式成片；
- 输出附带 `manifest.json`，记录 IR 版本、素材指纹、模型生成记录和来源。

### 11.2 剪映 10.7 草稿

复用 `C:\Project\SuperAgent` 已验证的 Windows UI 自动化方案，尤其是：

- 启动与版本检查；
- 显示缩放比例检查；
- 新建草稿、导入素材、导入字幕、排列时间线；
- 步骤检查点、失败截图和恢复；
- 导出后验证草稿可在剪映中打开。

剪映 10.7 草稿数据存在加密，第一阶段不直接修改其内部 JSON，也不承诺读取用户在剪映里的后续修改。

草稿可编辑性采用分层策略：

- 真人口播按完整句作为独立视频片段导入；
- AI 配音、音乐和音效作为独立音轨；
- 字幕作为字幕轨导入；
- 图片和普通 B-roll 尽量保持独立片段；
- 复杂 Remotion 动画以预渲染片段导入，因此在剪映内只能整体调整，不能拆到每个文字元素。

Timeline IR 是主版本。MP4 与剪映草稿应内容等价，但由于字体、特效和转场实现差异，允许少量视觉差异。输出前做片段数量、总时长、字幕条数和关键时间点对账。

## 12. Agent 工具设计

第一阶段建议暴露以下高层工具，避免一个万能工具：

- `project.create/open/inspect`；
- `asset.scan/analyze/get_status`；
- `history.learn_style/get_profile/update_profile`；
- `research.search/save_source`；
- `script.generate/rewrite/validate_facts`；
- `retrieval.search_utterances`；
- `plan.create_remix/create_generated_video`；
- `timeline.build/modify/validate/get_version`；
- `generation.create_tts/create_image/create_video`；
- `render.preview/final/get_status/cancel`；
- `jianying.export/get_status/cancel`；
- `excel.inspect/create_batch`；
- `batch.get_status/retry_item`。

每个有副作用的工具必须携带 `project_id`、`request_id` 和幂等键。工具只返回结构化摘要和资源 ID，大文本、转写和 IR 通过资源查询，避免把整个项目塞回模型上下文。

## 13. 长任务状态机

```text
queued → running → succeeded
              ↘ failed → retrying → running
              ↘ cancelling → cancelled
              ↘ needs_attention
```

- 每个任务按阶段保存 checkpoint；
- 进度事件写入 `job_events`，再推送给 Agent 和 UI；
- 取消信号从 UI → Electron Main → Agent Worker → Python Job 逐层传播；
- 外部生成服务若不能立即取消，任务进入 `cancelling`，忽略其迟到结果并记录费用；
- 剪映 UI 自动化按已完成步骤恢复，不能把鼠标位置当作任务状态；
- 应用启动时扫描 `running/cancelling` 任务，根据执行器策略恢复或转为 `needs_attention`。

## 14. 自然语言修改与版本

用户可以说：

- “开头直接说工资，把前 3 秒删掉”；
- “不要这个工厂镜头，换成宿舍和食堂”；
- “语气更像我以前的视频，结尾更直接”；
- “控制到一分钟左右，但不要截断句子”；
- “第 2、5、8 条不错，只给这三条生成剪映草稿”。

Agent 将修改解析为结构化 `EditIntent`，Core 在当前 IR 上生成新版本并返回差异摘要。事实字段、已锁定片段、品牌元素和用户明确保留的内容是编辑约束。用户可预览、接受、撤销或继续修改。

## 15. 隐私与网络边界

采用“选择性云处理”：

- 原始完整视频默认不上传；
- 转写、代理生成、镜头分析和检索优先本地完成；
- 调用云模型时优先发送文本、结构化元数据、必要关键帧或明确选中的短片段；
- 必须上传媒体的能力在任务开始前显示服务商、媒体范围和用途；
- 网络下载和 AI 生成结果保存在项目目录，并保留来源；
- 日志不记录原始 API Key，也不默认记录完整媒体内容；
- 删除项目时只删除项目内生成物和缓存，不删除外部原始素材。

## 16. 已完成的架构验证

验证代码位于 `spikes/pi-electron-bridge`，执行命令为 `npm run validate`。

验证环境：Electron 44.3.0、内置 Node 24.20.0、Chrome 152.0.7977.78、`@earendil-works/pi-agent-core` 0.85.1、`@earendil-works/pi-ai` 0.85.1。

| 检查项 | 结果 | 证据 |
|---|---|---|
| Electron `utilityProcess` 启动 Agent Worker | 通过 | 两次工作进程均成功启动和退出 |
| Pi Agent 事件生命周期 | 通过 | 收到 agent、turn、message、tool 的开始/更新/结束事件 |
| TypeScript → Python JSON Lines RPC | 通过 | Python 连续返回 4 次进度，最终成功结果进入 Pi tool result |
| OpenAI 兼容 Provider 配置 | 通过（仅注册） | 自定义 provider/model/base URL 可被 `pi-ai` 注册和解析 |
| 会话持久化和重启恢复 | 通过 | 首次保存 4 条消息，重启恢复 4 条 |
| 取消传播 | 通过 | 收到第 1 次 Python 进度后取消；Python 进程终止，Pi 得到 error tool result |

本次验证确认了架构主链路可行，但没有验证真实 LLM API、真实长时媒体任务、Remotion 渲染和剪映操作。假模型是刻意设计，用于让桥接验证稳定、可重复且不依赖 API Key。OpenAI 兼容服务目前只验证了注册和配置，接入首个真实服务时还需做流式文本、工具调用、错误和取消兼容测试。

完整机器可读报告见 `spikes/pi-electron-bridge/validation-report.json`。

## 17. 验收标准

### 17.1 语义混剪

- 能索引多文件、跨批次普通话单人口播；
- 生成结果没有肉眼或复听可确认的句中截断；
- 用户指定时长的结果在 ±20% 内；无法满足时明确说明并推荐替代素材；
- 每句话可追溯到源文件和时间码，AI 补齐内容有明确标记；
- 自然语言修改生成新版本，支持撤销；
- 输出 MP4 和剪映 10.7 草稿。

### 17.2 从想法生成

- 无真人口播素材时可以独立完成脚本、AI 配音和完整画面；
- 网络素材均有来源与许可记录；
- AI 生成失败有可用回退，不导致整条任务丢失；
- 字幕与配音对齐，无明显黑帧、静音或素材丢失；
- 输出 MP4 和剪映 10.7 草稿。

### 17.3 批量 Excel

- 仅在用户明确要求时读取；
- 用户可指定数量和行范围；
- 每条状态、预览和失败原因独立；
- 可只为选中结果生成剪映草稿。

## 18. 实施阶段

### M0：工程骨架与契约（约 1–2 周）

- Electron/React、Agent Worker、Python Core、SQLite；
- 项目创建和路径引用；
- RPC 协议、任务状态机、日志和密钥存储；
- 将本次 spike 转为自动化集成测试。

### M1：可用的口播混剪闭环（约 3–5 周）

- 素材扫描、代理、转写、句子切分和检索；
- 主题混剪与文案对齐；
- 基础 Timeline IR、字幕、预览和最终 MP4；
- 自然语言修改和版本回退。

### M2：生成式画面与风格（约 3–5 周）

- TTS、Remotion 模板、AI 图片和网络素材；
- 从想法生成完整视频；
- 历史成片风格档案；
- 来源和许可清单。

### M3：剪映和批量（约 3–5 周）

- 将 `SuperAgent` 的剪映 10.7 自动化迁移为适配器；
- 从 Timeline IR 导出多轨草稿并验证；
- Excel 模板、批量任务、选择后导出草稿；
- Windows 安装包与回归测试。

估算以一名熟悉现有 `SuperAgent` 的全职开发者为基准，AI 视频供应商差异、剪映 UI 变化和字幕样式复杂度可能扩大工期。建议首先完成 M1 的垂直切片，再并行扩充生成能力和剪映轨道类型。

## 19. 主要风险与应对

| 风险 | 应对 |
|---|---|
| ASR 标点不可靠导致截句 | VAD + 语义句界 + 二次对齐校验 + 低置信度人工提示 |
| 剪映 UI 或布局变化 | 锁定 10.7.0、启动时验证版本/缩放、语义控件定位、截图与 checkpoint |
| 剪映草稿加密 | 不直接写内部 JSON，坚持 UI 自动化；IR 保持供应商无关 |
| Agent 误调用高风险工具 | 白名单、高层工具、Schema 校验、幂等键、权限提示和审计日志 |
| 网络素材版权不清 | 许可元数据为必填，无法确认则禁止进入最终成片 |
| AI 视频慢、贵、不稳定 | 镜头级可选调用，图片运镜/Remotion 自动回退 |
| 长任务因应用退出丢失 | Python 持久化任务与 checkpoint，Agent 不承载任务状态 |
| 成片与剪映草稿不一致 | 两者消费同一 IR，导出后做时长、片段和字幕对账 |

## 20. 下一步

按 M0 开始工程化。第一个开发切片应是：创建项目 → 引用一组本地口播 → 本地转写并展示完整句 → 用户输入主题和时长 → 生成可播放的混剪预览。这个切片成立后，再接入自然语言修改、生成式补画面和剪映草稿。

## 参考资料

- [Pi 仓库](https://github.com/earendil-works/pi)
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Remotion Player](https://www.remotion.dev/docs/player)
- [Remotion renderMedia](https://www.remotion.dev/docs/renderer/render-media)
- [Remotion 许可证](https://www.remotion.dev/docs/license)

