# Electron 安全壳（A02）

A02 只建立 Electron 的进程和内容安全边界，不接入 Agent、Python RPC、SQLite、项目文件夹、API Key 或媒体处理。

## 信任边界

- Renderer 是不可信的 React 页面。它没有 Node.js、文件系统、原始 `ipcRenderer`、任意 channel、外链窗口或权限能力。
- preload 是唯一的窄桥，只暴露冻结的、按业务命名的 `window.supervideo` 能力：环境状态、Agent Worker 状态、smoke run、取消和产品化事件订阅。channel、payload 和返回结构来自 `@supervideo/shared` 的版本化 contract。
- sandboxed preload 在构建时由 esbuild 内联 shared 的运行时常量，运行时只保留 Electron 内建模块依赖，避免 sandbox preload 通过 `require` 加载 workspace 包。
- Main 是受信边界，负责 BrowserWindow 配置、来源校验、session 防护、IPC handler 和 Agent Worker owner。所有 IPC 都校验 frame URL、payload 和已知 channel；Worker 事件到达 Renderer 前还会经过产品事件映射和 preload 校验。
- Main 内部错误只转换为稳定的 `forbidden-sender`、`invalid-payload` 或 `internal-error` 公开错误，不把堆栈、绝对路径、环境变量或 Electron 对象传给 Renderer。

## 内容来源与 CSP

开发环境只有精确格式 `http://127.0.0.1:<port>` 的 `--dev-server=` 参数会被接受；协议、主机、端口、凭据、路径、query 和 fragment 均受限。开发服务器无效时安全地回退到本地 renderer 文件。生产环境完全忽略 `--dev-server`，只加载打包后的 `dist/renderer/index.html`。

允许的 renderer origin/文件 URL 集中在 runtime config 中，同时供导航和 IPC sender 校验使用。开发 CSP 只为本机 Vite HMR 显式放宽脚本、连接和样式来源；生产 CSP 不包含 localhost、`unsafe-eval` 或远程来源，并限制 `default-src`、`script-src`、`object-src`、`base-uri` 和 `frame-src`。

## 导航、窗口、权限和下载

在首次加载页面前，Main 会注册导航和 session 防护：非当前受信来源的 `will-navigate`/redirect 一律阻止；`setWindowOpenHandler` 默认拒绝新窗口；permission check/request 默认拒绝摄像头、麦克风、定位、通知、MIDI、剪贴板读取等权限；下载默认取消。A02 不使用 `shell.openExternal`。

拒绝事件写入最小结构化诊断，只记录事件、稳定原因和脱敏 origin/URL 摘要，不记录 query、fragment、堆栈或内部路径。窗口默认隐藏，`ready-to-show` 后显示；加载失败进入 Main 的失败状态并记录可诊断事件。

## A06 dialog/path grant

A06 adds only semantic preload methods for project create/open and asset
reference. Their Renderer payloads contain project metadata or an already
validated `projectId`; they never contain a directory or file path. Main binds
the native `showOpenDialog` owner to the invoking `BrowserWindow`, accepts one
existing directory for project operations, and accepts explicit regular files
for asset references. Main rejects volume roots and unsupported UNC project
locations, then sends the dialog result only to the matching fixed Worker
command. Cancel is a normal `{ cancelled: true }` result and does not start
Worker/Core work.

The Renderer can display paths returned in a successful summary because the
user has already granted them. Security diagnostics continue to record only
stable reasons, counts, IDs, and sanitized origin data; they do not record
selected project paths or asset names. No generic picker, file read/write,
`dialog`, `ipcRenderer`, `fs`, `path`, MessagePort, or arbitrary RPC bridge is
exposed to preload.

## 当前限制

A02/A03 不实现代码签名、安装包沙箱或对已取得 Windows 管理员权限的本机攻击者的防护。生产打包流程、自动更新和 Python/SQLite 业务 IPC 将在后续工作包中继续收紧；新增能力必须扩展共享 contract 和显式 allowlist，不能暴露通用 `invoke/send`。
