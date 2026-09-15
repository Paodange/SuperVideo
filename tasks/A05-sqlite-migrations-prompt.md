# A05 开发任务提示词：SQLite 与迁移

以下内容可直接交给负责 A05 的开发智能体。

---

你正在开发 `C:\Project\SuperVideo` 项目的 A05 工作包。开始前请完整阅读：

1. 根目录 `AGENTS.md`；
2. `docs/development-workflow.md`；
3. `docs/phase-1-technical-design.md`，重点阅读第 3、5.4、6、7、12、13、14、18.1、18.2 和 19 节；
4. `docs/python-rpc.md`；
5. 根目录 `README.md`；
6. A04 的 Python Core 包、Pydantic 模型、错误结构、测试脚本和解释器解析方式；
7. A04 的 `PythonCoreClient`，理解未来 Agent 调用 Core 的边界，但本任务不要扩展 Renderer IPC；
8. 现有测试和任务提示词，确保不破坏 A01–A04 的验收结果。

## Git 要求

- 确认工作区干净，从最新 `main` 创建分支 `feat/a05-sqlite-migrations`；
- 所有实现、测试、文档和提交都在该分支完成；
- 不要合并 `main`，不要推送远程仓库；
- 不修改或重写 A01–A04 的提交历史；
- 完成后形成清晰提交，并按 `docs/development-workflow.md` 提供交接信息。

## 任务目标

为 Python Core 建立正式、可迁移、可测试的 SQLite 存储底座：

- 提供统一数据库连接配置和事务边界；
- 建立版本化 migration runner，支持全新建库、增量升级、重复启动和失败回滚；
- 建立 `projects`、`assets`、`jobs`、`messages`、`timeline_versions` 五类基础业务表；
- 提供参数化、类型明确的最小 repository API；
- 保证 Timeline IR 版本只追加、不原地覆盖；
- 用真实临时 SQLite 文件证明关闭并重新启动 Python 进程后数据仍然存在；
- 为 A06 项目创建/路径引用和 A07 持久化任务状态机提供稳定扩展点。

本任务不开发项目管理 UI，不让 Agent 传入任意数据库路径，也不实现正式 job 状态机。完成后应能从仓库根目录运行存储 smoke：在临时项目目录建库、执行迁移、写入固定测试数据、关闭进程、用第二个 Python 进程重新打开并验证数据，最后安全清理临时目录。

## 数据库拓扑决定

第一阶段采用“每个 SuperVideo 项目一个数据库”：

```text
<project-root>/
  project.supervideo.json   # A06 创建
  data/
    project.db              # A05 定义格式
```

A05 只实现“给定一个由可信启动层确定的数据库文件路径，安全打开并迁移”的 Python 内部能力。A06 才负责创建项目目录、解析用户选择的路径以及确认 `project.db` 位于项目根目录内。

要求：

- 数据库路径不能作为通用 RPC 方法参数暴露给 Agent；
- repository 不自行猜测当前工作目录，也不使用用户主目录作为隐式存储位置；
- 测试和 smoke 使用 `tempfile`/Node 临时目录，不触碰真实项目或素材；
- 数据库文件之外的原始素材始终只读引用，本任务不复制、移动、重命名或删除视频；
- 不建立全局项目索引库；如未来需要，另行设计，不能混入项目数据库迁移。

## 技术选择

- 使用 Python 标准库 `sqlite3`，A05 不引入 SQLAlchemy、Alembic 或其他 ORM；
- 使用显式 SQL 和小型 repository，保持迁移内容可审计；
- 数据库 schema 单独版本化，例如 `DATABASE_SCHEMA_VERSION = 1`；
- 数据库 schema 版本与 A04 RPC 协议版本、Timeline IR `schemaVersion` 是三套不同概念，不得复用同一个常量；
- ID 使用应用生成的稳定字符串 UUID（建议 UUID4 小写规范格式），不得依赖自增 ID 作为跨边界资源标识；
- 时间字段统一存 UTC Unix epoch milliseconds，字段名以 `_at_ms` 结尾；
- 布尔值在 SQLite 中存 `INTEGER NOT NULL CHECK(value IN (0,1))`；
- JSON 存为 UTF-8 `TEXT`，写入前必须确认是 JSON-safe 值并使用确定性序列化；
- 不把 Pydantic 模型、Python对象或 pickle 直接写入数据库。

## 建议目录

在 `services/core/src/supervideo_core` 下建立独立存储模块，建议：

```text
storage/
  __init__.py
  database.py        # 连接、PRAGMA、事务与关闭
  errors.py          # 稳定存储错误
  models.py          # Pydantic/typed domain records
  migrations.py      # 发现、校验和执行 migration
  repositories.py   # 五类最小 repository
  smoke.py           # 可执行、无用户数据的存储 smoke
  sql/
    0001_initial.sql
```

允许根据现有风格调整拆分，但不能把建表 SQL、连接管理、业务仓储和 smoke 全塞进一个脚本。SQL migration 必须作为 Python 包数据正确包含，不能只在源码目录运行时碰巧找到。

## SQLite 连接配置

每次正式打开连接都必须设置并验证：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

具体要求：

- `foreign_keys` 必须对每个连接启用，测试证明约束实际生效；
- 记录并验证 `journal_mode` 的返回值；临时/只读环境不支持 WAL 时返回结构化存储错误，不能悄悄改变耐久策略；
- 所有 SQL 值使用参数绑定，不拼接用户值；
- 表名、列名和 migration 名只来自源码常量，不接受外部输入；
- 写操作有明确事务，异常时 rollback；
- 多步骤写操作使用 `BEGIN IMMEDIATE` 或等价的确定性事务策略；
- 连接、cursor 和事务均能在异常路径关闭/清理；
- 不允许 repository 持有无界 cursor、隐式全局连接或跨线程共享未保护连接；
- 对 `database is locked`、磁盘满、只读文件和损坏库映射稳定错误，不向上暴露原始路径或 SQL；
- 提供 `PRAGMA foreign_key_check` 和 `PRAGMA quick_check`/`integrity_check` 的诊断方法，但不要自动修复或删除损坏数据。

如果使用一个连接配合锁，必须明确线程模型并测试；如果每个操作创建短连接，也必须保证 PRAGMA 和事务在每个连接上正确应用。不要依赖 `check_same_thread=False` 来掩盖并发设计不清。

## Migration runner

### Migration 记录表

建立 `schema_migrations`，至少包含：

- `version INTEGER PRIMARY KEY`；
- `name TEXT NOT NULL`；
- `checksum TEXT NOT NULL`；
- `applied_at_ms INTEGER NOT NULL`。

要求：

- migration 按严格递增整数版本执行；
- 文件名或注册项包含固定版本与名称，例如 `0001_initial`；
- checksum 使用稳定算法（建议 SHA-256）；
- 计算 checksum 前统一换行，避免 Windows CRLF 与 LF 导致跨机器误报；
- 已应用 migration 的版本、名称或 checksum 与代码不一致时立即失败；
- 数据库存在高于当前程序支持的版本时返回 `SCHEMA_TOO_NEW`，禁止降级或继续写；
- 缺号、重复版本、乱序或同版本不同内容必须在执行前失败；
- 重复打开已是最新版本的数据库是无副作用 no-op；
- migration 与其 `schema_migrations` 记录在同一原子事务中；
- 失败 migration 必须完整 rollback，不能留下半张表或已提升版本号；
- runner 不删除、重命名或覆盖数据库文件，不自动从备份恢复；
- 已合入的历史 migration 不允许修改；未来只能新增更高版本。

注意 Python `sqlite3.executescript()` 的隐式提交行为。若使用它，必须用测试证明 migration 和版本记录真正原子；否则使用可控的 SQL statement 执行方式或 Python migration callable。不能只在 happy path 上看起来成功。

## 初始 schema

所有业务表至少包含 `id TEXT PRIMARY KEY`、`created_at_ms`；可变记录还应包含 `updated_at_ms`。字段命名用 snake_case。

### 1. `projects`

至少包含：

- `id`；
- `name`；
- `project_root`：规范化绝对路径，仅由未来可信项目层写入；
- `target_platform`：第一阶段默认 `douyin`，但不可硬编码为唯一值；
- `config_json`：项目级配置，不含密钥；
- `created_at_ms`、`updated_at_ms`；
- 可选 `revision`，用于未来乐观并发控制。

约束：项目根目录唯一；项目配置不得存 API Key、访问令牌或 DPAPI 密文。A08 的密钥只会保存 credential reference。

### 2. `assets`

至少包含：

- `id`、`project_id`；
- `absolute_path`；
- `kind`；
- `size_bytes`、`modified_at_ms`；
- `content_fingerprint`；
- `source_type`；
- `license_json`、`metadata_json`；
- `created_at_ms`、`updated_at_ms`。

约束：

- `project_id` 外键指向 `projects`；
- 同一项目的规范化绝对路径唯一；
- `size_bytes >= 0`；
- 本任务只存元数据，不扫描文件、不计算真实指纹、不复制素材；
- 外部素材变更检测和缺失处理属于 A06/B 组，不在 A05 实现。

### 3. `jobs`

建立可供 A07 扩展的基础记录，至少包含：

- `id`、`project_id`；
- `job_type`；
- `status`；
- `progress`；
- `stage`；
- `input_json`、`result_json`；
- `error_code`；
- `idempotency_key`；
- `attempt`；
- `created_at_ms`、`updated_at_ms`、`started_at_ms`、`finished_at_ms`。

`status` 可先限制为技术方案中的集合：`queued`、`running`、`succeeded`、`failed`、`retrying`、`cancelling`、`cancelled`、`needs_attention`。但 A05 repository 不实现状态流转规则，只允许创建和读取基础记录，避免提前做出能绕过 A07 状态机的通用 `set_status(any)` API。

约束：`progress` 在 0–1；`attempt >= 0`；有幂等键时建议按项目、任务类型和 key 唯一。不要在 A05 实现重试调度器、checkpoint 或 job event。

### 4. `messages`

至少包含：

- `id`、`project_id`；
- `conversation_id`；
- `sequence`；
- `role`；
- `message_type`；
- `content_json`；
- `created_at_ms`。

约束：同一 `conversation_id` 的 sequence 唯一且大于等于 1；role 使用明确集合，例如 `user`、`assistant`、`tool`、`system`。消息只追加，不提供原地覆盖正文的方法。A05 不持久化真实 Prompt 或用户对话，只用固定无敏感测试数据验证结构。

### 5. `timeline_versions`

至少包含：

- `id`、`project_id`；
- `version_number`；
- `parent_version_id`；
- `schema_version`：Timeline IR 自身版本，不是数据库版本；
- `timeline_json`；
- `edit_intent_json`；
- `diff_summary_json`；
- `created_at_ms`。

约束：

- 同一项目 `version_number` 唯一且从正整数开始；
- `parent_version_id` 可空，自引用时必须属于同一项目；
- Timeline 版本只追加，repository 不提供 update；
- 如用触发器阻止 update，必须确保项目级级联删除仍可工作；
- A05 只保存最小固定 IR fixture，不设计或实现完整 Timeline IR 校验，那属于后续 timeline 工作包；
- 切换 active version、自然语言修改和撤销不在本任务范围。

## 外键与删除策略

- 所有子表通过 `project_id` 归属项目，并建立必要索引；
- 测试证明不能插入不存在项目的子记录；
- 项目删除策略必须明确。建议项目记录删除时级联清理数据库内子记录，但绝不能删除 `project_root`、外部素材或任何磁盘文件；
- timeline parent 使用合适的 `ON DELETE` 策略，不能因删除父版本留下悬空引用；
- 本任务 repository 可以不暴露删除项目功能，但 schema 行为仍需测试和记录；
- 禁止把外键关闭后执行普通写操作。

## Repository API

实现小而明确的 repository，不要提供任意 SQL、任意表名或 `dict -> UPDATE` 万能入口。建议至少有：

- `ProjectRepository.create/get/list`；
- `AssetRepository.create/get/list_for_project`；
- `JobRepository.create/get/list_for_project`；
- `MessageRepository.append/list_for_conversation`；
- `TimelineVersionRepository.append/get/list_for_project`。

可根据测试需要增加受控方法，但必须保持 A05 范围。要求：

- 输入使用严格 Pydantic model 或明确 typed dataclass；
- 数据库 row 转换后再次校验，损坏数据返回稳定错误；
- UUID、时间、枚举、JSON 大小和 JSON-safe 值在写入前校验；
- JSON 序列化使用一致的 `ensure_ascii=False`、稳定 key 顺序和紧凑 separators；
- 查询结果有确定排序；列表方法有有界 limit，不允许一次无界读取；
- 项目隔离必须进入查询条件，不能只靠调用方过滤；
- 返回结构不包含 sqlite connection、cursor、rowid 或原始异常；
- repository 方法不打印业务数据或绝对路径；
- 支持在调用方提供的 transaction 中组合多个 repository 写入，或提供清晰 unit-of-work 边界。

## 稳定错误

建立 Python 内部存储错误类型，至少区分：

- `DATABASE_OPEN_FAILED`；
- `DATABASE_READ_ONLY`；
- `DATABASE_BUSY`；
- `DATABASE_CORRUPT`；
- `MIGRATION_FAILED`；
- `MIGRATION_CHECKSUM_MISMATCH`；
- `SCHEMA_TOO_NEW`；
- `CONSTRAINT_VIOLATION`；
- `RECORD_NOT_FOUND`；
- `INVALID_RECORD`。

错误对象可以保留内部 cause 供脱敏日志使用，但面向 RPC/Agent 的消息不得包含 SQL、stack、数据库绝对路径、用户名或记录正文。A05 不必把所有 repository 方法注册为 RPC；如果为 smoke 增加诊断入口，只能返回版本、状态和计数摘要。

## 与 A04 RPC 的集成边界

- 保持 A04 `core.health`、`core.smoke.countdown`、取消、错误码和现有 fixtures 向后兼容；
- 可让 `core.health` 的 capabilities 增加非敏感 storage capability，前提是同步更新两端契约和测试；
- 不增加接受任意 `databasePath`、SQL、表名、where 条件或文件路径的 RPC 方法；
- 不要求 A03 faux Pi agent 调用数据库；
- 不新增 Renderer IPC、preload 能力或 UI；
- `PythonCoreClient` 仅在确有需要时做最小兼容修改，不能为 A05 重构其已验证的传输层；
- A06 将新增正式的项目 create/open RPC，并负责从可信产品层向 Core 传递已验证项目位置。

## 存储 smoke

新增根目录命令，建议：

```powershell
npm run core:storage:smoke
```

该命令必须：

1. 创建全新的临时项目目录与 `data/project.db`；
2. 启动第一个真实 Python 进程；
3. 执行 migration，写入一个 project，并为五类表写入最小固定数据；
4. 正常关闭第一个进程/连接；
5. 启动第二个真实 Python 进程重新打开同一个数据库；
6. 再次运行 migration，证明是无副作用 no-op；
7. 验证记录、外键、JSON、时间线版本和 schema version 完整；
8. 输出不含绝对路径的简短成功摘要；
9. 关闭所有连接并清理临时目录；
10. 成功退出码为 0，失败为非 0，不生成 tracked report。

smoke 可以通过受控 Python module CLI 完成，但不能因此建立通用 SQL CLI。CLI 的数据库路径只来自根 smoke 脚本创建的临时目录，不来自 Agent/Renderer。

## 自动化测试要求

至少覆盖：

1. 全新数据库从 0 迁移到当前版本；
2. 同一数据库第二次运行 migration 是 no-op；
3. migration 版本、名称、checksum 被篡改时拒绝启动；
4. 数据库版本高于程序支持版本时返回 `SCHEMA_TOO_NEW`；
5. 人工构造的失败 migration 完整 rollback，不留下半成品或版本记录；
6. CRLF/LF 归一化后 checksum 一致；
7. 每个连接的 foreign keys、WAL、synchronous 和 busy timeout 配置正确；
8. 五类 repository 的最小 create/get/list round trip；
9. 关闭并重新打开连接后记录仍存在；
10. 至少一个测试使用两个独立 Python 进程验证重启持久化；
11. 外键、唯一键、枚举、范围和 NOT NULL 约束实际生效；
12. 一次事务中间失败时所有写入 rollback；
13. `timeline_versions` 不能通过 repository 原地修改；
14. message append sequence 稳定且列表有确定排序；
15. project A 的查询不会返回 project B 的记录；
16. 参数化 SQL 能安全保存包含引号和中文的普通文本；
17. 无效 JSON、非有限数字、超大/非法字段和损坏 row 被稳定拒绝；
18. quick/integrity check 和 foreign key check 返回结构化摘要；
19. 项目记录的数据库级删除不会删除任何磁盘素材；
20. A01–A04 的类型检查、RPC 测试、Agent smoke 和 Electron 安全测试继续通过。

测试必须使用临时目录和固定构造数据，不使用开发者真实项目、个人路径、视频、对话或密钥。测试结束后不能残留 `.db`、`-wal`、`-shm` 文件。

## 文档要求

新增 `docs/storage.md`，至少说明：

- 每项目一个数据库的拓扑和 A05/A06 边界；
- SQLite PRAGMA、事务与并发策略；
- migration 文件命名、checksum、原子性与新增 migration 流程；
- 五类初始表的用途、关键约束和关系；
- 数据库 schema version 与 RPC/Timeline schema version 的区别；
- repository 使用方式和禁止任意 SQL 的原因；
- 如何运行测试、storage smoke、integrity/foreign-key 检查；
- WAL 产生的辅助文件和正确关闭方式；
- 当前不包含项目创建 UI、任务恢复、媒体分析、完整 Timeline IR 和备份恢复。

同步更新 README：增加命令、目录说明、Python 初始化前置条件和已知限制。

## 建议实施顺序

### 第 1 天：数据库与 migration

- 定义 schema version、错误类型和连接策略；
- 实现 PRAGMA、事务和 migration runner；
- 创建 `0001_initial` 与 `schema_migrations`；
- 完成 fresh、no-op、checksum、too-new 和 rollback 测试。

### 第 2 天：模型与 repository

- 定义五类严格输入/输出模型；
- 实现参数化 repository 和项目隔离；
- 补齐外键、唯一、范围、JSON、事务和不可变版本测试；
- 验证关闭重开后数据存在。

### 第 3 天：跨进程 smoke 与回归

- 实现两个独立 Python 进程的 storage smoke；
- 补齐 Windows 路径、WAL 清理和损坏/锁冲突测试；
- 更新 README 与 `docs/storage.md`；
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
```

并确认既有 spike 仍可独立运行：

```powershell
Set-Location .\spikes\pi-electron-bridge
npm run validate
```

运行 spike 后只恢复它生成的 runtime/session/report 噪声，不得覆盖用户或其他智能体的修改。

## 完成定义

- SQLite 连接安全配置和稳定错误模型落地；
- migration runner 支持 fresh、upgrade、no-op、checksum 校验、too-new 检测和原子 rollback；
- 五类基础表、索引、外键和范围约束落地；
- 五类最小 repository 可用，全部使用参数化 SQL 和有界查询；
- Timeline 版本只追加，不提供原地覆盖能力；
- 真实跨进程重启持久化 smoke 可重复通过；
- integrity/foreign-key 检查可用；
- A04 RPC 契约与现有健康检查保持兼容；
- Windows PowerShell 与包含空格/中文的临时路径得到验证；
- 文档完整；
- 没有数据库、WAL、SHM、`.venv`、缓存、dist、日志、密钥、用户路径或测试报告进入提交。

## 禁止事项

- 不实现 A06 的项目创建/打开、文件夹选择、manifest 或真实素材扫描；
- 不实现 A07 的任务状态机、job events、checkpoint、恢复、重试和调度；
- 不实现 A08 的 safeStorage、API Key 或诊断包；
- 不实现完整 Timeline IR、自然语言修改或 active version 切换；
- 不引入 ORM、网络数据库或全局项目索引库；
- 不提供任意 SQL/RPC、动态表名、动态 migration 或 Agent 可控数据库路径；
- 不复制、修改、删除任何外部素材或真实项目；
- 不在数据库中保存明文密钥、真实 Prompt、真实用户对话或个人数据；
- 不修改历史 migration 来“修复”已发布 schema，必须新增更高版本；
- 不直接提交 smoke 生成的数据库或临时文件。

## 完成交接

提交后返回：

```text
任务：A05
分支：feat/a05-sqlite-migrations
提交：<commit hash>
变更：<连接层、migration、初始 schema、repositories、smoke 和文档>
验证：<每条命令、实际 Python/SQLite 版本及结果>
限制：<尚未包含的项目层、状态机或备份能力>
风险：<需要 Review 特别检查的事务、锁、迁移原子性、级联或路径问题>
```

不要自行合并 `main`，不要自行推送远程仓库。

---
