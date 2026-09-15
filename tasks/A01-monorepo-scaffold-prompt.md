# A01 开发任务提示词：Monorepo 与开发命令

以下内容可直接交给负责 A01 的开发智能体。

---

你正在开发 `C:\Project\SuperVideo` 项目的 A01 工作包。请先完整阅读：

1. 根目录 `AGENTS.md`；
2. `docs/development-workflow.md`；
3. `docs/phase-1-technical-design.md`，重点阅读第 3–6、12–13、16 和 18 节；
4. `spikes/pi-electron-bridge/README.md`，了解已验证链路，但不要把 spike 直接当成正式应用结构。

## Git 要求

- 确认工作区干净，并从最新本地 `main` 创建分支 `feat/a01-monorepo-scaffold`；
- 所有开发和提交都在该分支进行；
- 不要合并 `main`，不要推送远程仓库；
- 完成后提交代码，并按 `docs/development-workflow.md` 提供交接信息。

## 任务目标

建立 SuperVideo 的正式 Monorepo 和最小开发环境，使 Electron/React 桌面端、TypeScript Agent Worker 占位模块、Python Core 占位服务具有清晰边界，并能通过根目录的一组统一命令安装、检查和启动。

这是工程骨架任务，不实现 Pi Agent、正式 RPC、SQLite、视频分析、Remotion 或剪映能力；这些属于后续工作包。

## 架构约束

- 第一阶段目标平台是 Windows，所有命令必须能在 PowerShell 下运行；
- JavaScript/TypeScript 使用根目录 npm workspaces，不额外引入 pnpm、Yarn 或 Turborepo；
- 桌面端使用 Electron + React + TypeScript；可以使用 Vite/electron-vite 完成最小构建，但要说明选择；
- Python Core 使用 `pyproject.toml` 和 `src` layout，包名使用 `supervideo_core`；
- Agent Worker 在本任务中只建立独立 TypeScript 模块和健康检查，不接入 Pi；
- Renderer、Electron Main、preload、Agent Worker、Python Core 必须是独立目录，不能把所有逻辑堆在一个应用目录；
- 不依赖管理员权限，不写入项目外目录，不引入真实 API Key；
- 不复制或改造 `spikes/pi-electron-bridge`，保留它作为验证证据。

## 推荐目录

可以在不改变边界的前提下微调命名，但必须在 README 解释：

```text
SuperVideo/
├─ apps/
│  └─ desktop/                 # Electron main、preload、React renderer
├─ workers/
│  └─ agent/                   # 独立 TypeScript Agent Worker 占位模块
├─ services/
│  └─ core/                    # Python supervideo_core 包
├─ packages/
│  └─ shared/                  # 最小共享类型或健康状态类型；没有需求可只保留说明
├─ scripts/                    # 跨平台 Node 编排脚本，避免依赖 bash
├─ docs/
├─ spikes/
├─ package.json
├─ tsconfig.base.json
└─ README.md
```

## 必须实现

1. 根目录 npm workspace 配置及锁文件；
2. Electron + React + TypeScript 最小桌面窗口，清楚显示 `SuperVideo`、桌面端状态和当前开发环境；
3. Electron Main、preload 和 Renderer 分离，不在 Renderer 开启 Node integration；更完整的安全 IPC 属于 A02；
4. `workers/agent` 提供可独立执行的健康检查，输出稳定 JSON，例如 `{"service":"agent-worker","status":"ok"}`；
5. `services/core` 提供可独立执行的 Python 健康检查，输出稳定 JSON，例如 `{"service":"python-core","status":"ok"}`；
6. 根目录统一命令：
   - `npm run dev`：启动桌面开发环境；
   - `npm run build`：构建当前 Node/TypeScript workspace；
   - `npm run typecheck`：检查所有 TypeScript workspace；
   - `npm run health`：依次验证桌面工程、Agent Worker 和 Python Core；失败时返回非零退出码；
   - `npm test`：运行本任务已有的最小自动化测试；
7. 根目录 README 写明环境要求、首次安装、常用命令、目录职责和已知限制；
8. `.gitignore` 覆盖 node_modules、构建产物、Python 虚拟环境、缓存、日志和临时文件，同时保留需要提交的 lockfile；
9. 现有技术方案和 spike 仍可访问，不删除、不移动、不破坏 `spikes/pi-electron-bridge` 的 `npm run validate`。

## 实现建议

- 根命令的多进程编排优先使用小型 Node 脚本或明确用途的开发依赖，避免 PowerShell 专用脚本和 bash 语法；
- Python 健康检查尽量只使用标准库，使 A01 不依赖大型媒体包；
- Node/Python 版本约束写入工程配置和 README，但不要擅自安装全局软件；
- 健康检查必须验证真实模块入口，而不是只 `echo ok`；
- 保持 UI 极简。本任务验收的是工程结构和开发体验，不是视觉设计。

## 验收标准

- 全新 clone 后，按 README 操作可以安装依赖；
- `npm run typecheck` 通过；
- `npm test` 通过；
- `npm run health` 通过，并包含 desktop、agent-worker、python-core 三项真实检查；
- `npm run build` 通过；
- `npm run dev` 能打开最小 Electron 桌面窗口，Renderer 控制台无阻断错误；
- Windows PowerShell 下不依赖 `bash`、`make`、`&&` 等环境假设；
- `git status` 中没有 node_modules、dist、虚拟环境、缓存或运行时临时文件；
- 现有 spike 的验证命令仍能通过；若因环境原因未执行，交接时明确说明，不能写成已通过。

## 禁止事项

- 不实现 A02 之后的业务功能；
- 不接入 Pi、LLM、数据库、FFmpeg、Whisper、Remotion 或剪映；
- 不添加真实服务凭据；
- 不为了脚手架重写现有技术方案；
- 不在 `main` 上提交，不自行推送远程。

## 完成交接

提交实现后，返回：分支名、提交哈希、主要目录和命令、变更摘要、每条验证命令的实际结果、已知限制与风险。不要只说“完成”或“测试通过”。

---
