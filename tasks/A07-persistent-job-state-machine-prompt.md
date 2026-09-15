# A07 开发任务提示词：持久化任务状态机

以下内容可直接交给负责 A07 的开发智能体。

---

你正在开发 `C:\Project\SuperVideo` 项目的 A07 工作包。开始前请完整阅读：

1. 根目录 `AGENTS.md`；
2. `docs/development-workflow.md`；
3. `docs/phase-1-technical-design.md`，重点阅读第 3、5、6、12、13、18.1、18.2 和 19 节；
4. `docs/agent-worker.md`；
5. `docs/python-rpc.md`；
6. `docs/storage.md`；
7. `docs/projects.md`；
8. 根目录 `README.md`；
9. A03 的 Worker 生命周期、事件序号、重启和取消实现；
10. A04 的 `PythonCoreClient`、RPC 通知/超时/取消与跨语言契约；
11. A05 的 `jobs` 表、事务、migration runner 和 repository；
12. A06 的 active project、Worker 项目操作、Main IPC/preload、Renderer 项目页与 project smoke。

## Git 要求

- 确认工作区干净，从最新 `main` 创建分支 `feat/a07-persistent-job-state-machine`；
- 所有实现、测试、文档和提交都在该分支完成；
- 不要合并 `main`，不要推送远程仓库；
- 不修改或重写 A01–A06 的提交历史；
- 完成后形成清晰的小提交，并按 `docs/development-workflow.md` 提供交接信息。

## A06 Review 必做跟进

开始正式 job 开发前，先用独立小提交完成两项加固：

1. **Worker 冷启动稳定性**
   - A06 Review 中，连续执行全套测试后 `agent:smoke` 偶发超过默认 5 秒 ready timeout，单独重跑可通过；
   - 测量并记录冷启动耗时，优先把 `PythonCoreClient`、项目/job 服务等重模块改成命令到来时动态加载，避免 ready 前加载与 smoke 无关的模块；
   - 如目标 Windows 环境仍可能超过 5 秒，可将默认 ready timeout 调整为有依据的值，并同步总 smoke timeout；
   - 不用“失败后脚本自动重试”掩盖首启问题；增加高负载/延迟 fake process 测试，保证最终策略确定且有界。

2. **Worker 出站消息统一校验**
   - A06 的 `project-operation-result` 当前直接调用 `parent.postMessage()`；改为统一通过 `send()` 或等价单一出口；
   - 所有 project/job result、error、event 在发送前都必须经过协议结构和 64 KiB 大小校验；
   - 超大结果返回稳定错误或使用有界分页，不能绕过校验，也不能让 Main 只能等到超时。

不得借此重写 A03–A06 架构。完成加固后继续 A07。

## 任务目标

在 Python Core 中建立可恢复的持久化任务系统，并把它通过现有 Core RPC、Agent Worker、Electron Main 和 Renderer 串起来：

- job 创建后立即返回稳定 `job_id`，长任务不占用一个等待到结束的 RPC request；
- job 状态、进度、阶段、checkpoint 和事件先原子写入项目 SQLite，再发送实时通知；
- UI 可查看 job 列表和事件，取消运行中任务，并重试允许重试的失败任务；
- Agent Worker、Python Core或应用退出后，再打开同一项目能根据数据库恢复任务；
- UI/Worker 漏掉实时通知时，可通过持久化 `job_events` 按 sequence 补齐；
- 用确定性模拟长任务验证成功、失败、取消、重试、checkpoint 和重启恢复；
- 不引入真实 FFmpeg、Whisper、生成服务或剪映操作。

完成后应能演示：打开项目 → 启动模拟长任务 → 看到流式进度 → 取消并确认持久化 → 启动另一个任务并在中途退出 Worker/Core → 重新打开项目 → 从 checkpoint 继续并成功 → 对一次模拟失败执行重试并成功。

## 核心原则

1. SQLite 是 job 状态和事件的唯一事实来源；内存状态只是运行时缓存。
2. 先提交数据库事务，再发布通知；不能出现 UI 显示了数据库中不存在的状态。
3. 实时 `job.event` 是 best effort；恢复和补漏必须读取 `job_events`。
4. 每个状态变化只能通过状态机服务完成，禁止任意 `set_status(string)`。
5. checkpoint 属于确定性 executor，并带独立版本；未知 executor/checkpoint 不猜测恢复。
6. job 取消与 A04 的 RPC request 取消是两层概念：RPC 超时不能自动把已创建的持久化 job 标记取消。
7. Agent/Renderer 不直接写数据库，不传 SQL、executor 模块名、命令行或任意代码。
8. 原始素材依旧只读；A07 模拟任务不得修改素材。

## 状态机

使用技术方案中的状态集合：

```text
queued → running → succeeded
              ↘ failed → retrying → running
              ↘ cancelling → cancelled
              ↘ needs_attention
```

允许的第一阶段转换必须集中定义并自动测试，建议：

- `queued -> running`；
- `queued -> cancelled`；
- `running -> succeeded`；
- `running -> failed`；
- `running -> cancelling`；
- `running -> retrying`：进程正常退出前保存 checkpoint；
- `running -> needs_attention`：无法安全恢复；
- `cancelling -> cancelled`；
- `cancelling -> needs_attention`：取消结果无法确认时；
- `failed -> retrying`；
- `needs_attention -> retrying`：仅在 executor 明确允许且 checkpoint 可验证时；
- `retrying -> running`；
- `retrying -> failed/needs_attention`：重启执行失败。

终态：`succeeded`、`failed`、`cancelled`、`needs_attention`。其中 `failed` 可按策略重试；`needs_attention` 只有明确可恢复原因才允许重试。

要求：

- 非法转换返回 `JOB_STATE_CONFLICT`，数据库不变；
- 同状态重复 cancel 等幂等操作返回当前状态，不重复写终态事件；
- `succeeded` 不允许 cancel/retry；
- 第一阶段不允许直接 retry `cancelled`，用户应创建新任务；
- 每次进入 `running` 增加 `attempt`；进程恢复同一 checkpoint 是否算新 attempt 必须统一。建议算新 attempt，便于审计；
- `progress` 只能单调不减，除非开始了新的 attempt；新 attempt 从 checkpoint 对应进度继续，不能倒退到 0；
- terminal job 必须有 `finished_at_ms`，非 terminal 不应伪造完成时间；
- `cancelling` 必须是可观察状态，不能从 running 直接跳 cancelled 而完全不留 cancel-request 事件。

## 数据库 migration `0002`

不得修改 A05 的 `0001_initial.sql`。新增严格递增的 `0002_persistent_jobs.sql`，并更新 `DATABASE_SCHEMA_VERSION`。

### 扩展 `jobs`

建议新增：

- `checkpoint_json TEXT`；
- `checkpoint_version INTEGER`；
- `executor_version INTEGER NOT NULL DEFAULT 1`；
- `revision INTEGER NOT NULL DEFAULT 0`；
- `last_event_sequence INTEGER NOT NULL DEFAULT 0`；
- `cancel_requested_at_ms INTEGER`；
- `recovery_count INTEGER NOT NULL DEFAULT 0`；

可根据现有 schema 调整，但必须能支持 compare-and-swap、checkpoint 校验、严格事件序号和恢复审计。

### 新建 `job_events`

至少包含：

- `id TEXT PRIMARY KEY`；
- `project_id TEXT NOT NULL`；
- `job_id TEXT NOT NULL`；
- `sequence INTEGER NOT NULL CHECK(sequence >= 1)`；
- `event_type TEXT NOT NULL`；
- `status TEXT NOT NULL`；
- `progress REAL NOT NULL CHECK(progress >= 0 AND progress <= 1)`；
- `stage TEXT`；
- `attempt INTEGER NOT NULL CHECK(attempt >= 0)`；
- `payload_json TEXT NOT NULL`；
- `created_at_ms INTEGER NOT NULL`；
- 外键到 project/job，并对项目删除使用仅限数据库行的级联；
- `UNIQUE(job_id, sequence)`；
- 支持 `project_id + created_at_ms` 和 `job_id + sequence` 查询的索引。

要求：

- job row 更新与对应 event append 在同一个 `BEGIN IMMEDIATE` 事务中；
- event 只追加，repository 不提供 update；
- 删除 project 时可以级联数据库记录，但绝不删除任何磁盘素材；
- JSON 使用 A05 的确定性、有界、安全序列化；
- migration fresh、从 v1 升级、no-op、checksum、rollback、future-version 测试全部覆盖；
- A06 已对 migration discovery 显式排序，不得移除该保证。

## Job repository 与原子转换

不要在现有 `JobRepository` 上增加通用字段更新。新增受控能力，建议：

- `create_job_with_event(...)`；
- `transition(expected_revision, from_statuses, to_status, ...)`；
- `append_progress_and_checkpoint(...)`；
- `get(project_id, job_id)`；
- `list_for_project(project_id, statuses?, cursor?, limit?)`；
- `list_events(project_id, job_id, after_sequence, limit)`；
- `find_incomplete(project_id)`；
- `find_by_idempotency_key(project_id, job_type, key)`。

具体要求：

- 更新 SQL 包含 `project_id`、`job_id`、允许的当前状态和 expected revision；
- 受影响行数不是 1 时返回状态冲突并重新读取当前状态；
- sequence 在事务内从 `last_event_sequence + 1` 生成；
- job row 的 `last_event_sequence` 必须与最后一条 event 一致；
- progress、checkpoint、状态和 event 不允许分开提交；
- 列表有稳定排序、cursor 和最大 limit，不能无限返回；
- project A 无法读取/更新 project B 的 job/event；
- idempotency key 同 project + job type 唯一；
- 相同 key 与相同规范化输入返回已有 job；相同 key 但输入不同返回 `IDEMPOTENCY_CONFLICT`；
- row 转换继续用严格模型校验，损坏 checkpoint/event 返回稳定错误。

## 固定模拟 executor

只实现一个无副作用 executor，例如 `smoke.countdown`：

```json
{
  "steps": 8,
  "delayMs": 150,
  "failAttempts": 0
}
```

要求：

- 参数严格校验并有小范围上限；
- 每一步使用异步等待，不阻塞 RPC stdin/event loop；
- 每一步提交新的 progress、stage、checkpoint 和 `job.progress` event；
- checkpoint 至少记录 executor/checkpoint version、下一步或已完成步数；
- 恢复时从最后一个已提交 checkpoint 继续，不重复已提交进度；
- `failAttempts: 1` 表示第一次 attempt 在固定步骤失败，retry 后可成功，用于稳定测试；
- executor 定期检查专属 cancel event；
- 取消不影响其他 job 或 RPC；
- 不读写项目外部素材，不联网，不启动子进程，不休眠线程；
- 不接受任意 executor 名称。外部只能调用固定的 `job.smoke.start`。

## Job manager 与调度

在 Python Core 中建立独立 `jobs` 模块，建议：

```text
jobs/
  models.py
  errors.py
  state_machine.py
  repository.py
  executors.py
  manager.py
```

第一阶段每个 active project 最大并发 job 数设为 1，队列按 `created_at_ms, id` 确定排序。要求：

- `start` 只创建/入队并快速返回，不等待任务完成；
- scheduler 从 SQLite queued/retrying 记录启动任务；
- manager 持有 `job_id -> asyncio.Task/cancel Event`，但不能把它当成事实来源；
- 启动任务前用原子 transition 抢占，防止重复执行；
- 完成、失败、取消都在 finally 路径清理内存槽位并调度下一项；
- event listener 失败不能回滚已提交数据库状态，也不能杀死 executor；
- 队列和活动数有明确上限，超过返回 `JOB_QUEUE_FULL`；
- 切换项目时先执行有界 checkpoint/shutdown，再关闭 A06 active database；
- 不允许两个 ProjectService/JobManager 同时写同一个项目数据库；若检测到第二实例，返回稳定冲突或依赖 SQLite lock，行为必须测试和说明。

## 关闭与恢复语义

### 正常关闭

当应用、Worker 或 Core 正常关闭：

- 停止接受新 job；
- 通知活动 executor 在最近安全点停止；
- 原子保存最终 checkpoint；
- 将可恢复的 `running` 转为 `retrying` 并写 `job.paused_for_shutdown` 或等价事件；
- 有限时间等待；超时后退出，但不得把任务错误标为 succeeded/cancelled；
- 关闭数据库和 stdout 前尽量 flush 已提交事件。

### 异常退出恢复

重新 `project.open` 时扫描 `queued/running/retrying/cancelling`：

- `queued`：重新入队；
- `retrying`：验证 executor/checkpoint 后重新运行；
- `running`：视为上次进程异常中断，写 recovery event，增加 recovery count，并从 checkpoint 恢复；
- `cancelling`：底层模拟 executor 已随旧进程结束，应原子收敛为 `cancelled`；
- 未知 job type、未知 executor version、未知 checkpoint version、损坏 checkpoint：转 `needs_attention`，写稳定原因；
- terminal 状态保持不动，不重复发布终态事件。

恢复过程必须幂等。连续打开同一项目不能重复增加成功事件、重复启动同一个 job 或重复推进 sequence。

## 取消

调用 `job.cancel`：

- 必须包含 active `projectId` 与 `jobId`；
- queued job 在一个事务中直接变为 cancelled，并写 requested/cancelled 事件或一个语义明确的 cancelled event；
- running job 先持久化 `cancelling` 与 cancel-request event，再设置内存 cancel signal；
- executor 到安全点后持久化 `cancelled`；
- 重复 cancel 返回当前摘要，不重复事件；
- 错误 project/job ID 不影响活动任务；
- cancel RPC request 自己超时后，调用方需用 `job.get` 确认最终状态；不能推断 job 未取消；
- 终态之后到达的迟到 progress/success 必须被 revision/状态条件拒绝。

## 重试

调用 `job.retry`：

- 第一阶段仅允许 `failed`，以及有明确 recoverable reason 的 `needs_attention`；
- 不修改原始 `input_json`、project_id、job_type 或 idempotency key；
- 写 `retrying` 状态与 event，随后由 scheduler 进入 running；
- attempt 在实际进入 running 时增加；
- 重试不能删除旧 events/checkpoint；新 attempt 继续全局 event sequence；
- 达到固定最大 attempts 时返回 `JOB_RETRY_LIMIT` 或转 `needs_attention`；
- 并发重复 retry 只能有一个成功转换。

## Core RPC

在 A04 registry 中显式新增：

- `job.smoke.start`；
- `job.get`；
- `job.list`；
- `job.events.list`；
- `job.cancel`；
- `job.retry`。

新增 server → client 通知：

- `core.job.event`。

每个 params/result/event 都有严格 Pydantic 与 TypeScript runtime validator，并进入双端 golden fixtures。建议结构：

```ts
type JobSummary = {
  jobId: string;
  projectId: string;
  jobType: "smoke.countdown";
  status: JobStatus;
  progress: number;
  stage: string | null;
  attempt: number;
  revision: number;
  lastEventSequence: number;
  createdAtMs: number;
  updatedAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  errorCode: string | null;
};
```

实时 event 至少包含 `projectId`、`jobId`、`sequence`、`eventType`、`status`、`progress`、`stage`、`attempt`、`timestamp` 和有界 payload。

要求：

- job start 快速返回，不把后台 job 绑在 RPC pending map；
- `PythonCoreClient` 增加固定 `onJobEvent()` 订阅，不暴露通用 notification；
- 未知、超大、错误项目、倒序或 malformed 通知被拒绝；
- 通知丢失不影响 job 执行；调用 `job.events.list(afterSequence)` 可补齐；
- Core RPC v1 若只新增方法/通知可保持版本；改变既有语义则升级并写兼容说明；
- `core.cancel` 仍只取消当前 RPC request，不能代替 `job.cancel`。

## Worker 协议与 Main controller

新增固定命令：

- `job-smoke-start`；
- `job-get`；
- `job-list`；
- `job-events-list`；
- `job-cancel`；
- `job-retry`。

新增固定消息：

- `job-operation-result`；
- `job-operation-error`；
- `job-event`。

要求：

- 每次操作使用 `operationId`，快速 request/response 与长期 job event 分离；
- 所有出站消息统一经过结构和 64 KiB 校验；
- list/events 使用 cursor/afterSequence + limit，保证单消息有界；
- controller 管理 pending job operation 的 timeout、Worker crash 和 stale generation；
- `job-event` 按 projectId/jobId/sequence 校验与去重后转发；
- Worker/Core 重连后从持久化 events 补漏，不假设内存 sequence 连续；
- project 切换或 Worker 重启后，不把旧项目事件发给当前项目 UI；
- 不把 job 输入全文、checkpoint、Python stack 或数据库 row 原样送到 Main/Renderer；
- 保留 A03 smoke run API，不把其 `runId` 与持久化 `jobId` 混为同一概念。

## Electron IPC、preload 与 Renderer

增加固定能力，名称可按现有风格调整：

```ts
startSmokeJob(input): Promise<JobSummary>
getJob(input): Promise<JobSummary>
listJobs(input): Promise<JobPage>
listJobEvents(input): Promise<JobEventPage>
cancelJob(input): Promise<JobSummary>
retryJob(input): Promise<JobSummary>
onJobEvent(listener): () => void
```

要求：

- 每个请求都含 `projectId`；job 操作还含 `jobId`；
- start 含用户动作生成的 idempotency key，重复点击不会创建两个 job；
- preload 固定且 frozen，不暴露 generic IPC；
- Main 继续验证 sender 与 strict payload；
- Renderer 事件再次运行时校验，unsubscribe 有效；
- 页面显示当前项目的有界 job 列表、status、progress、stage、attempt 和最后更新时间；
- running/queued 显示取消按钮，failed 显示重试按钮；
- UI 收到 event 后按 sequence 更新，发现缺口调用 `job.events.list` 补齐；
- 打开项目先拉持久化列表，再订阅实时事件，处理“拉取和订阅之间”的竞态；
- 项目切换时取消订阅、清空旧状态，并忽略迟到结果；
- 不需要正式任务中心、通知系统、聊天 UI 或复杂设计。

## 稳定错误

至少覆盖并在 Python/TS 两端一致：

- `JOB_NOT_FOUND`；
- `JOB_STATE_CONFLICT`；
- `JOB_NOT_CANCELLABLE`；
- `JOB_NOT_RETRYABLE`；
- `JOB_RETRY_LIMIT`；
- `JOB_QUEUE_FULL`；
- `JOB_EXECUTOR_UNAVAILABLE`；
- `JOB_CHECKPOINT_INVALID`；
- `JOB_EVENT_GAP`；
- `IDEMPOTENCY_CONFLICT`；
- `JOB_SHUTTING_DOWN`；
- 既有 `PROJECT_NOT_ACTIVE`、数据库/RPC/Worker 错误。

公共错误不能包含 checkpoint、input JSON、SQL、路径、stack 或内部异常文字。数据库中可保存稳定 `error_code` 与安全摘要，不保存完整 traceback。

## 自动化 `jobs:smoke`

新增根命令：

```powershell
npm run jobs:smoke
```

必须走真实 Electron Main → utilityProcess Worker → Python Core → SQLite 链路，使用 Main 创建的临时项目路径，不打开人工 dialog：

1. 创建并打开临时项目；
2. 启动一个 8 步模拟 job，start 调用快速返回；
3. 等到至少两条 progress 已持久化；
4. 正常关闭第一组 Worker/Core，验证 job 被 checkpoint 为可恢复状态；
5. 启动新 Worker/Core并重新打开同一项目；
6. 验证从 checkpoint 之后继续，最终 succeeded，event sequence 全局递增且只有一个 succeeded；
7. 启动第二个 job，在 progress 后 cancel，观察 cancelling → cancelled；
8. 再次 reopen，确认 cancelled 不会恢复执行；
9. 启动 `failAttempts: 1` job，确认第一次 failed，调用 retry 后 succeeded 且 attempt 增加；
10. 使用 list/events 从数据库重建摘要，结果与实时事件一致；
11. 关闭所有进程和数据库并清理临时目录。

再用 Python 集成测试覆盖“异常进程退出时仍为 running”的恢复路径。smoke 成功退出 0，失败非 0，不写 tracked report，不使用真实素材或用户路径。

## 自动化测试要求

至少覆盖：

1. `0001 -> 0002` 升级、fresh v2、no-op、checksum、rollback 和 too-new；
2. jobs 新字段默认值与旧 A05 row 兼容；
3. job row + event 的原子提交，失败时一起 rollback；
4. 所有合法状态转换与所有非法转换；
5. compare-and-swap revision 防止两个并发完成/取消；
6. event sequence 唯一、递增，并与 job `last_event_sequence` 一致；
7. event list 的 afterSequence、cursor、limit、排序和项目隔离；
8. start 快速返回、队列上限和单并发 FIFO；
9. 相同 idempotency key + 相同输入返回原 job；不同输入冲突；
10. countdown success 的进度/checkpoint 单调且终态完整；
11. queued cancel、running cancel、重复 cancel、错误 job ID；
12. cancel 后迟到 progress/success 不能覆盖 cancelled；
13. `failAttempts: 1` 首次失败，retry 后成功，旧事件保留；
14. 不可重试终态和 retry limit；
15. 正常关闭把可恢复 job checkpoint 为 retrying；
16. reopen 恢复 queued/retrying/running，并从 checkpoint 继续；
17. reopen 将 cancelling 收敛为 cancelled；
18. 未知 executor/checkpoint/version 转 needs_attention；
19. 连续执行 recovery 幂等，不重复 task/终态事件；
20. Python Core 突然退出后 DB 状态不损坏；
21. Core job notification strict validation、乱序、重复、超大和未知 job；
22. PythonCoreClient 订阅/取消订阅和 RPC timeout 与 job 生命周期解耦；
23. Worker job operation timeout、崩溃、旧 generation 和消息上限；
24. Main/preload sender、payload、unsubscribe 和无 generic channel；
25. Renderer project 切换、事件缺口补齐和迟到事件丢弃；
26. `agent:smoke` 冷启动不再偶发超时，脚本不靠重试；
27. A01–A06 的 Node/Python 测试以及 RPC、storage、agent、project smoke 全部继续通过。

时间相关测试使用可注入 clock/sleeper，避免大量真实 sleep；至少保留一个真实跨进程时序 smoke。

## 文档要求

新增 `docs/jobs.md`，至少说明：

- SQLite 是唯一事实来源；
- 状态转换图与终态；
- jobs/job_events/checkpoint/revision 的关系；
- transaction-before-notification 原则；
- idempotency、队列、并发和 retry 规则；
- RPC request cancel 与持久化 job cancel 的区别；
- 正常关闭、异常退出、reopen recovery 和 needs_attention；
- event sequence、实时订阅与断线补漏；
- 如何安全新增一个 executor；
- 如何运行 `jobs:smoke`；
- 当前只含模拟 executor，不含真实媒体任务、跨机器恢复或后台系统服务。

同步更新：

- `README.md` 的命令、演示流程和限制；
- `docs/storage.md` 的 `0002`、job_events 和迁移说明；
- `docs/projects.md` 的 reopen/recovery 行为；
- `docs/python-rpc.md` 的 job methods/notification；
- `docs/agent-worker.md` 的 job 事件转发、Core shutdown 和冷启动策略；
- `docs/electron-security.md` 的新增固定 IPC 能力。

## 建议实施顺序

### 第 1 天：持久化状态机

- 完成 A06 两项 Review 加固；
- 新增 `0002`、models、job_events repository 与原子 transition；
- 实现合法转换、idempotency、pagination 和数据库测试；
- 实现模拟 executor、checkpoint 与 JobManager。

### 第 2 天：取消、重试与恢复

- 实现 scheduler、单并发队列、cancel 和 retry；
- 实现正常关闭 checkpoint 和 reopen recovery；
- 覆盖异常退出、cancelling、未知 executor/checkpoint 和幂等恢复；
- 完成 Core RPC methods、job notification 和跨语言契约。

### 第 3 天：桌面链路与 Gate A 演示

- 扩展 Worker/controller、Main IPC/preload 和最小 jobs UI；
- 实现实时事件与持久化补漏；
- 完成真实 `jobs:smoke`；
- 更新文档，运行完整回归，清理生成噪声并提交。

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
npm run jobs:smoke
npm run dev
```

`npm run dev` 人工确认：打开测试项目、启动任务、看到进度、取消、重试；重开项目后状态正确。不要使用真实敏感项目作为证据。

并确认既有 spike 仍可独立运行：

```powershell
Set-Location .\spikes\pi-electron-bridge
npm run validate
```

运行 spike 后只恢复它生成的 runtime/session/report 噪声，不得覆盖用户或其他智能体的修改。

## 完成定义

- `0002` migration 安全升级且不修改历史 migration；
- job 状态、checkpoint 和 event 使用同一原子事务；
- start 快速返回，模拟长任务在 Core 后台执行；
- 成功、失败、取消、重试和 needs_attention 状态符合转换表；
- 正常关闭和异常退出后可通过 reopen 从 SQLite 恢复；
- 实时通知丢失后能按 sequence 补齐；
- idempotency、revision、项目隔离和消息大小限制生效；
- Worker 冷启动和统一出站校验问题得到加固；
- Renderer 可查看、取消和重试当前项目的模拟 job；
- 真实 Electron→Worker→Core→SQLite `jobs:smoke` 可重复通过；
- A01–A06 全部回归通过；
- 文档完整；
- 没有真实项目、数据库、WAL/SHM、素材、密钥、路径、Prompt、日志、缓存、dist 或测试报告进入提交。

## 禁止事项

- 不实现真实 FFmpeg、Whisper、ASR、Remotion、AI 生成或剪映 job；
- 不实现 A08 safeStorage、API Key、完整诊断包或日志导出；
- 不实现 Windows 后台服务、系统开机启动、跨机器队列或云调度；
- 不让 Renderer/Agent 提供任意 job type、executor、Python模块、命令行或 SQL；
- 不把长任务 Promise 绑定到单次 RPC 直到完成；
- 不仅依靠实时事件保存状态；
- 不把内存 Map 当作任务事实来源；
- 不直接从 running 跳 cancelled 而不持久化取消意图；
- 不修改 `0001_initial.sql` 或其他历史 migration；
- 不删除旧 job events/checkpoint 来实现 retry；
- 不让一个项目访问另一个项目的 job/event；
- 不提交 smoke 生成的项目、数据库、事件记录或素材；
- 不用放宽安全校验、无限 timeout 或测试重试掩盖竞态。

## 完成交接

提交后返回：

```text
任务：A07
分支：feat/a07-persistent-job-state-machine
提交：<commit hash>
变更：<0002、状态机、JobManager、executor、RPC/Worker/IPC/UI、smoke 和文档>
验证：<每条命令、实际 Python/SQLite/Electron 版本及结果>
限制：<尚未包含的真实媒体 executor、后台服务或跨机器恢复>
风险：<需要 Review 特别检查的事务、revision、事件顺序、取消竞态、shutdown/recovery 或冷启动问题>
```

不要自行合并 `main`，不要自行推送远程仓库。

---
