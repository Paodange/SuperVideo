# A06 开发任务提示词：项目创建与路径引用

以下内容可直接交给负责 A06 的开发智能体。

---

你正在开发 `C:\Project\SuperVideo` 项目的 A06 工作包。开始前请完整阅读：

1. 根目录 `AGENTS.md`；
2. `docs/development-workflow.md`；
3. `docs/phase-1-technical-design.md`，重点阅读第 3、5、6、8、12、15、18.1、18.2 和 19 节；
4. `docs/electron-security.md`；
5. `docs/agent-worker.md`；
6. `docs/python-rpc.md`；
7. `docs/storage.md`；
8. 根目录 `README.md`；
9. A02 的受限 IPC/preload、安全 sender 校验和路径无关安全策略；
10. A03 的 Agent Worker controller 与版本化 Worker 消息协议；
11. A04 的 `PythonCoreClient`、Core RPC registry、跨语言 fixtures 和错误模型；
12. A05 的 `Database`、migration runner、models 和 repositories。

## Git 要求

- 确认工作区干净，从最新 `main` 创建分支 `feat/a06-project-path-references`；
- 所有实现、测试、文档和提交都在该分支完成；
- 不要合并 `main`，不要推送远程仓库；
- 不修改或重写 A01–A05 的提交历史；
- 完成后形成清晰提交，并按 `docs/development-workflow.md` 提供交接信息。

## A05 Review 跟进项

A05 当前只有一个 migration，运行正常；但 `discover_migrations()` 依赖资源目录迭代顺序。开始 A06 时先做一个最小加固：

- 资源文件必须按解析出的 migration version 显式排序后再交给 `validate_migrations()`；
- 增加至少两个模拟 migration 的顺序测试，证明目录枚举顺序不会影响升级；
- 不修改已发布的 `0001_initial.sql` 内容或 checksum；
- 该加固单独形成小提交，随后再开发 A06。

如果实现检查后确认已经有等价排序保证，只需补充对应回归测试并在交接说明中给出证据。

## 任务目标

建立第一版可实际使用的本地项目工作流：

- 用户在 Electron 中创建或打开一个 SuperVideo 项目；
- Windows 原生目录选择器决定项目根目录，Renderer 不能自行让 Main/Core 访问任意路径；
- Python Core 创建标准项目目录、严格 manifest 和 `data/project.db`；
- 打开项目时校验 manifest、数据库、项目 ID、schema version 和目录一致性；
- 用户通过原生文件选择器选择一个或多个本地媒体文件；
- Core 只把原始素材作为绝对路径引用登记到 `assets`，不复制、不移动、不重命名、不转码原视频；
- Renderer 显示当前项目摘要与已引用素材列表；
- 关闭并重新打开应用/Worker 后，通过再次打开项目恢复相同项目和素材记录；
- 为 A07 job 状态机和 B 组素材扫描/分析提供明确边界。

完成后应可演示：创建项目 → 自动生成标准目录和数据库 → 引用外部口播视频 → 看到素材摘要 → 退出 → 再次打开项目 → 记录仍在，外部视频未被复制或修改。

## 本任务不做什么

- 不实现自然语言聊天或让 Pi 自主选择磁盘路径；
- 不递归扫描整个素材目录；
- 不做 ffprobe、转码、缩略图、代理文件、ASR、VAD、镜头检测或向量化；
- 不实现 A07 的持久化 job、任务事件、恢复和调度；
- 不实现最近项目列表、云同步、项目压缩包、备份或导入旧格式；
- 不实现拖拽导入；
- 不读取剪映草稿或抖音主页。

用户未来可以在自然语言中告诉智能体素材路径，但 A06 尚无正式聊天解析。A06 必须把路径授权边界设计好：未来 Agent 只能使用用户通过 Main 确认过的路径或已有 `asset_id`，不能把模型生成的任意字符串直接交给文件系统。

## 进程与信任边界

正式调用链：

```text
Renderer 固定按钮
  -> preload 固定方法
  -> Electron Main sender/payload 校验
  -> Windows 原生 dialog 产生用户授权路径
  -> Agent Worker 受控项目命令
  -> PythonCoreClient
  -> Python Core 白名单 project/asset RPC
  -> manifest + SQLite repository + 只读素材引用
```

核心规则：

- Renderer 的“创建项目”“打开项目”“添加素材”请求不携带磁盘路径；
- 目录和文件绝对路径只来自 Main 调用的原生 dialog；
- dialog 取消是正常结果，不记为内部错误，也不产生文件或数据库副作用；
- Main 只把本次选择结果发送给 Worker 的固定命令，不提供通用 `filesystem.*` 或 `rpc.invoke`；
- Worker 的项目命令不注册为 Pi 可自由调用的工具；
- Python Core 只注册明确的 `project.*`/`asset.*` RPC 方法，不提供任意路径读取、目录列举、SQL 或 Shell；
- Renderer 可以在用户已经选定后显示项目/素材路径，但日志、错误和诊断默认只记录 basename、数量、资源 ID 或脱敏路径摘要；
- preload 不暴露 `dialog`、`ipcRenderer`、`fs`、`path`、MessagePort 或任意 channel。

## 项目创建交互

### Renderer 输入

创建项目面板只需要：

- 项目名称；
- 目标平台，默认 `douyin`；
- “选择文件夹并创建”按钮。

项目名称做长度、空白和控制字符校验，但不需要把名称变成目录名；用户直接选择一个现有的空目录作为项目根目录。这样避免应用猜测路径或静默创建错误层级。

### Main 目录选择

使用 `dialog.showOpenDialog` 的目录选择能力，并允许用户新建目录。要求：

- 仅接受一次选择的单个目录；
- 取消返回 `{ cancelled: true }` 或等价受控结果；
- 选择结果必须是绝对路径、真实存在的目录；
- 拒绝文件系统卷根目录，例如 `C:\`；
- 项目根目录可以包含空格、中文和较长 Windows 路径；
- 明确处理 UNC 路径：如果当前 SQLite/WAL 与后续媒体工具尚未验证 UNC，则第一阶段返回稳定 `UNSUPPORTED_PROJECT_LOCATION`，不要半支持；
- 目录选择与发送 Worker 请求在同一 Main 操作中完成，Renderer 不能替换 dialog 返回值。

### 对目录内容的规则

第一阶段只允许在以下位置创建：

- 空目录；或
- 仅包含由本次创建流程明确允许的隐藏系统项、且不会发生文件覆盖的目录。

默认建议严格要求空目录。若目录已有 `project.supervideo.json`，返回 `PROJECT_ALREADY_EXISTS` 并提示改用“打开项目”；若存在其他用户文件，返回 `PROJECT_DIRECTORY_NOT_EMPTY`。不得删除、移动或覆盖这些文件。

## 标准项目结构

创建成功后必须得到：

```text
<project-root>/
├─ project.supervideo.json
├─ data/
│  └─ project.db
├─ cache/
├─ generated/
├─ previews/
├─ exports/
│  ├─ videos/
│  └─ jianying/
└─ logs/
```

要求：

- 只创建上述已知目录和文件；
- 不创建 `materials` 并把外部视频复制进去；
- 不在项目目录中创建 `.venv`、node_modules 或应用构建产物；
- 所有生成目录是应用输出位置，原始素材仍位于用户原路径；
- 目录碰到同名文件时返回稳定冲突错误，不覆盖；
- 创建失败时只清理“本次操作创建且仍能证明属于本次操作”的临时文件/空目录；
- 不递归删除用户预先存在的目录；
- 清理前必须验证目标仍位于本次已选择的项目根目录；
- 如果无法安全自动回滚，保留可识别的未完成状态并返回恢复建议，不能冒险删除。

## 项目 manifest

文件固定为根目录 `project.supervideo.json`，UTF-8 无 BOM，建议形态：

```json
{
  "schemaVersion": 1,
  "projectId": "<uuid>",
  "name": "招聘口播项目",
  "targetPlatform": "douyin",
  "database": "data/project.db",
  "createdAtMs": 1700000000000,
  "updatedAtMs": 1700000000000
}
```

具体要求：

- 定义独立 `PROJECT_MANIFEST_SCHEMA_VERSION = 1`；
- manifest 版本不能复用数据库、Core RPC、Worker 或 Timeline 版本；
- 使用严格 Pydantic model，拒绝未知字段、错误类型、无效 UUID、绝对 `database` 路径和 `..`；
- `database` 第一阶段必须精确为 `data/project.db`，不能让 manifest 指向项目外部；
- manifest 不保存 API Key、credential 密文、用户提示词、完整素材列表或系统环境信息；
- 使用同目录临时文件 + flush/fsync（平台支持时）+ 原子 rename/replace 写入；
- 创建时不能覆盖已有 manifest；
- 打开项目不因格式化差异重写 manifest；
- schema version 高于当前程序时返回 `PROJECT_SCHEMA_TOO_NEW`，禁止猜测打开；
- manifest 损坏时返回稳定错误，不回退为新项目创建，也不覆盖原文件。

## 创建操作的原子性

建议顺序：

1. Main 取得用户选择并完成路径预检；
2. Core 再次做服务端路径和目录预检；
3. 创建已知标准目录；
4. 创建 `data/project.db` 并运行 A05 migrations；
5. 在 `projects` 表写入唯一 project 记录；
6. 完成数据库 integrity/foreign-key 检查并关闭连接；
7. 最后原子写入 manifest，作为“项目可打开”的完成标志；
8. 返回结构化 `ProjectSummary`。

不得先写正式 manifest 再留下未建好的数据库。对每个失败注入点增加测试，证明不会覆盖用户文件，也不会把残缺项目误报为成功。

## 打开项目

“打开项目”同样由 Main 的目录 dialog 选择根目录。Core 必须依次：

1. 读取固定文件名 manifest，限制最大字节数；
2. 用严格模型解析并检查 `schemaVersion`；
3. 确认 `database` 是固定相对路径且解析后仍在项目根目录内；
4. 确认数据库存在且是普通文件；
5. 打开数据库并执行 migration；
6. 运行 quick/foreign-key check；完整 integrity check 可由诊断命令执行，避免每次打开过慢；
7. 读取 manifest `projectId` 对应的 project row；
8. 核对项目 ID、名称、目标平台和根目录；
9. 创建缺失的可再生空目录，但不得覆盖同名文件；
10. 返回项目摘要和有界素材列表。

项目整体被用户移动到新目录时，允许通过 manifest project ID 识别同一项目，并在一个受控事务中更新数据库内 `project_root` 与 revision。要求：

- 只有 manifest ID 与数据库 ID 完全匹配时才能更新；
- 新旧路径不同必须被识别为“移动”，不是新建项目；
- 不移动数据库或素材，只更新项目自身位置记录；
- 路径唯一约束冲突时拒绝；
- 更新后原子刷新 manifest `updatedAtMs`；
- 任何失败都不能改变 project ID；
- 文档说明外部素材绝对路径不会随项目移动自动改变。

## 当前项目会话

第一阶段同一窗口只维护一个 active project：

- Worker/Python Core 中可保存当前已打开项目的受控 session context；
- `asset.reference` 不从 Renderer 接收 project root，而使用当前已验证项目；
- 请求仍携带 `projectId` 做一致性检查，防止迟到响应写入新项目；
- 切换项目前等待当前项目操作结束；A06 暂无 A07 job，因此不处理长任务迁移；
- Worker 重启后 active context 可以丢失，Renderer 显示“需要重新打开项目”，不能假装仍可写；
- 应用重启后不自动扫描最近目录。用户再次选择“打开项目”即可恢复；
- stale request/result 必须按 operation ID 和 project ID 丢弃。

## 素材路径引用

### 选择方式

“添加素材”按钮由 Main 打开原生文件选择器，允许多选普通文件。A06 只处理显式选择的文件，不递归目录。

首批允许的扩展名至少覆盖常见口播视频：

- `.mp4`；
- `.mov`；
- `.mkv`；
- `.avi`；
- `.m4v`；
- `.webm`。

可以同时定义未来会用到的音频/图片白名单，但不要在 A06 实现处理能力。扩展名判断不等于媒体真实性验证；B01 会用 ffprobe 校验。未知类型返回 `UNSUPPORTED_ASSET_TYPE`。

### 路径规范化与文件检查

每个文件必须：

- 是本次 Main dialog 返回的路径；
- 是绝对路径，不能含 NUL；
- 解析后是当前可访问的普通文件，不是目录、设备、管道或 socket；
- 对 symlink/reparse point 制定一致策略。建议解析到真实目标后存 canonical path，并确保目标仍是普通文件；
- 路径、basename 和扩展名长度有上限；
- 在登记前后读取 stat，若大小或修改时间发生变化则返回 `ASSET_CHANGED_DURING_REFERENCE`；
- 记录 `size_bytes`、`modified_at_ms`、canonical path、source type 和 fingerprint；
- 不打开为写模式，不改变文件时间、权限或属性。

### 轻量指纹

A05 要求 `content_fingerprint` 非空，而完整媒体分析属于 B01。A06 使用明确版本化的轻量内容指纹：

- 建议 `sampled-sha256-v1:<hex>`；
- hash 输入至少包含文件大小、首部固定大小字节、尾部固定大小字节；小文件可全量读取；
- 采样块大小形成源码常量并写入文档；
- 使用流式/定点读取，不能把整段大视频载入内存；
- hash 前后 stat 必须一致；
- 指纹算法版本作为前缀保存，B01 后续可升级为完整指纹；
- 不把绝对路径本身当成内容指纹；
- 测试证明相同内容得到稳定结果，首/尾变化会改变结果。

如果你判断全量 SHA-256 在当前实现和测试素材下足够快，也可采用流式全量 hash，但必须有取消/耗时边界，且不能一次把文件读入内存。无论选择哪种，都要明确文档，不得用随机值或 `pending` 冒充内容指纹。

### 批次语义

- 单次引用数量设置明确上限，例如 100；
- 先完成所有文件预检和指纹，再在一个数据库事务中写入；
- 任何一个新文件失败时，本批次不留下部分新增记录；
- 同一项目重复选择 canonical path 且 size/mtime/fingerprint 一致时，返回 `existing`，不重复插入；
- 同一路径已有记录但文件元数据或指纹变化时，返回 `ASSET_CHANGED`，不静默替换旧记录；
- 同一物理文件通过大小写、`.`/`..` 或 symlink 别名重复选择时尽可能归一为同一引用；
- 一个项目不能读取或修改另一个项目的 asset；
- 成功结果只返回有界摘要，不返回文件内容或媒体二进制。

## Python Core 服务

建议新增：

```text
project/
  manifest.py
  paths.py
  service.py
  models.py
  errors.py
```

职责：

- `manifest.py`：严格读取与原子写入；
- `paths.py`：Windows 路径、项目 containment、普通文件检查、标准目录常量；
- `service.py`：create/open/reference orchestration 与事务；
- `models.py`：请求、summary、asset reference result；
- `errors.py`：稳定项目/路径错误。

通过 A04 registry 显式新增最小 RPC 方法，名称建议：

- `project.create`；
- `project.open`；
- `project.inspect`；
- `asset.reference`；
- `asset.list`。

要求：

- 所有 params/results 有严格 Pydantic 模型；
- 更新 TypeScript runtime validators 与双端 golden fixtures；
- 这些方法只由 Worker 的受控项目命令调用，不注册成 faux Pi 的任意路径工具；
- 路径数组、字符串、返回条数和 JSON 大小有上限；
- 文件 I/O 不阻塞 Python RPC stdin 的取消/关闭处理；必要时放入受控线程；
- A04 `core.health`、countdown、progress、cancel 和既有错误保持兼容；
- 如果是纯新增方法，可保持 Core RPC protocol v1；若改变既有字段语义，必须升级版本并提供兼容说明。

## A05 repository 的最小扩展

为 A06 允许增加受控方法：

- project 按 ID/根目录查询；
- project moved 后更新 root、updated time 和 revision；
- asset 按 project + canonical path 查询；
- 多 asset 原子插入；
- 有界 asset list。

禁止增加任意 `update_fields(dict)`、任意 SQL、通用 delete 或绕过项目作用域的接口。A06 如果不需要改 schema，则 `DATABASE_SCHEMA_VERSION` 必须保持 1，且不能修改 `0001_initial.sql`。

## Worker 协议与 controller

扩展 A03 Worker wire contract，加入请求/响应相关的固定类型，例如：

Main → Worker：

- `project-create`；
- `project-open`；
- `project-inspect`；
- `asset-reference`；
- `asset-list`。

Worker → Main：

- `project-operation-result`；
- `project-operation-error`；
- 可选的有界 `project-operation-progress`。

每条操作包含：

- `operationId`；
- 操作类型；
- 需要时的 `projectId`；
- 版本、时间与严格 payload。

要求：

- controller 为 pending operation 设置超时、数量上限和退出清理；
- Worker 崩溃时所有 pending 项目操作以稳定错误结束；
- 迟到、重复、未知 operation ID 和旧 generation 的响应不能串到新请求；
- Core client 懒启动并完成 A04 handshake；
- Worker 正常关闭时先关闭 Core；Worker 意外退出后 Python 通过 stdin EOF 有限时间内退出，不留下孤儿进程；
- 项目操作与 A03 smoke run 的 busy 规则要明确，不能互相覆盖 active state；
- 不把 Python stderr、Pydantic 错误、stack 或完整路径写入 Worker product event；
- 仅新增消息类型时可保持 Worker protocol v1；改变既有消息含义则升级并同步所有验证。

## Electron Main、preload 与 Renderer

### 固定 preload API

增加语义化方法，建议：

```ts
createProject(input: { name: string; targetPlatform: string }): Promise<ProjectDialogResult>
openProject(): Promise<ProjectDialogResult>
addAssetReferences(input: { projectId: string }): Promise<AssetReferenceBatchResult>
listProjectAssets(input: { projectId: string }): Promise<AssetSummary[]>
```

路径不出现在 Renderer 的请求参数里。Renderer 只接收用户已选择后的 summary。

### Main 处理

- 每个 handler 继续使用 A02 sender trust policy；
- 输入使用 shared runtime validator，拒绝额外字段；
- handler 内打开 dialog，并把结果直接发往 controller；
- 同一窗口防止重复弹出同类 dialog；
- 窗口销毁或 app quit 时取消 pending UI 操作；
- dialog owner 绑定当前 BrowserWindow；
- 不记录完整路径、项目名或素材名到安全日志；
- 不新增通用路径选择、文件读取或 Core RPC IPC。

### 最小 Renderer

在保留 A03 工程状态能力的基础上，增加一个朴素可验证的项目页：

- 未打开状态；
- 创建项目表单；
- 打开项目按钮；
- 当前项目名称、平台、根目录和项目 ID 摘要；
- 添加素材按钮；
- 已引用素材列表：文件名、类型、大小、修改时间、状态；
- loading、取消、结构化错误和重试状态；
- 切换项目时清理旧项目素材 UI，避免迟到响应回填。

不需要正式聊天、复杂路由、设计系统、拖拽或媒体预览播放器。不要为了页面美化扩大任务。

## 公共结果与错误

定义稳定、无内部对象的公共结构，建议：

```ts
type ProjectSummary = {
  projectId: string;
  name: string;
  targetPlatform: string;
  projectRoot: string;
  manifestSchemaVersion: number;
  databaseSchemaVersion: number;
  assetCount: number;
  createdAtMs: number;
  updatedAtMs: number;
};
```

素材 summary 至少有 `assetId`、`fileName`、`absolutePath`、`kind`、`sizeBytes`、`modifiedAtMs`、`fingerprintAlgorithm` 和 `referenceStatus`。

错误至少覆盖：

- `DIALOG_CANCELLED` 或正常 cancelled result；
- `INVALID_PROJECT_NAME`；
- `INVALID_PROJECT_ROOT`；
- `UNSUPPORTED_PROJECT_LOCATION`；
- `PROJECT_DIRECTORY_NOT_EMPTY`；
- `PROJECT_ALREADY_EXISTS`；
- `PROJECT_NOT_FOUND`；
- `PROJECT_MANIFEST_INVALID`；
- `PROJECT_SCHEMA_TOO_NEW`；
- `PROJECT_DATABASE_MISSING`；
- `PROJECT_ID_MISMATCH`；
- `PROJECT_PATH_CONFLICT`；
- `PROJECT_NOT_ACTIVE`；
- `ASSET_NOT_FOUND`；
- `UNSUPPORTED_ASSET_TYPE`；
- `TOO_MANY_ASSETS`；
- `ASSET_CHANGED`；
- `ASSET_CHANGED_DURING_REFERENCE`；
- `FILE_ACCESS_DENIED`；
- `OPERATION_TIMEOUT`；
- `CORE_UNAVAILABLE`。

公共错误不包含 stack、SQL、Pydantic detail、Python executable、用户主目录或完整 manifest 内容。需要显示具体路径时，由成功 summary 或用户确认界面显示，不拼入错误日志。

## 自动化 project smoke

新增根命令：

```powershell
npm run project:smoke
```

必须验证真实主链路，但不能打开需要人工点击的 dialog。建议 Electron `--project-smoke` 模式由 Main 自己创建临时授权路径并走相同 controller/Worker/Core 服务：

1. 创建含空格和中文的临时空项目目录；
2. 创建一个很小的固定 `.mp4` 名称测试文件，内容无需是真实媒体；
3. Main 以“测试专用、源码固定”的授权适配器替代 dialog，生产代码路径不能接受命令行任意路径；
4. 通过真实 utilityProcess 和 Python Core 创建项目；
5. 引用测试素材并验证数据库记录；
6. 验证项目中不存在原视频副本，原文件 bytes、大小和 mtime 未改变；
7. 关闭 Worker/Core；
8. 启动新 Worker/Core，重新打开同一项目并读取素材；
9. 验证 project ID、manifest、数据库和 asset ID 保持一致；
10. 正常关闭所有进程，清理临时目录并自动退出。

成功退出码为 0，失败为非 0。不写 tracked report，不接受用户命令行路径，不触碰真实素材。

## 自动化测试要求

至少覆盖：

1. 在空目录创建完整标准结构、manifest、数据库和 project row；
2. manifest 使用原子写入，失败注入不会留下“看似成功”的项目；
3. 非空目录、卷根、已有 manifest、同名文件冲突均安全拒绝且不覆盖；
4. manifest 未知字段、错误类型、绝对 database 路径、`..`、过大文件、损坏 JSON 和未来版本被拒绝；
5. 打开项目时 manifest ID 与数据库 ID 不一致被拒绝；
6. 缺失 DB、损坏 DB、schema too new、foreign-key check 失败返回稳定错误；
7. 项目移动后按相同 ID 受控更新 root/revision，外部素材路径不改变；
8. 打开项目可补齐缺失的可再生目录，但不会覆盖同名文件；
9. dialog 取消不调用 Worker/Core且无文件副作用；
10. Renderer 不能把自行构造的路径放入 create/open/reference IPC；
11. sender/payload 校验和 preload 固定能力继续生效；
12. Worker 项目 operation 的正常、超时、崩溃、重复和 stale generation 行为；
13. Core RPC 新方法在 TypeScript/Python fixtures 上一致；
14. 多文件引用使用 canonical path、正确 stat 和稳定指纹；
15. 采样或流式 hash 内存有界，文件前后变化会被发现；
16. 重复引用相同文件返回 existing，不产生重复 row；
17. 已登记文件发生变化时不静默覆盖旧记录；
18. 批次一个文件失败时没有部分新增记录；
19. project A 的 asset 操作不能读写 project B；
20. 不支持扩展名、目录、设备或不可读文件被拒绝；
21. 引用前后外部文件内容、mtime 和大小不变，项目目录没有副本；
22. 包含空格、中文、引号和 Windows 大小写差异的路径正确处理；
23. Worker/Core 关闭后无孤儿 Python，数据库连接和 WAL 文件正确关闭；
24. 两个独立进程重新打开后项目与素材仍存在；
25. A01–A05 的类型检查、31 项以上 Node 测试、20 项以上 Python 测试、RPC/storage/Agent smoke 继续通过。

Windows 专属路径测试可按平台条件运行，但目标电脑上的完整验收不能跳过。

## 文档要求

新增 `docs/projects.md`，至少说明：

- 项目 create/open 调用链与 Main 路径授权边界；
- 标准目录和每个目录的用途；
- manifest schema、原子写入和版本策略；
- manifest、project row 和数据库之间的一致性规则；
- 项目移动处理方式；
- 外部素材只读引用、不复制原则；
- canonical path、轻量指纹、重复/变化检测和当前支持格式；
- 如何安全新增项目或素材 RPC；
- 如何运行 project smoke；
- 当前不支持自然语言路径、递归文件夹扫描、素材分析、最近项目和项目备份。

同步更新：

- `README.md` 的运行命令、产品演示步骤、目录说明和限制；
- `docs/electron-security.md` 的 dialog/path grant 边界；
- `docs/agent-worker.md` 的项目 operation 与 Core 生命周期；
- `docs/python-rpc.md` 的新增白名单方法和 session context；
- `docs/storage.md` 的受控 project root 更新与 A06 归属。

## 建议实施顺序

### 第 1 天：Core 项目模型与服务

- 完成 A05 migration discovery 排序加固；
- 定义 manifest、项目/素材模型与稳定错误；
- 实现项目路径检查、标准目录、原子 manifest；
- 实现 create/open/move 与 repository 最小扩展；
- 完成 Python 单元测试。

### 第 2 天：RPC、Worker 与 Electron 边界

- 增加 Core RPC 方法、双端 validators 和 fixtures；
- 把 `PythonCoreClient` 生命周期接入 Worker；
- 扩展 Worker protocol/controller pending operation；
- 增加 Main dialog handlers、受限 IPC/preload；
- 完成取消、超时、崩溃、stale response 和安全测试。

### 第 3 天：素材引用、UI 与端到端验证

- 实现多文件路径规范化、stat、指纹、去重和原子写入；
- 完成最小 Renderer 项目页；
- 实现跨 Worker/Core 重启的 `project:smoke`；
- 更新全部相关文档；
- 运行完整仓库验证，清理生成噪声，提交并交接。

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
npm run core:storage:smoke
npm run agent:smoke
npm run project:smoke
npm run dev
```

`npm run dev` 只需人工确认：窗口能创建/打开项目、取消 dialog 无异常、可选择测试素材并显示列表。不要用真实敏感项目作为交接证据。

并确认既有 spike 仍可独立运行：

```powershell
Set-Location .\spikes\pi-electron-bridge
npm run validate
```

运行 spike 后只恢复它生成的 runtime/session/report 噪声，不得覆盖用户或其他智能体的修改。

## 完成定义

- 用户可通过原生 Windows dialog 创建和打开本地项目；
- 标准目录、strict manifest、SQLite migration 和 project row 一致；
- 项目移动得到受控处理，不产生第二个 ID；
- 多个本地视频可作为只读外部路径引用登记；
- 重复、变化、批次失败和跨项目访问有明确语义；
- 外部视频未复制、未修改，hash 内存有界；
- Worker 正式复用 `PythonCoreClient`，Core 生命周期和退出无孤儿进程；
- Renderer 只拥有固定项目能力，不能传入任意项目/素材路径；
- 真实 Electron → Worker → Python → SQLite project smoke 可重复通过；
- 重启后通过 reopen 恢复同一项目和素材；
- A01–A05 全部回归通过；
- 文档完整；
- 没有真实项目、数据库、manifest、素材、WAL/SHM、路径、密钥、日志、缓存、dist 或测试报告进入提交。

## 禁止事项

- 不让 Renderer、Pi 或 Agent 自由传入磁盘路径；
- 不实现通用文件选择器、文件浏览器、任意 read/write 或 Core RPC invoke；
- 不复制、移动、重命名、转码或删除原始素材；
- 不递归扫描目录，不做媒体分析或缩略图；
- 不实现 A07 job 状态机、持久化进度或恢复；
- 不实现最近项目、自动打开、项目删除、备份、导入导出或云同步；
- 不实现聊天、真实 LLM、TTS、Embedding、FFmpeg、Whisper、Remotion 或剪映；
- 不修改 `0001_initial.sql`；如确需 schema 变化，先说明理由并新增 `0002`，不能改历史 checksum；
- 不把绝对路径、manifest、SQL、stack 或素材名称写入日志；
- 不提交 smoke 生成的项目目录、数据库或素材 fixture；
- 不为了测试对工作区或用户目录执行宽泛递归删除。

## 完成交接

提交后返回：

```text
任务：A06
分支：feat/a06-project-path-references
提交：<commit hash>
变更：<项目服务、manifest、RPC/Worker/IPC、素材引用、UI、smoke 和文档>
验证：<每条命令、实际 Python/SQLite/Electron 版本及结果>
限制：<尚未支持的自然语言路径、目录扫描、媒体分析或最近项目>
风险：<需要 Review 特别检查的路径授权、原子创建、移动、指纹、进程退出或外部文件安全问题>
```

不要自行合并 `main`，不要自行推送远程仓库。

---
