# A06 本地项目与外部素材引用

## 调用链与路径授权

项目操作只能由 Renderer 的固定按钮触发：

```text
Renderer button
  -> fixed preload method
  -> Main sender/payload validation
  -> Windows native directory/file dialog
  -> fixed Agent Worker project command
  -> PythonCoreClient
  -> allowlisted project.* / asset.* RPC
  -> manifest + SQLite repository
```

创建、打开和添加素材的 Renderer 请求不包含磁盘路径。路径只在 Main 中由当前窗口拥有的原生 dialog 产生，随后直接交给对应的受控 Worker 命令。没有通用 `filesystem.*`、`rpc.invoke`、`fs` 或任意 IPC channel。Worker project command 也不是 Pi tool。第一阶段拒绝 UNC 项目根目录和卷根目录；文件夹必须是用户选择的现有目录。

同一窗口只维护一个 active project。Core session 绑定已验证的 project ID；asset 请求仍携带 project ID，迟到结果由 operation ID、Worker generation 和 project ID 共同隔离。Worker 重启后 Core session 丢失，界面需要重新打开项目，不会自动扫描最近目录。

## 标准结构

```text
<project-root>/
├─ project.supervideo.json
├─ data/project.db
├─ cache/
├─ generated/
├─ previews/
├─ exports/videos/
├─ exports/jianying/
└─ logs/
```

`data` 保存数据库；`cache`、`generated`、`previews` 和 `exports` 是后续应用输出位置；`logs` 只保存脱敏诊断。A06 不创建 `materials`，不把原始素材复制进项目，也不创建虚拟环境、node_modules 或构建产物。

## Manifest 和一致性

`project.supervideo.json` 使用独立的 `schemaVersion: 1`，严格拒绝未知字段、错误类型、无效 UUID、绝对或带 `..` 的数据库路径。第一阶段 `database` 必须精确为 `data/project.db`。Manifest 以同目录临时文件写入、flush/fsync 后原子替换；创建时使用不覆盖语义。超过大小上限、损坏 JSON 或未来 schema 会返回稳定错误。

创建顺序是：路径和目录预检 → 标准目录 → SQLite migration → `projects` row → quick/foreign-key check → 最后写 manifest。失败清理只触及本次新建的数据库和空目录，不删除用户预先存在的内容。

打开时先读 manifest，再检查固定数据库路径、migration、quick/foreign-key check 和 project ID/name/platform。一致后补齐缺失的可再生目录。项目整体移动到新根目录时，manifest ID 与数据库 ID 必须匹配，Core 只更新 `projects.project_root`、`updated_at_ms` 和 revision，不改变 project ID；外部素材的绝对路径不会随项目移动自动变化。

## 外部素材引用

A06 只处理用户通过原生文件选择器显式选择的普通文件，不递归扫描目录。当前视频扩展名为 `.mp4`、`.mov`、`.mkv`、`.avi`、`.m4v` 和 `.webm`；扩展名不是媒体真实性验证，B01 才负责 ffprobe。

Core 将路径解析到 canonical regular file，登记大小、修改时间、`source_type=external` 和 `sampled-sha256-v1:<hex>` 指纹。指纹输入包含文件大小、首部和尾部固定采样块；采样块为 64 KiB，超过 128 KiB 的文件只定点读取首尾，避免整段视频进入内存。hash 前后 stat 不一致返回 `ASSET_CHANGED_DURING_REFERENCE`。

单批最多 100 个文件。所有文件先预检和指纹，再在一个事务中插入；一个文件失败不会留下部分新增记录。相同项目中 canonical path、size、mtime 和 fingerprint 都一致时返回 `existing`；同一路径元数据或指纹变化时返回 `ASSET_CHANGED`，不会静默替换。项目隔离由每个查询的 project ID 和 active session 强制执行。

## A07 reopen 与恢复

打开项目完成 SQLite migration 和 integrity check 后，Core 会激活该项目的
JobManager。JobManager 从 jobs/job_events 重建 incomplete job 的运行状态：
queued/retrying 重新入队，异常遗留的 running 验证 checkpoint 后转 retrying
并从已提交步继续，cancelling 收敛为 cancelled；未知 executor/version 或损坏
checkpoint 转 needs_attention。succeeded、failed、cancelled 和已经审计的
needs_attention 不会因为重复 open 被重新执行。项目切换前会先有界停止旧
manager，再关闭旧数据库，避免两个 manager 同时写同一 project。

## 新增 RPC 和扩展方式

Core RPC protocol 仍为 v1，因为 A06 只新增显式白名单方法：

- `project.create({ name, targetPlatform, projectRoot })`
- `project.open({ projectRoot })`
- `project.inspect({ projectRoot })`
- `asset.reference({ projectId, paths })`
- `asset.list({ projectId, limit })`

新增方法必须同时更新 Python registry、Pydantic 参数模型、共享 TypeScript runtime validator、golden fixtures、稳定错误映射和本文件。不得增加任意 SQL、路径读取、目录列举或通用 dictionary update。数据库仍是 schema version 1，`0001_initial.sql` 不可修改。

## Smoke 与当前限制

A07 extends the A06 project session with SQLite-backed persistent jobs. The
database is upgraded from schema version 1 to version 2 on open using the
immutable A06 migration history; see [docs/jobs.md](jobs.md) for the recovery,
cancel, retry and event-sequence contract.

```powershell
npm run project:smoke
```

该命令先使用当前 build，Electron 在 `--project-smoke` 测试模式中自行创建临时中文/空格项目目录和固定 `.mp4` fixture，走与生产相同的 Worker/Core/controller 链路。它验证创建、引用、SQLite 记录、原文件 bytes/size/mtime、Worker/Core 关闭、第二个 Worker reopen 和 asset ID 恢复，最后删除自己创建的临时树；不接受用户路径，不写 tracked 报告，不操作真实素材。

A06 不支持自然语言路径解析、Pi 自主选择磁盘路径、递归文件夹扫描、拖拽导入、ffprobe/转码/缩略图/ASR/VAD/镜头检测/向量化、A07 持久化 job、最近项目自动打开、项目删除/备份/导入导出、云同步或剪映草稿读取。
