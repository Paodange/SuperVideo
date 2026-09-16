# A07 持久化任务状态机

## 边界与事实来源

A07 的 job 由 Python Core 的 `JobManager` 管理，项目 SQLite 是状态、进度、
checkpoint 和事件的唯一事实来源。内存中的 `asyncio.Task`、cancel event 和
调度槽只是可丢弃的运行时缓存；Agent Worker、Electron Main 和 Renderer 不
直接写数据库，也不能传 SQL、executor 名称、Python 模块或命令行。

当前只注册一个固定的 `smoke.countdown` executor。它异步等待有限的短延迟，
每一步把进度、阶段和 checkpoint 原子写入 SQLite，不读写外部素材、不联网、
不启动子进程。`failAttempts: 1` 只在第一次 attempt 的固定中点失败，便于
稳定演示 retry。

## 状态与事务

`text
queued -> running -> succeeded
                 -> failed -> retrying -> running
                 -> cancelling -> cancelled
                 -> needs_attention
needs_attention -> retrying  (仅 checkpoint 可验证时)
`

终态是 `succeeded`、`failed`、`cancelled`、`needs_attention`。`succeeded` 和
`cancelled` 不可再操作；`failed` 和经过明确 checkpoint 验证的
`needs_attention` 可 retry，最多三次 attempt。running 取消必须先写
`cancelling` 和 cancel-request event，再在 executor 安全点收敛为 `cancelled`。
每次进入 `running` 增加 attempt；同一 attempt 的 progress 单调不减，新
attempt 从已提交 checkpoint 继续。终态由数据库写入 `finished_at_ms`。

job 创建或状态/进度/checkpoint 更新与对应 `job_events` append 都在同一个
`BEGIN IMMEDIATE` 事务中。事务成功提交后才调用 best-effort event listener，
因此通知丢失不会丢失任务事实。`jobs.revision` 用于 compare-and-swap，
`jobs.last_event_sequence` 必须和最后一条 job event 一致。`job_events` 只追加，
每个 job 的 sequence 从 1 严格递增；`project_id` 会在 SQL scope、外键和
触发器三处约束，项目删除只级联数据库行，不删除任何磁盘素材。

## 创建、队列和操作

`job.smoke.start` 只校验固定输入、检查同 project + job type 的
`idempotencyKey`，创建 `queued` row 与 `created` event 后立即返回 `jobId`。
相同 key 和相同规范化输入返回原 job；相同 key 但输入不同返回
`IDEMPOTENCY_CONFLICT`。单 active project 最大并发为 1，队列和 incomplete
job 数有上限 32，按 `created_at_ms, id` FIFO；超过上限返回 `JOB_QUEUE_FULL`。

Core RPC 的 `core.cancel` 只取消一个尚未完成的 RPC request，不影响已经返回
的持久化 job。持久化任务必须使用 `job.cancel`，其状态可由 `job.get` 确认。
`job.list` 和 `job.events.list` 都有最大 limit、稳定排序和 cursor；事件列表
支持 `afterSequence`，用于通知缺口补齐。

## checkpoint、关闭和恢复

checkpoint 带独立的 `executor`、`executorVersion`、`checkpointVersion`、
输入 steps、`completedSteps` 和 `nextStep`。新增 executor 必须先增加受控的
输入/输出模型、稳定版本号、checkpoint validator、明确的状态错误映射和
测试，再在 Python registry、shared TypeScript validator、Worker 命令白名单
和文档中登记；外部 API 只能调用固定方法，不能选择任意 executor。

正常关闭时 JobManager 停止接收新任务，通知 executor 到最近安全点，写入
checkpoint，并把可恢复的 running 转为 `retrying`，附带
`paused-for-shutdown` event。重新打开同一 project 会扫描
`queued/running/retrying/cancelling`：queued/retrying 重新排队，running 写
recovery event、增加 recovery count 后从 checkpoint 继续，cancelling 收敛
为 cancelled。未知 job/executor/version 或损坏 checkpoint 进入
`needs_attention`，不会猜测恢复；终态保持不变。reopen recovery 由数据库
revision 和 event sequence 保护，连续打开不会重复终态事件或重复执行。

## 实时事件与桌面链路

通知链路为 `core.job.event` → PythonCoreClient `onJobEvent()` → Worker
`job-event` → Main controller → 固定 preload `onJobEvent()`。每一层都做版本、
项目/job ID、sequence、payload 和大小校验，并去重旧 sequence。Renderer 打开
项目先读取有界 job 列表，再订阅事件；收到事件后读取最新摘要。若真实 UI
发生 sequence 缺口，应调用 `job.events.list(afterSequence)`，按持久化事件补齐，
不能把内存 sequence 当事实来源。项目切换或 Worker 重启后，旧 project 事件
被丢弃，重新 open 会从 SQLite 重建界面。

## 演示与限制

在仓库根目录执行：

`powershell
npm run core:setup
npm run build
npm run jobs:smoke
`

`jobs:smoke` 使用 Main 创建的临时项目，真实经过 Electron → utility Worker →
Python Core → SQLite，覆盖快速 start、进度、正常 shutdown/reopen、取消、
失败/retry、事件重建和清理。它不使用用户路径、真实素材、密钥或 tracked
报告。

A07 目前不包含真实媒体 executor、FFmpeg/Whisper/生成服务、跨机器恢复、
后台系统服务、通知中心或备份恢复。未来新增 executor 必须保持原始素材只读，
并为 executor/checkpoint 和对外契约提供兼容/迁移说明。
