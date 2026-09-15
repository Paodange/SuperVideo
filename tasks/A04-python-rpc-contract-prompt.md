# A04 开发任务提示词：Python RPC 契约

以下内容可直接交给负责 A04 的开发智能体。

---

你正在开发 `C:\Project\SuperVideo` 项目的 A04 工作包。开始前请完整阅读：

1. 根目录 `AGENTS.md`；
2. `docs/development-workflow.md`；
3. `docs/phase-1-technical-design.md`，重点阅读第 3、5.3、5.4、13、18.1、18.2 和 19 节；
4. `docs/agent-worker.md`；
5. 根目录 `README.md`；
6. A03 已实现的 Agent Worker、版本化消息协议、取消和测试代码；
7. `services/core` 当前 Python 包骨架；
8. `spikes/pi-electron-bridge/README.md`、`python/fake_tool_server.py` 和 TS 侧 Python 调用代码，只提取已验证结论，不把 spike 代码原样搬进正式模块。

## Git 要求

- 确认工作区干净，从最新 `main` 创建分支 `feat/a04-python-rpc-contract`；
- 所有实现、测试、文档和提交都在该分支完成；
- 不要合并 `main`，不要推送远程仓库；
- 不修改或重写 A01–A03 的提交历史；
- 完成后形成清晰提交，并按 `docs/development-workflow.md` 提供交接信息。

## 任务目标

建立 Agent Worker 与 Python Core 之间可长期演进的正式 RPC 边界：

- Python Core 作为受控子进程运行，通过 stdin/stdout 上的 UTF-8 JSON Lines 通信；
- 每行承载一条符合 JSON-RPC 2.0 的请求、响应或通知；
- RPC 契约有明确版本、白名单方法、Pydantic 运行时校验、稳定错误码、消息大小限制和请求超时；
- TypeScript 侧提供可复用的 `PythonCoreClient`，负责进程生命周期、请求关联、逐行解析、进度通知、取消、超时和退出清理；
- 使用真实 TypeScript → Python 子进程集成测试证明健康检查、流式进度、成功、校验失败、未知方法、超时和取消行为正确；
- 为 A05 SQLite、A07 持久化任务状态机和后续媒体工具留下稳定扩展点。

本任务的重点是 RPC 契约和可靠传输，不是业务功能。完成后应能从根目录运行一条 smoke 命令，启动真实 Python Core，调用受控模拟方法，看到多次进度并正常结束或取消。

## 架构边界

正式链路为：

```text
Pi Tool（后续接入）
  -> Agent Worker 内的 PythonCoreClient
  -> 受控 Python 子进程
  -> Pydantic 校验 + 固定方法注册表
  -> 结构化进度 / 结果 / 错误
```

A04 只需要把 `PythonCoreClient` 做成 Agent Worker 可复用模块并完成真实跨语言验证，不要求把 Python 方法注册成正式 Pi 工具，也不新增 Renderer IPC 或产品 UI。不得让 Renderer 或 Electron preload 直接启动、访问或控制 Python。

## 已确定的传输方案

### 1. 传输

- 使用本地子进程 stdio，不监听 TCP/HTTP 端口；
- stdin 和 stdout 使用 UTF-8，一行一条紧凑 JSON，行尾为 `\n`；
- stdout 只能输出协议消息，诊断信息只能写 stderr；
- Node 启动 Python 时必须使用 `spawn` 的参数数组和 `shell: false`，Windows 下使用 `windowsHide: true`；
- 不允许把字符串拼接成 Shell 命令，不允许 RPC 请求传入可执行文件、命令行或任意模块名；
- 正式代码不能依赖 spike 路径或 spike 的运行时文件。

### 2. 协议版本

- JSON-RPC 字段固定为 `"jsonrpc": "2.0"`；
- 另设产品协议版本常量，例如 `CORE_RPC_PROTOCOL_VERSION = 1`，健康响应必须返回该版本；
- 请求 ID 第一阶段只允许字符串，格式和最大长度必须校验；
- 不支持 JSON-RPC batch；收到数组一律返回稳定的 `INVALID_REQUEST`；
- 所有入站、出站消息均为 JSON 值，禁止 `NaN`、`Infinity`、二进制对象和自定义原型；
- 单行最大建议为 256 KiB；TypeScript 和 Python 两端使用同一个限制并覆盖边界测试；
- 公共契约发生不兼容变化时必须升级协议版本，不能静默改变字段语义。

### 3. 基础消息形态

请求：

```json
{"jsonrpc":"2.0","id":"rpc-1","method":"core.health","params":{}}
```

成功响应：

```json
{"jsonrpc":"2.0","id":"rpc-1","result":{"service":"python-core","status":"ok","protocolVersion":1,"coreVersion":"0.1.0"}}
```

错误响应：

```json
{"jsonrpc":"2.0","id":"rpc-1","error":{"code":-32602,"message":"Invalid params","data":{"errorCode":"INVALID_PARAMS"}}}
```

进度通知：

```json
{"jsonrpc":"2.0","method":"core.progress","params":{"requestId":"rpc-1","sequence":1,"progress":0.25,"message":"step-1"}}
```

示例用于约束字段语义，具体类型名可按仓库风格调整，但不可删除版本、请求 ID、进度序号或稳定错误标识。

## 白名单方法

只注册以下最小方法：

### `core.health`

- 参数必须是空对象；
- 返回 `service`、`status`、`protocolVersion`、`coreVersion` 和能力列表；
- 用于进程启动握手及版本兼容检查；
- 不返回环境变量、系统路径、用户名、密钥或完整 Python 运行信息。

### `core.smoke.countdown`

- 仅作为确定性的跨语言长调用替身；
- 参数为结构化的 `steps` 与 `delayMs`，用 Pydantic 设置较小且明确的上下限；
- 至少发送两次严格递增的 `core.progress` 通知；
- 成功返回完成状态和实际步数；
- 必须能响应针对请求 ID 的取消；
- 不读写文件、不联网、不启动其他进程、不访问数据库。

### 取消控制

- 定义一个固定取消通知，例如 `core.cancel`，参数仅包含 `requestId`；
- Python 服务收到后只取消匹配的活动请求，未知或已经结束的请求不得影响其他调用；
- 被取消的原请求最终返回稳定的取消错误；
- TypeScript 的 `AbortSignal` 和请求超时都通过同一取消路径传播；
- 不需要在 A04 实现持久化取消状态、应用重启恢复或外部服务退款逻辑。

不得提供任意方法转发、动态 import、文件操作、Shell、FFmpeg、网络下载、SQLite 或剪映方法。新增方法必须逐项注册，不能用方法名前缀通配。

## Python Core 实现要求

在 `services/core/src/supervideo_core` 内建立清晰模块，建议拆分为：

```text
rpc/
  models.py       # Pydantic envelope、params、result、error、progress 模型
  errors.py       # 数字码、稳定 errorCode 与安全消息
  registry.py     # 显式方法注册表和分发
  server.py       # JSON Lines 读取、并发执行、取消和写出
  __main__.py     # python -m supervideo_core.rpc 启动入口
```

允许根据现有代码风格调整文件名，但职责不能混在单个巨型脚本中。

具体要求：

- 使用 Pydantic 2.x 对 envelope 和各方法参数/结果做严格校验；
- 模型默认拒绝未知字段，不做危险的宽松类型强转，例如字符串 `"3"` 不应自动当成整数；
- 分发器使用显式字典注册方法，未知方法返回 `METHOD_NOT_FOUND`；
- stdin 读取循环必须能在倒计时执行期间继续接收取消通知，可使用 asyncio 或受控线程，但 stdout 写入必须串行化，不能交错两条 JSON；
- 第一阶段可限制同时只有一个活动长调用；超出并发上限时返回稳定 `BUSY`，不能覆盖旧请求；
- 相同活动请求 ID 重复提交时应拒绝；完成后的 ID 不需要永久记忆；
- EOF 表示调用端关闭，服务应取消活动模拟任务并在有限时间内退出；
- 捕获业务异常并映射为安全公共错误，stack trace 只能进入 stderr，不能放入 RPC 响应；
- 对空行、无效 JSON、超大行、无效 envelope、未知方法和参数错误分别处理，单条坏消息不能导致整个服务崩溃；
- 保留现有 `python -m supervideo_core.health` 健康入口并保持向后兼容。

## Pydantic 与 Python 环境

- 项目基线为 Python 3.12 或更高版本，优先在 Windows `.venv` 中验证；
- 在 `pyproject.toml` 声明 Pydantic 2.x 依赖，并提供可复现的版本约束或锁定文件；
- 不依赖用户全局 site-packages；
- 增加明确的本地初始化命令，例如 `npm run core:setup`，只在仓库的 `.venv` 中安装，不修改系统 Python；
- 根脚本解析 Python 时优先使用仓库 `.venv\Scripts\python.exe`；开发回退策略要有清楚错误提示，不要静默调用来源不明的解释器；
- 路径包含空格时必须仍可工作；不得假定 POSIX 路径或 `/bin/sh` 存在；
- `.venv`、`__pycache__`、测试缓存和生成报告不得提交。

如果开发机没有 Python 3.12，但存在更高兼容版本，可以用于开发验证；交接中必须写明实际版本。不要为了通过测试降低 `requires-python`。

## TypeScript 客户端要求

在 `workers/agent` 中实现可独立测试、可被未来 Pi tool 复用的 `PythonCoreClient`，不要把 RPC 细节塞进 faux agent 或 Electron Main。

客户端至少提供：

```ts
start(): Promise<CoreHealth>
request<T>(method, params, options?): Promise<T>
shutdown(): Promise<void>
getStatus(): CoreClientStatus
```

可以再提供强类型的 `health()`、`runSmokeCountdown()` 等薄封装。具体要求：

- 每个请求生成唯一字符串 ID，维护 pending map；
- stdout 按 chunk 累积并正确拆分 `\r\n`/`\n`，不能假设一次 `data` 就是一整行；
- 所有 Python 消息先做运行时校验，再按 ID 路由；
- `core.progress` 必须校验目标请求、严格递增 sequence、0–1 progress 和字符串长度；
- 未知 ID、重复响应、迟到响应、倒序进度和无效消息不能错误完成其他请求；
- 每个请求有默认超时，也允许调用端传入受上限约束的超时；超时后移除 pending、发送取消并抛出稳定 `REQUEST_TIMEOUT`；
- 支持 `AbortSignal`；取消只影响目标请求，并返回稳定 `REQUEST_CANCELLED`；
- Python 异常退出、stdin 写入失败或协议损坏时，所有 pending 请求必须被稳定拒绝并清理 timer/listener；
- `shutdown()` 幂等，先关闭 stdin，等待有限时间后才强制结束子进程；
- stderr 可写入受长度限制的诊断回调，但不得原样转发给 Renderer，也不得包含请求参数全文；
- 默认并发上限要明确；不得产生无界 pending、stdout buffer 或 stderr buffer；
- 不通过 `shell: true`，不接受 Agent 提供 Python 可执行路径或额外启动参数。

## 契约归属与跨语言一致性

- 在 `packages/shared` 或独立 `contracts` 目录保存 TypeScript 侧 RPC 类型、版本、方法名、错误标识和运行时校验；
- Python 侧保留对应 Pydantic 模型；
- 增加一组提交到仓库的 JSON golden fixtures，覆盖每种 envelope 的有效和无效样例；
- 同一组 fixtures 必须同时由 TypeScript 校验器和 Python/Pydantic 测试读取；
- 测试应证明两端对关键样例作出相同接受/拒绝判断；
- 如果采用生成 JSON Schema 的方式，生成结果必须稳定、可检查，并提供“重新生成后无 diff”的校验；
- 不允许只靠 TypeScript 类型断言，也不允许 Python 一端校验而 TS 一端直接信任消息。

## 错误模型

保留 JSON-RPC 标准数字码，并在 `error.data.errorCode` 中提供产品稳定标识。至少覆盖：

- `PARSE_ERROR`；
- `INVALID_REQUEST`；
- `METHOD_NOT_FOUND`；
- `INVALID_PARAMS`；
- `INTERNAL_ERROR`；
- `MESSAGE_TOO_LARGE`；
- `PROTOCOL_MISMATCH`；
- `DUPLICATE_REQUEST_ID`；
- `BUSY`；
- `REQUEST_CANCELLED`；
- `REQUEST_TIMEOUT`（TS 客户端本地错误）；
- `TRANSPORT_CLOSED`；
- `PYTHON_NOT_FOUND` 或等价的稳定启动错误。

错误消息必须简短稳定。不得把 Python异常类型、stack、stdin 内容、绝对用户路径、环境变量或子进程启动参数放入公共错误。

## 启动握手与生命周期

- TS 客户端启动 Python 后，首先调用 `core.health`；
- 校验服务名、状态和协议版本，版本不匹配立即关闭进程并返回 `PROTOCOL_MISMATCH`；
- 启动和握手有独立超时，不能无限等待；
- Python 进程退出后，本客户端不做无限自动重启。A04 可选择“不自动重启”或一次受控重试，但必须记录并测试；
- 本任务不要求 Python Core 跨 Agent Worker 重启存活。A07 的持久化 job 才负责长任务恢复；
- Agent Worker 退出时要能调用客户端 `shutdown()`，但不要为了 A04 重写 A03 已稳定的 Worker 重启策略。

## Smoke 与开发命令

新增根目录命令，名称可微调但语义必须清楚：

```powershell
npm run core:setup
npm run core:test
npm run core:rpc:smoke
```

`core:rpc:smoke` 必须：

1. 启动正式 Python RPC 入口，而不是 fake server；
2. 完成握手；
3. 调用一次成功倒计时并收到至少两次进度；
4. 调用一次超时或显式取消场景，确认目标请求以正确错误结束；
5. 优雅关闭 Python；
6. 自动退出，成功为 0，失败为非 0；
7. 不写入 tracked report、会话或临时数据。

`npm run dev` 不要求默认启动 Python，以免 A04 扩大产品 UI 范围；如果选择启动，Python 不可用时必须以结构化状态降级，不能让 Electron 安全壳崩溃。

## 自动化测试要求

至少覆盖以下行为：

1. TypeScript 和 Python 对 golden fixtures 的有效/无效判断一致；
2. `core.health` 空参数成功，额外字段失败；
3. 未知方法返回 `METHOD_NOT_FOUND`；
4. 错误参数类型、越界参数和未知字段返回 `INVALID_PARAMS`；
5. 无效 JSON、错误 `jsonrpc` 版本、batch 和超大行得到稳定错误，服务仍能处理下一条有效请求；
6. 成功倒计时产生严格递增 sequence、至少两次进度和一个终态结果；
7. 同一时间的第二个长调用得到 `BUSY`，不影响第一个；
8. 匹配请求 ID 的取消生效，错误 ID 不影响活动请求；
9. TypeScript 超时后清理 timer/pending 并忽略迟到结果；
10. `AbortSignal` 取消只影响目标请求；
11. stdout 被任意 chunk 拆分、一次 chunk 含多行以及 CRLF 时均能正确解析；
12. Python 突然退出时全部 pending 稳定失败且无未处理 Promise；
13. 重复响应、未知响应 ID、倒序进度和 malformed 消息不会串单；
14. `shutdown()` 可重复调用，不遗留 Python 进程；
15. 现有 A01–A03 测试、Agent smoke 和 Electron 安全测试继续通过。

跨语言集成测试必须启动真实 `supervideo_core.rpc`，不能全部用 mock 替代。单元测试可以用假的子进程覆盖难触发的异常分支。

## 文档要求

新增 `docs/python-rpc.md`，至少说明：

- 进程边界与为什么选择 stdio JSON Lines；
- JSON-RPC 版本、消息大小、方法白名单和错误模型；
- Python 环境初始化和解释器选择规则；
- 请求、进度、取消、超时、退出的时序；
- 如何运行 smoke 和契约测试；
- 如何安全新增一个 RPC 方法；
- 当前不包含 SQLite、媒体能力、正式 Pi tool、任务恢复和打包 Python；
- A05/A07 将如何在该契约上继续扩展。

同步更新 README 的安装、命令、目录说明和已知限制。若改变现有健康检查行为，也要写兼容说明。

## 建议实施顺序

### 第 1 天：契约与 Python 服务

- 定义协议常量、方法名、错误模型和 golden fixtures；
- 建立严格 Pydantic 模型与白名单 registry；
- 实现 JSON Lines server、health、countdown、progress 和 cancel；
- 完成 Python 单元测试及坏消息恢复测试。

### 第 2 天：TypeScript 客户端

- 实现 Python 解释器解析和受控 spawn；
- 实现 framing、pending map、运行时校验、请求超时和 AbortSignal；
- 实现启动握手、退出清理、幂等 shutdown；
- 完成 TS 单元测试与跨语言 fixture 一致性测试。

### 第 3 天：真实集成与回归

- 完成真实 TS→Python smoke；
- 补齐成功、取消、超时、异常退出和 Windows 路径测试；
- 更新 README 与 `docs/python-rpc.md`；
- 运行全套验证，清理所有生成噪声，提交并交接。

## 验收命令

在仓库根目录至少运行并记录实际结果：

```powershell
npm run core:setup
npm run typecheck
npm test
npm run core:test
npm run health
npm run build
npm run core:rpc:smoke
npm run agent:smoke
```

并确认既有 spike 仍可独立运行：

```powershell
Set-Location .\spikes\pi-electron-bridge
npm run validate
```

运行 spike 后只恢复它生成的 runtime/session/report 噪声，不得覆盖用户或其他智能体的修改。

## 完成定义

- 正式 Python RPC server 可通过模块入口启动；
- Pydantic 严格校验和显式方法白名单生效；
- TypeScript 客户端能握手、关联请求、接收进度、超时、取消和清理退出；
- 真实跨语言 smoke 可重复通过且不依赖网络/API Key；
- 契约两端对 golden fixtures 判断一致；
- 错误结构稳定，不泄露内部异常、路径或环境；
- Windows PowerShell 和含空格路径得到验证；
- A03 Agent Worker 与 Electron 安全边界没有被弱化；
- README 和 RPC 文档完整；
- 没有 `.venv`、`__pycache__`、dist、日志、密钥、用户数据或临时报告进入提交。

## 禁止事项

- 不实现 SQLite 或 migration，这属于 A05；
- 不实现项目创建、素材目录或外部文件引用，这属于 A06；
- 不实现持久化 job、checkpoint、重启恢复和正式任务状态机，这属于 A07；
- 不实现 API Key 保存、真实模型、TTS、Embedding、FFmpeg、Whisper、Remotion 或剪映；
- 不新增 Renderer 页面、聊天 UI 或通用 Python 控制 IPC；
- 不开放网络端口，不使用任意命令执行，不允许动态 RPC 方法；
- 不把 stderr、stack、完整参数或绝对用户路径转发给 Renderer；
- 不让单个坏请求、超时或取消杀死 Electron Main 或 Agent Worker；
- 不直接修改 spike 来充当正式实现。

## 完成交接

提交后返回：

```text
任务：A04
分支：feat/a04-python-rpc-contract
提交：<commit hash>
变更：<协议、Pydantic 服务、TS 客户端、fixtures、smoke 和文档>
验证：<每条命令、实际 Python 版本及结果>
限制：<尚未包含的持久化、业务方法或打包能力>
风险：<需要 Review 特别检查的超时、取消、子进程退出或跨语言兼容问题>
```

不要自行合并 `main`，不要自行推送远程仓库。

---
