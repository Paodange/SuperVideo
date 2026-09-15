# A03 开发任务提示词：Pi Agent Worker 正式集成

以下内容可直接交给负责 A03 的开发智能体。

---

你正在开发 `C:\Project\SuperVideo` 项目的 A03 工作包。请先完整阅读：

1. 根目录 `AGENTS.md`；
2. `docs/development-workflow.md`；
3. `docs/phase-1-technical-design.md`，重点阅读第 3–5、12–13、16、18.1 和 18.2 节；
4. `docs/electron-security.md`；
5. 根目录 `README.md`；
6. A02 已建立的 Electron Main、preload、共享 IPC contract、安全策略和测试；
7. `spikes/pi-electron-bridge/README.md` 及其代码，理解已经验证的技术结论。

## Git 要求

- 确认工作区干净，从最新 `main` 创建分支 `feat/a03-agent-worker-integration`；
- 所有实现、测试和提交都在该分支完成；
- 不要合并 `main`，不要推送远程仓库；
- 不修改或重写 A01/A02 的提交历史；
- 完成后提交代码，并按 `docs/development-workflow.md` 提供交接信息。

## 任务目标

把已经通过 spike 验证的 Pi Agent Worker 链路整理成正式应用模块：Electron Main 使用 `utilityProcess` 启动独立 Worker，监控其状态并进行受控重启；Worker 内运行 Pi 的确定性 smoke agent；Agent 生命周期和工具进度通过版本化消息协议到达 Main，再经 A02 的受限 IPC/preload 显示在 Renderer 测试面板。

完成后，应能在桌面应用里看到 Agent Worker 状态，手动运行一个不需要 API Key 的 smoke task，观察开始、流式文本、工具进度、结束或取消事件。Worker 崩溃时 Main 能识别并按有上限的策略重启，不能形成无限 crash loop。

本任务不接入 Python Core。A04 才建立正式 Python JSON-RPC。

## 已验证结论

沿用 spike 已确认的以下结论：

- `@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai` 可以支撑状态化工具循环、事件流和取消；
- Electron `utilityProcess.fork()` 可以承载 Agent Worker；
- 当前 Electron 44.3.0 环境中，使用一个薄 `.cjs` 入口再加载正式 Worker 模块更可靠；
- 取消必须从调用端显式传播到 Pi `Agent.abort()` 及正在执行的工具；
- OpenAI-compatible provider 的真实网络兼容不在 A03 验证范围内；
- 长任务和对话的正式持久化不应使用 spike 中的 JSON 文件。

不要直接移动或复制整个 spike。应提取正式模块、协议和测试，并继续保留 spike 作为独立验证证据。

## 进程边界

```text
Renderer
  │ 仅能调用冻结、类型化的 preload API
  ▼
Electron Main
  │ 管理生命周期、校验消息、缓冲事件
  ▼
Electron utilityProcess
  │ Pi Agent + A03 内存 smoke tool
  ▼
无外部副作用
```

- Renderer 不得直接获得 MessagePort、utilityProcess、Pi、模型对象或任意 channel；
- Main 是 Renderer 与 Worker 之间唯一桥梁；
- Worker 可以使用 Node.js，但 A03 只允许注册明确的内存 smoke tool；
- Worker 不得访问用户文件、执行任意命令或连接真实模型服务；
- Worker 的 stdout/stderr 不能直接作为 Renderer 内容渲染。

## 必须实现

### 1. 正式 Worker 入口和依赖

- 在 `workers/agent` 中建立正式 utility process 入口、Pi runtime、消息协议适配和 smoke tool；
- 在 `workers/agent/package.json` 添加并锁定已经验证版本：
  - `@earendil-works/pi-agent-core` `0.85.1`；
  - `@earendil-works/pi-ai` `0.85.1`；
- 不引入 Pi 的 coding agent、TUI 或通用编码工具；
- production 构建必须包含 Worker 运行所需文件，不能依赖 TypeScript 源码或 spike 目录；
- 使用独立薄 `.cjs` bootstrap 时，明确解决开发/生产构建路径和 ESM/CommonJS 边界；
- Worker 启动后发送带协议版本、Worker 版本和能力列表的 `ready` 消息。

### 2. Worker 消息协议

在 `packages/shared` 中定义独立于 Renderer IPC 的 Agent Worker 协议。至少包含：

- `protocolVersion`；
- Main → Worker：`run-smoke-task`、`cancel-run`、`ping`、`shutdown`；
- Worker → Main：`ready`、`pong`、`run-event`、`run-finished`、`worker-error`；
- `runId`、事件序号 `sequence`、时间戳和必要的关联字段；
- Worker 状态和运行状态的联合类型；
- 结构化公开错误码。

要求：

- 每种消息都有运行时校验，不只依赖 TypeScript 类型；
- 未知版本、未知类型、缺少字段、非法 runId 和不可序列化数据必须被拒绝；
- Main 和 Worker 都不得对未知消息执行默认动作；
- 消息大小设置合理上限，A03 事件中不传二进制、大段上下文或完整 Pi state；
- Pi 原始事件先转换为稳定的产品事件，不把库内部对象直接暴露给 Main/Renderer；
- 同一个 run 的 `sequence` 单调递增，便于后续持久化和 UI 去重。

### 3. Pi smoke agent

- 使用 `pi-ai` 的 faux provider，保证无网络、无 API Key、可重复；
- smoke run 至少产生：run started、流式 assistant text、tool started、2 次以上 tool progress、tool finished、run finished；
- smoke tool 只做内存倒计时或回显，不读写文件、不 spawn 子进程、不访问网络；
- 工具参数使用明确 Schema 校验；
- 同一 Worker 同一时间只允许一个 active run；并发启动返回稳定的 `busy` 错误；
- `cancel-run` 只取消匹配的 active run；错误 runId 不影响当前任务；
- 取消后必须产生终态，释放 active run，随后可以再次运行；
- Agent 异常必须转换为稳定产品错误，不能把堆栈、Prompt 或内部路径发送给 Renderer。

### 4. Electron Main 生命周期管理

为 Agent Worker 建立单一 owner/controller，至少支持：

- `start()`、`getStatus()`、`runSmokeTask()`、`cancelRun()`、`shutdown()`；
- 应用 ready 后启动一个 Worker；窗口重新创建时不得重复启动；
- 等待 `ready` 的启动超时；
- 处理 spawn、message、error、exit；
- app 正常退出时先请求 graceful shutdown，超时后才终止进程；
- Worker 意外退出后进行有限重启，例如指数退避且设最大次数/时间窗口；
- 达到上限后进入 `unavailable`，不无限重启，也不让 Electron Main 崩溃；
- 用户主动 shutdown 或应用退出不能触发自动重启；
- 重启后旧 Worker 的迟到消息必须被忽略；
- controller 可注入 utility process factory 和时钟，便于不启动 GUI 的行为测试。

A03 不实现跨应用重启的持久化。Worker 重启后的 run 可以标为 `interrupted`；SQLite 和持久任务恢复属于后续工作包。

### 5. Main 到 Renderer 的安全桥接

扩展 A02 的共享 desktop IPC contract 和 preload API，提供最小能力：

- 查询 Worker 当前状态；
- 启动 smoke run；
- 取消当前 smoke run；
- 订阅产品化 Agent 事件；
- 取消订阅。

安全要求：

- 沿用 A02 的可信 sender 校验、版本化 channel、payload 校验和公开错误；
- preload 不暴露通用 `invoke/send/on` 或任意 channel；
- 订阅 API 只接收产品化事件，注册时返回明确的 unsubscribe 函数；
- Renderer 卸载组件后必须移除 listener，避免重复订阅和内存泄漏；
- 对事件 payload 再做运行时校验，非法 Worker 消息不能进入 Renderer；
- 新增 channel 仍采用明确 allowlist，不能把“Agent”变成通用命令执行入口。

### 6. Renderer 测试面板

在现有 A01/A02 状态页增加一个克制的 Agent Worker 状态区域，至少显示：

- Worker 状态：starting、ready、running、restarting、unavailable 等；
- 当前 runId 和运行状态；
- 流式文本；
- tool started/progress/finished；
- completed/cancelled/error 终态；
- “运行 smoke task”和“取消”操作；
- Worker 不可用或 busy 时的可理解提示。

这只是工程测试面板，不设计正式 ChatGPT 式项目/对话 UI，不引入路由、状态管理框架或视觉设计系统。

### 7. 诊断与文档

- 记录 Worker generation、PID（仅 Main 诊断）、启动耗时、重启次数、退出码和公开错误码；
- 不记录完整 Prompt、完整 Pi transcript、环境变量或潜在密钥；
- 更新 README，说明开发启动、Agent smoke 测试、退出和当前限制；
- 新增简短的 Agent Worker 架构说明，写明进程边界、消息协议、重启策略、取消语义和 A04 接入点；
- 明确 faux provider 只是确定性工程验证，不代表已接入真实 LLM。

## 测试要求

新增自动化测试，至少证明：

1. Worker 消息协议接受所有合法消息并拒绝未知版本、未知类型和畸形 payload；
2. Pi faux smoke run 产生有序完整事件，tool progress 不少于 2 次；
3. 同时启动第二个 run 返回 `busy`；
4. 正确 runId 可以取消，错误 runId 不会取消活动任务；
5. 取消后产生 cancelled/interrupted 终态，并可再次运行；
6. Worker ready 超时进入失败或重启状态；
7. 意外退出按退避策略重启，达到上限后进入 unavailable；
8. 主动 shutdown 不重启，迟到旧消息被忽略；
9. Renderer 只能收到通过校验的产品化事件；
10. preload 没有暴露通用 IPC/MessagePort；
11. 事件订阅可以取消，重复挂载不会累积 listener；
12. A02 的来源、导航、权限和 IPC sender 安全测试继续通过。

测试不能主要依赖正则扫描源码。controller、协议校验、事件映射和重启策略应提取为可注入依赖的模块，进行行为测试。

## Electron 集成 smoke

增加一个可从根目录运行、能自动退出的集成 smoke 命令，例如：

```powershell
npm run agent:smoke
```

该命令必须：

1. 使用当前项目构建产物启动 Electron；
2. 不依赖 BrowserWindow 人工点击；
3. 真实启动 `utilityProcess`；
4. 等待 ready；
5. 运行 faux smoke agent并验证完整事件；
6. 验证取消或至少在自动化测试中覆盖取消；
7. graceful shutdown 并以正确退出码结束；
8. 设整体超时，不能失败后一直挂起。

不要把 spike 的 `validation-report.json` 当作 A03 集成测试结果；正式 smoke 应有自己的测试入口，并默认不写入被 Git 跟踪的运行时报告。

## 验收命令

必须实际执行并记录：

```powershell
npm run typecheck
npm test
npm run health
npm run build
npm run agent:smoke
npm run dev
```

另外验证既有 spike：

```powershell
Set-Location .\spikes\pi-electron-bridge
npm run validate
```

运行既有 spike 后，不要提交仅包含时间戳、PID 或累计消息数变化的 `validation-report.json`。

## 验收标准

- Electron Main 可启动并管理正式 Agent Worker；
- Worker 内实际运行 Pi faux agent，而不是手写假的事件序列；
- Renderer 能看到 Worker 状态和完整 smoke run 事件；
- 取消能到达 Pi Agent 并产生稳定终态；
- Worker 崩溃不会拖垮 Main，且重启有上限；
- app 退出后不遗留 Worker/Electron 进程；
- Main/Worker/Renderer 三层只交换版本化、校验后的消息；
- A02 安全边界没有被通用 IPC 或 MessagePort 绕过；
- 所有新增测试及既有测试通过；
- root typecheck、test、health、build、agent smoke、dev 均可运行；
- 既有 spike 仍通过；
- 无真实 API 调用、密钥、用户数据、node_modules、dist、日志或运行时噪声进入提交。

## 禁止事项

- 不实现 Python JSON-RPC 或调用 Python，这属于 A04；
- 不实现 SQLite、会话持久化、项目数据或长任务恢复；
- 不接入真实 LLM、用户 API Key、TTS、Embedding 或生成服务；
- 不注册文件、Shell、网络下载或任意命令执行工具；
- 不引入 Pi coding agent、TUI 或与产品无关的工具；
- 不把 Pi 原始 state、原始 tool 对象或 provider 对象发送到 Renderer；
- 不弱化 A02 的 CSP、导航、权限、sender 和 payload 校验；
- 不开发正式聊天界面或视频功能；
- 不修改现有 spike 的设计目的和验证结果。

## 完成交接

提交后返回：

```text
任务：A03
分支：feat/a03-agent-worker-integration
提交：<commit hash>
变更：<Worker、协议、controller、IPC、测试面板和文档>
验证：<每条命令及实际结果>
限制：<未覆盖的真实模型、持久化或崩溃场景>
风险：<需要 Review 特别检查的并发、退出或安全问题>
```

不要自行合并 `main`，不要自行推送远程仓库。

---
