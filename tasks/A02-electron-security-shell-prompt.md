# A02 开发任务提示词：Electron 安全壳

以下内容可直接交给负责 A02 的开发智能体。

---

你正在开发 `C:\Project\SuperVideo` 项目的 A02 工作包。请先完整阅读：

1. 根目录 `AGENTS.md`；
2. `docs/development-workflow.md`；
3. `docs/phase-1-technical-design.md`，重点阅读第 3、5、12、15、18.1 和 18.2 节；
4. 根目录 `README.md`；
5. A01 已建立的 `apps/desktop`、`packages/shared`、根目录 scripts 和 tests。

## Git 要求

- 确认工作区干净，从最新 `main` 创建分支 `feat/a02-electron-security-shell`；
- 所有实现、测试和提交都在该分支完成；
- 不要合并 `main`，不要推送远程仓库；
- 不得修改或重写 A01 的提交历史；
- 完成后提交代码，并按 `docs/development-workflow.md` 提供交接信息。

## 任务目标

将 A01 的 Electron 最小窗口加固为可继续承载 Agent 产品的安全桌面壳：明确 Renderer、preload 和 Main 的信任边界；只允许版本化、类型化、可审计的 IPC；阻止非预期导航、弹窗和权限请求；区分开发环境与生产环境的内容来源策略。

本任务只建设 Electron 安全边界，不接入 Pi Agent、Python RPC、SQLite、项目文件夹、API Key、媒体处理或业务页面。

## 威胁模型

至少覆盖以下风险：

1. Renderer 页面或其第三方依赖被注入后尝试访问 Node、文件系统或任意 IPC；
2. 页面被导航到外部站点后继续使用 preload 能力；
3. 恶意页面打开新窗口、触发下载或请求摄像头、麦克风、定位等权限；
4. 未知 IPC channel、非法 payload、错误 sender 或重复 handler 绕过边界；
5. 生产包错误加载远程开发服务器，或开发参数接受非本机 URL；
6. Main 的内部异常、绝对路径或堆栈被直接暴露给 Renderer。

不需要防御已经取得 Windows 管理员权限的本机攻击者，也不在本任务实现代码签名和安装包沙箱。

## 必须实现

### 1. 集中式窗口安全配置

- 将 BrowserWindow 的安全选项提取为可单元测试的配置函数；
- 必须保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；
- 显式保持 `webSecurity: true`、`allowRunningInsecureContent: false`；
- preload 路径只能由 Main 内部构造，不能由 Renderer 或命令行任意指定；
- 窗口先隐藏，`ready-to-show` 后再显示，加载失败要进入可诊断状态；
- 保留 Windows 第一阶段目标，不引入平台专属的 macOS/Linux 业务逻辑。

### 2. 运行环境与内容来源策略

- 建立明确的 development/production runtime config；
- 只有非 packaged 开发环境可以读取 `--dev-server`；
- 开发服务器 URL 必须是 `http://127.0.0.1:<port>` 或项目明确允许的等价本机地址，不接受公网域名、任意协议、用户名密码、路径注入或额外参数；
- production 只能加载打包后的本地 renderer 文件；
- 内容安全策略 CSP 至少限制 default/script/object/base/frame 来源；开发环境可为 Vite HMR 做最小、显式放宽，生产环境不得保留不必要的 localhost 或 unsafe 权限；
- 将允许的 Renderer origin 集中管理，供导航和 IPC sender 校验共用。

### 3. 导航、窗口与权限防护

- 监听 `will-navigate`，只允许当前受信 Renderer origin；其他导航一律阻止并记录脱敏诊断；
- 使用 `setWindowOpenHandler` 默认拒绝新窗口；A02 没有任何允许外链弹窗的业务需求；
- 对 session 的 permission check/request 默认拒绝；A02 不需要摄像头、麦克风、定位、通知、MIDI、剪贴板读取等权限；
- 不通过 `shell.openExternal` 自动打开任何 Renderer 提供的 URL；
- 防护注册必须在页面开始承载不可信内容之前完成。

### 4. 版本化、类型化 IPC

- 在 `packages/shared` 中定义 IPC contract、channel 常量、请求/响应类型和契约版本；不要在 Main、preload、Renderer 分别复制字符串和类型；
- A02 只保留当前只读环境状态能力，可将 channel 规范为版本化名称，例如 `desktop:v1:get-environment`；
- Main handler 必须验证 sender frame 的 URL/origin，仅接受受信 Renderer；
- 即使当前请求无业务参数，也应建立统一的 payload 校验入口，为后续 IPC 复用；
- 返回值只包含 Renderer 必需的可序列化字段，不返回 Node/Electron 对象、绝对路径、环境变量或堆栈；
- 内部错误转换为稳定的公开错误结构，未知错误对 Renderer 只暴露通用消息和错误码；
- handler 注册必须可重复测试并支持清理，避免热重载或测试导致 duplicate handler；
- preload 只暴露一个冻结的、最小能力对象，不暴露 `ipcRenderer`、`send`、`invoke(channel)`、EventEmitter 或任意 channel 参数；
- Renderer 的 `window.supervideo` 类型直接来源于共享 contract，避免重复声明漂移。

### 5. 构建关系

- 如果 desktop 引用 `@supervideo/shared`，正确声明 workspace dependency；
- 更新根目录 build/typecheck/dev 顺序，确保全新 clone 后无需手工预构建 shared；
- 不使用指向源码目录的脆弱相对导入绕过 workspace 边界；
- 保持 CommonJS/ESM 边界清晰，Electron Main 和 sandboxed preload 能在当前 Electron 44.3.0 中运行。

### 6. 诊断与文档

- 为被拒绝的导航、窗口、权限和 IPC 记录结构化、脱敏日志；A02 可以使用最小日志接口，不需要提前实现 A08 的完整日志系统；
- 新增简短的 Electron 安全说明文档，写明信任边界、允许来源、IPC 暴露面、开发/生产差异和当前限制；
- 更新 README 中与桌面安全、开发启动有关的内容；
- 注释解释“为什么存在该安全边界”，避免逐行重复代码。

## 测试要求

新增自动化测试，至少证明：

1. BrowserWindow 安全配置中的关键开关不能被回归；
2. 合法本机 dev server URL 被接受，公网 URL、`file:` 注入、带凭据 URL、错误端口和畸形输入被拒绝；
3. production 不使用 dev server 参数；
4. 受信 sender 可以调用白名单 IPC，非受信 sender 被拒绝；
5. 非法 payload 被拒绝且不会进入业务 handler；
6. 公开错误不包含内部堆栈、绝对路径或环境变量；
7. preload 暴露对象不接受任意 channel；
8. 导航、新窗口和权限策略默认拒绝未列入白名单的请求；
9. handler 可以清理后重新注册，不产生重复注册错误。

不要只通过正则读取源码来完成全部安全测试。把核心判定提取为无 Electron GUI 依赖的纯函数并做行为测试；必要的 Electron 集成可以使用独立测试入口。

## 验收命令

必须实际执行并记录结果：

```powershell
npm run typecheck
npm test
npm run health
npm run build
npm run dev
```

另外运行现有 spike：

```powershell
Set-Location .\spikes\pi-electron-bridge
npm run validate
```

运行 spike 会改写 `validation-report.json`；不要把纯时间戳、PID、累计消息数等 Review 噪声提交到 A02。结束前确认 `git status` 只包含本任务应提交的文件。

## 验收标准

- Electron 窗口可以在开发模式启动，现有状态页正常显示；
- Renderer 无 Node、文件系统和原始 ipcRenderer 访问能力；
- preload API 是冻结、最小且类型化的；
- IPC sender、channel 和 payload 均受控；
- 非预期导航、新窗口和权限默认拒绝；
- development 只接受本机 dev server，production 只加载本地打包文件；
- CSP 的开发/生产差异明确且经过测试；
- 所有新增安全测试及 A01 原有测试通过；
- 根目录 typecheck、test、health、build、dev 仍可用；
- 既有 Pi/Electron/Python spike 未被破坏；
- 无密钥、用户数据、node_modules、dist、缓存、日志和运行时报告噪声进入提交。

## 禁止事项

- 不接入 Pi 或启动 Agent Worker，这属于 A03；
- 不实现 Python JSON-RPC，这属于 A04；
- 不接入 SQLite、项目创建或任务状态机；
- 不实现 safeStorage/API Key 管理，这属于 A08；
- 不添加文件选择器、系统托盘、自动更新、自动发布或业务页面；
- 不使用 `remote` 模块，不关闭 webSecurity，不允许任意外链；
- 不把 ipcRenderer 或通用 invoke/send 方法暴露给 Renderer；
- 不修改技术方案的产品边界，确需变更时先在交接中提出。

## 完成交接

提交后返回：

```text
任务：A02
分支：feat/a02-electron-security-shell
提交：<commit hash>
变更：<安全边界和主要文件>
验证：<每条命令及实际结果>
限制：<尚未覆盖的 Electron 风险>
风险：<需要 Review 特别检查的地方>
```

不要自行合并 `main`，不要自行推送远程仓库。

---
