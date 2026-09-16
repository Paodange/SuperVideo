# A08 开发任务提示词：日志、诊断与密钥保险箱

以下内容可直接交给负责 A08 的开发智能体。

---

你正在开发 `C:\Project\SuperVideo` 项目的 A08 工作包。开始前请完整阅读：

1. 根目录 `AGENTS.md`；
2. `docs/development-workflow.md`；
3. `docs/phase-1-technical-design.md`，重点阅读第 3、5.2–5.5、6、12、13、18.1、18.2 和 19 节；
4. `docs/electron-security.md`；
5. `docs/agent-worker.md`；
6. `docs/python-rpc.md`；
7. `docs/storage.md`；
8. `docs/projects.md`；
9. `docs/jobs.md`；
10. 根目录 `README.md`；
11. A02 的受限 IPC、preload 和 BrowserWindow 安全边界；
12. A03/A04 的 Worker 生命周期、Core RPC、错误处理、超时和取消；
13. A06/A07 的项目会话、持久化 job、事件和现有 smoke 流程。

## Git 要求

- 确认工作区干净，从最新本地 `main` 创建分支 `feat/a08-logging-diagnostics-secrets`；
- 所有实现、测试、文档和提交都在该分支完成；
- 不要合并 `main`，不要推送远程仓库；
- 不修改或重写 A01–A07 的提交历史；
- 一个分支只完成 A08，不夹带媒体分析、Provider、UI 重构或其他工作；
- 完成后形成清晰的小提交，并按 `docs/development-workflow.md` 提供交接信息。

## A07 Review 结论与基线

A07 已通过轻量 Review，没有阻断项。以下能力是 A08 必须保持的回归基线：

- Worker 冷启动采用延迟加载，不能重新把 Python/Core 重模块放到 ready 之前；
- Worker 所有出站消息继续走统一结构与大小校验；
- job 状态、checkpoint 与事件以项目 SQLite 为唯一事实来源；
- 创建项目、引用素材、job 成功/失败/取消/重试/恢复的既有测试和 smoke 必须继续通过。

## 工期与任务目标

本工作包目标工期为 **2 个开发日**，完成三项可运行、可演示的基础能力：

1. **脱敏结构化日志**：Electron Main、Agent Worker、Python Core 的关键生命周期和任务事件可关联、可轮转落盘，日志不包含明文密钥、Prompt、请求体或用户绝对路径；
2. **本机凭据保险箱**：用户可保存、替换、查看“是否已配置”和删除服务凭据；Windows 正式路径必须使用 Electron `safeStorage`/DPAPI，磁盘上绝不出现明文；
3. **诊断信息导出**：用户主动选择目标位置后导出一个有界、可分享的脱敏 JSON 诊断文件，用于排查版本、进程、协议、项目 schema 和任务状态问题。

完成后应能演示：

1. 在桌面应用中新增一个测试凭据；
2. UI 只显示“已配置”和元数据，不能读回密钥；
3. 启动/取消 A07 模拟任务并看到带关联 ID 的本地结构化日志；
4. 导出诊断 JSON；
5. 用同一个测试哨兵扫描日志、诊断文件、项目 manifest/数据库，确认均无明文；
6. 删除凭据后状态立即更新；
7. 重启应用，凭据“已配置”状态和 A07 job 状态都正确。

## 明确边界

A08 只建立安全存储、日志和诊断基础设施：

- 不接入真实 LLM、TTS、图片、视频或素材网站 API；
- 不进行 Provider 网络连通性测试；Provider 接口和健康检查属于 D01；
- 不实现登录、云同步、团队共享或跨 Windows 用户迁移密钥；
- 不自动上传日志或诊断信息；
- 不自动读取浏览器、环境变量、系统凭据管理器或其他应用中的 Key；
- 不实现通用“查看/复制已保存密钥”；保存后密钥不可回显；
- 不引入遥测、崩溃上报或第三方日志 SaaS；
- 不实现 ZIP、多文件收集器或完整安装诊断向导；G08 会继续扩展；
- 不新增数据库 migration。项目数据库本阶段不保存凭据实体，只允许未来业务记录引用不透明 `credentialRef`；
- 不修改 Timeline IR，不实现 FFmpeg、Whisper、Remotion 或剪映能力。

如果 2 天范围出现冲突，优先级为：**无明文泄漏 > safeStorage 正确失败 > 可导出诊断 > UI 美化**。

## 安全原则

1. Electron Main 是凭据存储和诊断文件写入的唯一所有者。
2. Renderer 只能调用固定语义方法，不能访问 `safeStorage`、Node、文件系统或任意 IPC channel。
3. 密钥只在“保存”调用中从 Renderer 单向进入 Main；保存成功后立即清空输入，Main 永不把明文返回 Renderer。
4. 不允许在 `safeStorage` 不可用时退化为明文、Base64、自制加密、环境变量或项目配置保存。
5. 脱敏必须至少发生在日志落盘前；诊断导出时再做一次防御性脱敏。
6. 日志使用字段白名单。不能把 IPC/RPC request、response、异常对象、Prompt 或任意用户对象整体序列化后寄希望于正则兜底。
7. 密钥文件属于应用用户数据，不属于视频项目；项目移动或分享不能带走可解密凭据。
8. 诊断导出必须由用户显式点击触发，导出前不联网，导出后不自动打开网页或上传。
9. 所有新 payload、文件格式和错误码均需有版本、大小上限和运行时校验。
10. 测试只使用明显的虚假哨兵，不得使用真实 API Key、访问令牌、账号或隐私素材。

## 一、凭据模型与固定 IPC

### 1.1 凭据元数据

在 shared 层定义并运行时校验版本化契约。建议最小模型：

```ts
type CredentialServiceKind = "llm" | "tts" | "image" | "video";

type CredentialMetadata = Readonly<{
  credentialRef: string;      // Main 生成的不透明 ID
  serviceKind: CredentialServiceKind;
  providerId: string;         // 仅标识服务，不触发动态加载
  displayName: string;
  configured: true;
  createdAtMs: number;
  updatedAtMs: number;
}>;
```

要求：

- `credentialRef` 由 Main 使用可靠随机 ID 生成，Renderer 不能指定；
- `serviceKind` 第一阶段只允许上述四类；
- `providerId` 仅允许小写字母、数字、`.`、`_`、`-`，长度建议 1–64；
- `displayName` 去除首尾空白，长度建议 1–80，拒绝控制字符；
- 明文 secret 长度设合理上限，例如 1–8192 个 UTF-8 字节；
- 元数据中不包含 `last4`、前缀、长度、哈希或任何可辅助猜测密钥的值；
- 同一个 `credentialRef` 替换时保留 `createdAtMs` 并更新 `updatedAtMs`；
- 不把 `credentialRef` 当作密钥，它仍不能包含用户输入或 provider 名称。

### 1.2 preload 暴露的固定能力

可按现有命名风格实现以下固定语义能力：

- `credentials.status()`：返回 `safeStorage` 是否可用及稳定状态码；
- `credentials.list()`：只返回元数据；
- `credentials.save({ serviceKind, providerId, displayName, secret })`：新建；
- `credentials.replace({ credentialRef, secret })`：替换密文；
- `credentials.remove({ credentialRef })`：删除；
- `diagnostics.export()`：由 Main 打开保存对话框并返回 `saved/cancelled` 摘要。

约束：

- 不提供 `getSecret`、`decrypt`、`reveal`、任意路径读写或通用 `invoke(channel, payload)`；
- `contextBridge` 暴露对象保持冻结和窄接口；
- Main 对 sender frame、payload、长度、枚举和返回值再次验证；
- 非可信 frame 调用仍被 A02 安全层拒绝；
- 错误使用稳定公共错误码，不能把内部路径、异常消息或堆栈返回 Renderer；
- 对同一凭据的并发 save/replace/remove 必须串行化或用 compare-and-swap，结果确定；
- 删除不存在的引用可幂等成功，或返回稳定 `CREDENTIAL_NOT_FOUND`，选定一种并写入文档和测试。

建议错误码至少覆盖：

- `CREDENTIAL_STORAGE_UNAVAILABLE`；
- `CREDENTIAL_STORE_CORRUPT`；
- `CREDENTIAL_NOT_FOUND`；
- `INVALID_CREDENTIAL_INPUT`；
- `CREDENTIAL_WRITE_FAILED`；
- `DIAGNOSTIC_EXPORT_CANCELLED`；
- `DIAGNOSTIC_EXPORT_FAILED`。

## 二、Windows safeStorage 凭据保险箱

### 2.1 所有权与落盘格式

由 Electron Main 中的 `CredentialVault` 或等价服务管理。建议保存在：

```text
<Electron userData>/security/credentials.v1.json
```

文件格式必须带版本，并且只保存元数据与密文，例如：

```json
{
  "schemaVersion": 1,
  "credentials": [
    {
      "credentialRef": "opaque-id",
      "serviceKind": "llm",
      "providerId": "example-provider",
      "displayName": "默认文本模型",
      "encryptedValueBase64": "...",
      "createdAtMs": 0,
      "updatedAtMs": 0
    }
  ]
}
```

要求：

- Windows 正式实现使用 `safeStorage.encryptString()` 与 `safeStorage.decryptString()`；
- 保存前检查 `safeStorage.isEncryptionAvailable()`；不可用时返回稳定错误且不创建/改写文件；
- 禁止调用或依赖明文加密模式；禁止 Base64 冒充加密；
- Buffer 转 Base64 仅用于编码 safeStorage 产生的密文；
- 文件写入采用同目录临时文件、flush/close、原子替换；失败不得破坏旧文件；
- 尽可能限制当前 Windows 用户访问，不因权限设置失败而改用明文；
- 解析时严格校验 schema、条数、字段、重复 ID、文件大小和密文字节大小；
- 文件损坏或版本过新时只读失败并返回 `CREDENTIAL_STORE_CORRUPT`，不得静默清空、覆盖或“修复”；
- 单条密文解密失败时标记保险箱不可正常使用，不能把损坏项当作未配置；
- 不在项目 manifest、项目 SQLite、日志、诊断文件、session 或前端持久化中复制密文；
- 保险箱对象不得提供“导出全部解密值”的方法。

### 2.2 可测试性

将 Electron `safeStorage` 包装为极窄 adapter，并通过依赖注入测试：

- 单元测试可注入仅在测试进程中存在的 fake encryption adapter；
- fake adapter 不得通过 Renderer 参数、环境变量或生产配置启用；
- smoke 使用临时 `userData` 目录，不能写入开发者真实凭据文件；
- 测试完成后只清理测试创建的临时目录，不触碰用户项目或外部素材。

## 三、脱敏结构化日志

### 3.1 JSONL 事件格式

建立统一的、版本化的日志事件模型。每行一个 JSON 对象，至少包含：

```ts
type LogEvent = Readonly<{
  schemaVersion: 1;
  timestamp: string;           // UTC ISO-8601
  level: "debug" | "info" | "warn" | "error";
  component: "electron-main" | "agent-worker" | "python-core";
  event: string;               // 受限、稳定事件名
  sessionId: string;
  correlationId?: string;
  operationId?: string;
  runId?: string;
  requestId?: string;
  projectId?: string;
  jobId?: string;
  errorCode?: string;
  details?: Readonly<Record<string, string | number | boolean | null>>;
}>;
```

要求：

- Electron Main 每次启动生成新的 `sessionId`；
- 优先复用已有 `operationId`、`runId`、RPC `requestId`、`projectId` 和 `jobId`，不要另建互不关联的 ID 系统；
- `correlationId` 的选择规则固定并记录，例如 `jobId > operationId > requestId > runId > sessionId`；
- Worker 启停、Core 启停、项目 create/open、job start/progress/terminal/cancel/retry、凭据元数据操作和诊断导出应有日志；
- job progress 不要每个细粒度事件都刷盘，可按阶段变化或进度增量节流，但 terminal 事件不能丢；
- 事件名、level 和 detail key 尽量枚举/白名单，不接受 Renderer 传入任意事件名；
- `details` 只允许标量，且有字段数、key 长度和字符串长度上限；
- 日志写入不能阻塞 Renderer 或 Python 任务主循环；同一文件中的行必须完整、顺序确定。

### 3.2 禁止进入日志的内容

任何进程不得记录：

- API Key、Bearer token、Authorization、Cookie、Set-Cookie、密码、refresh/access token；
- safeStorage 明文、密文、Base64 密文、密钥长度或 hash；
- Prompt、聊天全文、模型输入输出、RPC/IPC 完整 params/result；
- job 的 `input_json`、`result_json`、checkpoint 或 event payload；
- 完整异常对象和未经处理的 stack；
- 环境变量、命令行全量、HTTP Header、URL Query；
- 项目名、素材文件名、用户目录或任何绝对路径；
- 诊断导出的目标绝对路径。

可以记录：稳定事件名、组件、版本、布尔状态、耗时、数量、状态枚举、错误码和不透明 ID。

### 3.3 防御性脱敏器

即使使用字段白名单，也实现共享测试语料驱动的防御性脱敏：

- key 名大小写无关匹配 `authorization`、`apiKey/api_key`、`token`、`secret`、`password`、`cookie`、`credential`、`ciphertext`、`prompt` 等敏感含义；
- URL 只保留协议、主机和路径模板，整个 query/fragment 移除；
- 字符串中明显的 Bearer、常见 Key 前缀、连接串密码和 Windows/POSIX 绝对路径替换为固定标记；
- 对 `Error` 只提取允许的 name、稳定 code 和脱敏后的短消息；生产落盘不保存原始 stack；
- 限制递归深度、对象 key 数、数组长度、单字符串长度和总序列化字节；
- 处理循环引用、BigInt、非有限数、不可序列化对象时不能抛出二次异常或写出原值；
- TypeScript 和 Python 使用同一组不含真实秘密的 golden fixtures，结果语义一致；
- 日志落盘前脱敏一次，诊断收集/导出时再脱敏并重新执行大小限制。

不要试图通过扫描所有内存证明秘密不存在；验收关注可观察输出和所有持久化边界。

### 3.4 文件位置、轮转与保留

- 启动期日志写入 Electron `userData` 下的应用日志目录；
- 打开项目后，可将同一套脱敏事件写入项目标准 `logs/` 目录，或采用文档化的单一应用日志策略；如果实现项目日志，绝不能记录项目根路径本身；
- 文件名不包含项目名、用户输入或密钥信息；
- 单文件建议上限 5 MiB，最多保留 3 个历史文件；数值可调整但必须有界并测试；
- 轮转使用原子、确定的文件名，不遍历或删除日志目录之外的路径；
- 写入失败返回/记录稳定错误状态，但不能造成 Worker/Core 崩溃或 job 状态丢失；
- 生产构建不得把敏感调试输出继续写入 `console.log/error`；测试输出同样不能打印哨兵秘密。

## 四、跨进程日志接入

### 4.1 Electron Main

- Main 持有最终日志 sink、轮转策略和 `sessionId`；
- 把现有 `AgentWorkerController` 的结构化 lifecycle callback 接入日志，而不是在各处自由拼接字符串；
- 对 Main 自身异常只记录稳定错误码和允许字段；
- Renderer 不能提交任意日志内容；如需要记录 UI 操作，只允许固定动作枚举。

### 4.2 Agent Worker

- Worker 使用固定、受限的 diagnostic event 出口；该消息继续经过 A07 的统一出站结构与消息大小校验；
- 不把 Pi 消息、tool arguments、tool results 或对话历史写入日志；
- 记录 Worker/Core 生命周期、RPC request ID 与现有 operation/job ID 的映射即可；
- Core stderr 不能原样透传到日志或 Renderer。

### 4.3 Python Core

- stdout 继续只承载版本化 JSON-RPC，日志不得污染 stdout；
- 如使用 stderr 传递结构化日志，每行必须有大小上限和固定 schema；Worker 解析、验证、脱敏后再送 Main；
- 替换可能输出完整 traceback/参数的生产路径；保留稳定 exception type/error code 和有界、脱敏 message；
- Python 日志写入失败不得改变 SQLite job 的真实状态；
- 不让 Agent 通过 RPC 指定日志文件、level、event 名或任意 details。

如现有架构下“Main 统一落盘”需要小幅扩展 Agent Worker 协议，应：

- 只新增一个版本化、有大小上限、运行时校验的固定 diagnostic message；
- 保持已有协议版本兼容策略和所有旧测试；
- 不新增通用日志 IPC、动态 channel 或 Renderer → Worker 原始日志通道。

## 五、诊断信息导出

### 5.1 第一阶段格式

A08 导出单个版本化 JSON 文件即可，建议扩展名：

```text
supervideo-diagnostics-YYYYMMDD-HHmmss.json
```

顶层至少包含：

- `diagnosticsVersion: 1`；
- `generatedAt`；
- 应用版本、Electron/Node/Python Core 版本；
- Windows 版本、CPU 架构，不含设备名和 Windows 用户名；
- Agent Worker/Core 状态、协议版本和能力版本；
- safeStorage `available/unavailable`，不含加密后端细节和密文；
- 凭据按 `serviceKind` 的配置数量，不含 `credentialRef`、provider、displayName、密文或 secret；
- 当前是否打开项目、manifest/schema/database schema 版本，不含项目 ID、名称和路径；
- job 按状态计数、最近少量稳定错误码与时间，不含 input/result/checkpoint/event payload；
- 日志版本、轮转状态、丢弃/脱敏/写入错误计数；
- 最近有界的脱敏日志事件，例如最多 200 条、总计不超过 256 KiB。

### 5.2 导出流程

- Renderer 只发出“导出诊断”意图；
- Main 使用原生 `showSaveDialog`，Renderer 不能传目标路径；
- 取消对话框不是错误，返回稳定 `cancelled` 结果；
- Main 在内存中构建白名单诊断模型，二次脱敏和校验后原子写入；
- 单文件设置明确上限，例如 512 KiB；超限时按规则裁剪最近日志并记录 `truncated: true`；
- 导出失败不留下半文件；
- 不读取素材、项目外文件、SQLite 原始页、WAL/SHM、环境变量、系统日志或浏览器数据；
- 不把凭据保险箱文件或任何密文放进诊断 JSON；
- 不自动上传、不复制到剪贴板、不打开外部 URL。

## 六、最小 Renderer UI

在现有测试/项目页中增加简单的“服务凭据”和“诊断”区域即可，不做大规模视觉重构。

凭据区域至少支持：

- 显示 safeStorage 可用/不可用状态；
- 选择 `serviceKind`，输入受限 `providerId`、`displayName` 和 secret；
- 保存成功后立即清空 secret 输入；
- 列表只显示安全元数据和“已配置”；
- 替换时只输入新 secret，仍不回显旧值；
- 删除前要求用户确认；
- 不把 secret 放进 React state 调试输出、DOM 属性、URL、localStorage/sessionStorage 或错误提示；
- 窗口重载后从 Main 重新读取安全元数据。

诊断区域至少支持：

- “导出诊断信息”按钮；
- 明确说明文件经过脱敏且不会自动上传；
- 显示成功、取消或稳定错误码，不显示完整目标路径。

## 七、建议代码结构

可根据现有仓库调整，不要求机械照搬：

```text
packages/shared/src/
  diagnostics-protocol.ts
  redaction-fixtures.ts

apps/desktop/src/main/
  observability/logger.ts
  observability/redact.ts
  security/credential-vault.ts
  diagnostics/collector.ts
  diagnostics/exporter.ts

services/core/src/supervideo_core/
  observability.py

scripts/
  diagnostics-smoke.mjs

docs/
  observability-and-secrets.md
```

尽量使用 Node/Electron/Python 标准能力。若新增依赖，必须说明它解决的具体问题、为何现有依赖不能完成，并提交锁文件；不得为了日志或 JSON 导出引入大型框架。

## 八、测试要求

### 8.1 凭据保险箱测试

至少覆盖：

- safeStorage 可用时 create/list/replace/remove；
- list/save/replace 返回值均不含明文和密文；
- safeStorage 不可用时拒绝保存，磁盘无新文件；
- 损坏 JSON、未知 schema、重复 ID、超大文件和解密失败；
- 原子写失败保留旧文件；
- 并发 replace/remove 结果确定；
- 重启/重新实例化后元数据仍可读；
- 测试保险箱文件包含密文但不包含明文哨兵；
- Renderer/preload 不存在读取或解密 API；
- 非可信 sender 和非法 payload 被拒绝。

### 8.2 脱敏与日志测试

使用固定虚假哨兵语料，至少覆盖：

- 大小写和嵌套 key；
- Authorization/Bearer/Cookie/Header；
- URL query/fragment；
- Windows/POSIX 绝对路径；
- Prompt、RPC params/result、job checkpoint；
- Error message/stack；
- 循环引用、深层对象、超长字符串、超大数组、BigInt、NaN/Infinity；
- 多进程关联 ID 和 terminal job 事件；
- 并发写入每行仍是有效 JSON；
- 达到上限后正确轮转且不删除目录外文件；
- sink 写入失败不导致 Worker/Core/job 失败；
- 全部日志和控制台输出扫描不到明文哨兵。

TypeScript 与 Python 至少共享同一份 JSON golden fixture 输入和期望敏感字段结果，防止两套规则漂移。

### 8.3 诊断导出测试

至少覆盖：

- 无项目、打开项目、Worker 不可用和存在 job 错误时都能生成合法 schema；
- 用户取消不写文件；
- 原子写失败不留半文件；
- 最近日志条数和总字节受限，超限标记 `truncated`；
- 导出文件不含 secret、密文、credentialRef、provider/displayName、Prompt、项目/素材名称、绝对路径或环境变量；
- 导出结果不泄露保存目标完整路径到 Renderer；
- 导出完成后现有 A07 job 状态不被修改。

### 8.4 自动化 smoke

新增根命令：

```powershell
npm run diagnostics:smoke
```

smoke 必须使用临时目录与测试 adapter，并完成：

1. 创建临时保险箱；
2. 保存一个唯一虚假哨兵 secret；
3. 生成包含该哨兵、Bearer、URL query、Prompt 和绝对路径的恶意日志输入；
4. 跑一个 A07 模拟 job，使日志带 operation/job/request 关联字段；
5. 导出临时诊断 JSON；
6. 断言保险箱磁盘文件没有明文，只含可识别为密文的值；
7. 断言日志、诊断 JSON、项目 manifest/database 和进程输出均不含明文哨兵；
8. 断言诊断 schema、大小上限、job 状态计数和关联 ID 合法；
9. 删除凭据并确认 list 为空；
10. 清理本次 smoke 自己创建的临时目录。

smoke 不得写真实 Electron `userData`，不得依赖联网，不得打开真实用户项目。

## 九、两天实施拆分

### 第 1 天上午：契约、脱敏器、日志 sink

- 定义 shared 日志/诊断/凭据元数据契约和错误码；
- 建立 golden redaction fixtures；
- 实现 TS 日志事件白名单、脱敏、大小限制、JSONL sink 与轮转；
- 接入 Main 的 session/correlation 规则和现有 Worker controller 生命周期；
- 先写单元测试并保证现有 A01–A07 测试不回归。

### 第 1 天下午：safeStorage 保险箱

- 实现窄 safeStorage adapter、版本化凭据文件和原子写；
- 完成 create/list/replace/remove、损坏/不可用失败路径和 IPC/preload；
- 增加最小 Renderer 凭据 UI；
- 用临时目录和 fake adapter 完成自动化测试，实际生产 wiring 使用 Electron safeStorage。

### 第 2 天上午：Worker/Core 日志与诊断收集

- 接入 Worker/Core 固定结构日志，保持 stdout/RPC 和 A07 出站校验边界；
- 完成 Python 脱敏语义与共享 fixtures；
- 实现白名单诊断 collector、大小裁剪和二次脱敏；
- 实现 Main 原生保存对话框与原子 JSON 导出。

### 第 2 天下午：UI、smoke、文档与 Gate A 回归

- 完成最小诊断 UI、状态与错误提示；
- 编写并通过 `diagnostics:smoke`；
- 运行完整验收矩阵和敏感信息扫描；
- 更新 README 与安全/日志文档；
- 在 Windows 上手工演示保存凭据、任务关联日志、导出诊断、删除凭据和重启状态。

若第 2 天仍有时间，只补测试和故障路径，不扩展 Provider 或 UI。

## 十、文档要求

新增或更新文档，至少说明：

- 凭据保存位置、safeStorage/DPAPI 边界和不可回显设计；
- safeStorage 不可用/保险箱损坏时的用户可见行为和恢复方式；
- 日志字段、关联 ID、轮转和禁止记录内容；
- 诊断 JSON schema、包含/明确不包含的内容、大小上限；
- `diagnostics:smoke` 的用途；
- 用户如何保存、替换、删除凭据与导出诊断；
- A08 不会联网或自动上传任何内容；
- D01/G08 后续会扩展 Provider 健康检查和安装诊断，但不会改变“Main 独占解密”的边界。

更新根 README 的命令与当前能力状态。若改动 shared/Worker/Core 协议，更新对应契约文档。

## 十一、验收命令

至少实际执行并在交接中逐条报告结果：

```powershell
npm run core:setup
npm run typecheck
npm test
npm run core:test
npm run health
npm run build
npm run core:rpc:smoke
npm run core:storage:smoke
npm run agent:smoke
npm run project:smoke
npm run jobs:smoke
npm run diagnostics:smoke
```

然后验证既有 spike 不回归：

```powershell
Set-Location C:\Project\SuperVideo\spikes\pi-electron-bridge
npm run validate
```

注意：spike validate 会更新受版本控制的 `validation-report.json`。验证完成后恢复该报告的临时时间戳/计数改动，不要把本次运行产物提交。

再做仓库敏感信息与产物检查。至少扫描：

- 明文测试哨兵；
- 常见真实 Key/Bearer 模式；
- `.env*`、凭据保险箱、诊断导出、运行日志；
- 临时项目、SQLite/WAL/SHM、缓存、dist、测试报告；
- 项目外路径、用户名和本机专属路径。

扫描命令本身不要把真实环境变量或凭据打印到终端。

## 十二、完成定义

只有同时满足以下条件，A08 才算完成：

- Windows 正式路径使用 Electron safeStorage，且不可用时绝不明文降级；
- Renderer 不能读回 secret、密文或使用任意 IPC/文件路径；
- 保险箱文件原子、版本化、严格校验，损坏时不静默覆盖；
- Main/Worker/Core 关键事件形成有界、可关联、可轮转的 JSONL 日志；
- 所有持久化日志和诊断导出均无明文 Key、密文、Prompt、绝对路径和完整请求体；
- 用户可主动导出有界、版本化、脱敏 JSON，且不会自动上传；
- 凭据与诊断最小 UI 可演示，保存后 secret 输入被清空；
- A07 持久 job 和之前所有 smoke 无回归；
- `diagnostics:smoke` 可重复通过且不污染用户目录；
- 文档与实现一致；
- 工作区不含运行产物或私密数据；
- 分支上已有清晰提交，且没有合并或推送远程。

## 十三、交接格式

完成后向主智能体提供：

1. 分支名；
2. 提交哈希及每个提交的用途；
3. 关键文件与行为摘要；
4. 凭据文件格式和 safeStorage 失败策略；
5. 日志/诊断 schema、轮转与大小限制；
6. 实际执行的全部验证命令及结果；
7. secret/路径/产物扫描结果；
8. 手工 Windows 演示结果；
9. 已知限制、未完成项和需要人工关注的风险；
10. 明确声明未使用真实 Key、未自动上传数据、未修改项目外素材、未合并 `main`、未推送远程。
