# Python Core JSON-RPC 边界

## 边界与传输

A04 的正式链路是：

```text
Pi Tool（后续接入）
  -> Agent Worker / PythonCoreClient
  -> python -m supervideo_core.rpc
  -> Pydantic 校验 + 显式 registry
```

Renderer、preload 和 Electron Main 不直接启动或控制 Python。`PythonCoreClient`
只在 Agent Worker 进程中使用。Python Core 是受控子进程，不监听网络端口，stdin
和 stdout 使用 UTF-8 JSON Lines，每行一条紧凑 JSON，行尾为 `\n`；stdout 只写协议
消息，诊断信息写 stderr。Node 使用参数数组、`shell: false`，Windows 使用
`windowsHide: true`。请求不能携带可执行文件、命令行、模块名或额外启动参数。

stdio 的好处是边界简单、无端口暴露、进程退出天然可观察，并且可以在本地离线
测试完整的跨语言路径。每个请求、响应和通知仍按不可信输入处理，不能因为两个
进程由同一应用启动就省略运行时校验。

## 版本、大小与方法

JSON-RPC 字段固定为 `jsonrpc: "2.0"`，产品协议版本为
`CORE_RPC_PROTOCOL_VERSION = 1`。健康响应包含服务名、状态、协议版本、Core
版本和能力列表；不返回路径、环境变量、用户名、密钥或完整 Python 运行信息。

单行正文上限为 256 KiB（`CORE_RPC_MAX_LINE_BYTES`），TS/Python 两端相同；不支持
batch，数组会得到 `INVALID_REQUEST`。请求 ID 只允许 ASCII 字符串，长度最多 64，
方法和参数均为结构化 JSON。JSON 数字必须有限，未知字段和已知方法的类型转换
均拒绝，例如字符串 `"3"` 不会转换成整数。

当前白名单只有：

- `core.health`：参数必须是空对象，用于启动握手。
- `core.smoke.countdown`：严格校验 `steps`（3–8）和 `delayMs`（1–1000），
  发送严格递增的进度序号并返回完成步数。这是确定性的跨语言测试替身，不读写
  文件、不联网、不启动其他进程。
- `core.cancel`：通知参数只有目标 `requestId`，只取消匹配的活动倒计时。
- `core.progress`：Python Core 发出的进度通知，不是可调用方法。

Python registry 是显式字典，未知方法永远返回 `METHOD_NOT_FOUND`；禁止任意方法
转发、动态 import、Shell、网络、FFmpeg、SQLite 或剪映调用。新增方法必须在
Python registry、共享 TS 运行时校验和 golden fixtures 中逐项登记，并同步版本/文档。

## 消息与错误模型

请求形态如下：

```json
{"jsonrpc":"2.0","id":"rpc-1","method":"core.health","params":{}}
```

进度是无 `id` 的通知：

```json
{"jsonrpc":"2.0","method":"core.progress","params":{"requestId":"rpc-1","sequence":1,"progress":0.25,"message":"step-1"}}
```

错误响应保留 JSON-RPC 数字码，并在 `error.data.errorCode` 提供稳定标识，例如
`INVALID_PARAMS`。当前错误标识包括 `PARSE_ERROR`、`INVALID_REQUEST`、
`METHOD_NOT_FOUND`、`INVALID_PARAMS`、`INTERNAL_ERROR`、`MESSAGE_TOO_LARGE`、
`PROTOCOL_MISMATCH`、`DUPLICATE_REQUEST_ID`、`BUSY`、`REQUEST_CANCELLED`、
`REQUEST_TIMEOUT`、`TRANSPORT_CLOSED`、`PYTHON_NOT_FOUND` 和 `PROTOCOL_ERROR`。
公共消息只含稳定短消息；Python 异常类型、stack、stdin、绝对路径、环境变量和
参数全文不会进入响应。业务异常的 stack 只写 stderr，stderr 通过受长度限制的
内部诊断回调观察，不原样转发给 Renderer。

## 生命周期、超时与取消

1. `PythonCoreClient.start()` 解析仓库解释器，启动正式模块入口，然后以独立的
   握手超时调用 `core.health`。
2. 服务名、状态和产品协议版本不匹配时，客户端返回 `PROTOCOL_MISMATCH` 并
   关闭子进程；客户端不做无限自动重启。
3. 每个请求生成唯一 ID，放入有上限的 pending map。stdout 可以被任意 chunk
   拆分，也可以一次带多行或 CRLF；每行解析后先通过运行时校验，再按 ID 路由。
4. `core.progress` 必须指向活动请求，序号必须严格递增，进度在 0–1 之间；未知
   ID、迟到通知、倒序或重复进度会被忽略，不会完成其他请求。
5. 默认请求超时为 10 秒，调用方超时会被限制在 120 秒以内。超时先从 pending
   移除，再通过同一个 `core.cancel` 路径通知 Python，调用方得到 `REQUEST_TIMEOUT`。
   `AbortSignal` 使用同一路径并得到 `REQUEST_CANCELLED`。
6. Python 第一阶段最多同时执行一个长倒计时；第二个得到 `BUSY`，重复活动 ID
   得到 `DUPLICATE_REQUEST_ID`。取消未知或已完成 ID 不影响活动请求。
7. Python EOF 会取消活动模拟任务并在有限时间内退出。客户端进程异常退出、stdin
   写入失败或协议损坏时，所有 pending 请求都会稳定失败并清理 timer/listener。
8. `shutdown()` 幂等：关闭 stdin，等待有限时间，必要时 kill 子进程；不会留下
   Python Core 进程。请求状态不跨 Worker 重启保存。

## Python 环境

首次安装在仓库根目录执行：

```powershell
npm install
npm run core:setup
```

`core:setup` 只创建和使用仓库 `.venv`，并按
`services/core/requirements.lock` 安装 Pydantic 2.x，再以 editable 方式安装
Core 包；不会修改系统 Python。Windows 优先尝试 `py.exe -3.12`，如果本机没有
3.12 则选择可用的 Python 3 解释器，并在输出中保留明确结果。客户端和健康检查
优先使用 `.venv\Scripts\python.exe`；没有 `.venv` 时才使用平台开发回退（Windows
为 `py.exe -3`，其他平台为 `python3`），缺少依赖时应先运行 setup。

当前开发验证使用 Python 3.14.4、Pydantic 2.12.5。项目仍保持 Python `>=3.12`，
不会为了本机版本降低基线。

## 测试与 smoke

```powershell
npm run core:setup
npm run core:test
npm run core:rpc:smoke
npm test
```

Python 测试会读取 `contracts/core-rpc-fixtures.json`，验证 Pydantic 对有效/无效
样例的判断，并启动真实 `supervideo_core.rpc` 检查坏消息恢复、进度、取消和 BUSY。
TypeScript 测试读取同一组 fixtures，另用假的子进程覆盖 chunk/CRLF、迟到消息、
协议损坏和突然退出，再用真实 TS→Python 子进程覆盖握手、参数错误、未知方法、
成功进度、超时和关闭。

`npm run core:rpc:smoke` 启动正式模块入口，完成健康握手，执行成功倒计时并确认
至少两次进度，再执行超时/取消路径，最后优雅关闭。它不依赖网络、API Key 或
tracked 报告文件。

## 后续扩展与当前限制

A05 可以在此边界之上增加 SQLite 仓储方法；A07 可以把请求/进度/取消映射到持久化
job 状态机和 checkpoint。公共契约发生不兼容变化时必须升级协议版本，并提供
迁移/兼容说明。

A04 不包含 SQLite、媒体分析、FFmpeg、Whisper、Remotion、真实模型/TTS、网络下载、
正式 Pi tool 注册、任务恢复、应用重启恢复或打包 Python。原始 spike 保持独立，
正式模块不依赖 spike 路径或其运行时文件。
