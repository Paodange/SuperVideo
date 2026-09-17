# Gate A 验收任务提示词：工程基础闭环

以下内容可直接交给负责 Gate A 验收的智能体。

---

你正在对 `C:\Project\SuperVideo` 项目的 A01–A08 工程基础阶段执行 Gate A 验收。本任务是独立验收，不是继续开发功能。

开始前请完整阅读：

1. 根目录 `AGENTS.md`；
2. `docs/development-workflow.md`；
3. `docs/phase-1-technical-design.md`，重点阅读第 3、5、6、12、13、18.1、18.2 和 19 节；
4. `docs/electron-security.md`；
5. `docs/agent-worker.md`；
6. `docs/python-rpc.md`；
7. `docs/storage.md`；
8. `docs/projects.md`；
9. `docs/jobs.md`；
10. `docs/observability-and-secrets.md`；
11. 根目录 `README.md`；
12. `tasks/A01-monorepo-scaffold-prompt.md` 至 `tasks/A08-logging-diagnostics-secrets-prompt.md` 的完成定义和验收边界。

## 一、开跑前置条件

Gate A 只能在以下条件全部满足后开始：

- A08 已通过主智能体 Review，并已合并到最新本地 `main`；
- 本地 `main` 与 `origin/main` 一致；
- 工作区干净；
- A08 Review 中的负载敏感 Agent smoke 超时、失败原因不可诊断、凭据损坏/原子写/并发测试缺口均已修复并复验；
- 不存在待合并的 A01–A08 功能分支；
- 当前机器是第一阶段目标 Windows 环境；
- 不使用真实 API Key、真实招聘素材或用户隐私数据做验收。

如果任一前置条件不满足，停止验收，报告 `BLOCKED`；不要在验收分支顺手修复产品代码。

## 二、Git 与职责边界

- 从最新、干净的本地 `main` 创建分支 `test/gate-a-foundation-acceptance`；
- 验收分支只允许增加验收报告和必要的、纯测试性质的验收脚本；
- 不在该分支开发 B01 或任何媒体能力；
- 发现产品缺陷时记录稳定复现步骤、预期与实际结果，不在验收分支修改产品实现；
- 不合并 `main`，不推送远程仓库；
- 验收通过后由主智能体 Review 报告并决定是否合并；
- 验收失败时保留分支和证据，等待用户另开 `fix/gate-a-...` 修复任务。

## 三、Gate A 的唯一目标

证明 A01–A08 已形成可重复、可诊断且不泄密的 Windows 桌面基础闭环：

```text
启动桌面应用
  → 创建/打开本地项目
  → Electron Main 启动 Agent Worker
  → Worker 调用 Python Core
  → 创建持久化模拟任务
  → UI 接收进度和事件
  → 用户取消任务
  → 状态与事件写入项目 SQLite
  → 关闭并重启应用
  → 重新打开项目后状态仍正确
  → 日志和诊断可关联且无明文凭据
```

Gate A 最终结论只有：

- `PASS`：全部阻断项通过，可以开始 B01；
- `FAIL`：存在任何阻断缺陷，不得开始 B01；
- `BLOCKED`：环境或前置条件不足，尚未形成有效结论。

不使用“基本通过”“暂时通过”或“重跑后通过”代替明确结论。

## 四、验收原则

1. 先跑无人值守自动化，再做 Windows UI 端到端验收。
2. 自动化矩阵必须在同一轮连续执行中全部成功；失败后单独重跑成功只能用于诊断，不能把原轮次记为通过。
3. 不通过增加无依据超时、静默重试或跳过测试掩盖不稳定性。
4. SQLite 是项目和 job 的事实来源；UI 内存状态不是持久化证据。
5. 原始素材只读，不删除、不覆盖、不移动。
6. Gate 使用一次性项目、一次性 userData 和虚假凭据；不得污染真实用户数据。
7. 任何日志、报告、截图、终端输出和 Git 提交都不能包含 secret、密文、完整本机路径、Windows 用户名或真实项目名称。
8. 只在用户明确操作时导出诊断；验收过程中不联网上传任何内容。
9. 所有临时清理必须针对本次创建且已验证位于专用验收根目录下的绝对路径。
10. Gate A 不评价视频生成效果，因为媒体分析、转写、混剪和导出尚未进入开发阶段。

## 五、验收环境隔离

### 5.1 创建一次性根目录

在系统临时目录下创建唯一目录，建议：

```text
<系统 Temp>\SuperVideo-Gate-A-<随机 ID>\
├─ user-data\
├─ project\
├─ source\
├─ exports\
└─ notes\
```

要求：

- 使用系统 API 获取 Temp，不手写其他用户目录；
- 根目录必须包含固定前缀 `SuperVideo-Gate-A-` 和随机 ID；
- `project` 在创建项目前必须为空；
- `source` 中只放固定、无隐私的伪素材；
- 记录报告时只写 `<gate-root>` 等占位符，不记录真实绝对路径；
- 验收结束后先确认 Electron、Worker 和 Core 进程已退出，再验证待删除路径仍位于系统 Temp 且具有正确前缀，最后只删除该唯一目录；
- 不清理仓库、用户 AppData、真实项目目录或任何父目录。

### 5.2 独立 Electron userData

Windows UI 验收优先使用构建后的 Electron Main，并通过 Electron 支持的 `--user-data-dir` 指向 `<gate-root>\user-data`，避免读写真实开发者 AppData：

```powershell
npm run build
.\node_modules\.bin\electron.cmd apps\desktop\dist\main\main.js --user-data-dir="<gate-root>\user-data"
```

启动后确认日志和凭据确实落在该隔离 userData；若当前 Electron 启动方式没有采用该参数，判为 `BLOCKED`，不要改用真实 userData 继续。

不要为了方便将 fake encryption adapter 接入产品运行路径。自动化测试使用 fake adapter，Windows UI 验收必须走真实 Electron `safeStorage`。

## 六、阶段 0：基线和环境记录

在不输出用户隐私的前提下记录：

- Gate 开始时间和时区；
- `git rev-parse HEAD`；
- `git status --short`；
- `git rev-parse main` 与 `git rev-parse origin/main`；
- Windows 版本大版本、CPU 架构；
- Node、npm、Electron、Python 版本；
- 项目数据库 schema、Worker/Core/RPC 协议版本；
- 是否使用隔离 userData；
- 网络是否保持在仅本地开发所需范围。

禁止把用户名、主机名、完整环境变量、真实 AppData 路径或完整命令行写入报告。

基线必须满足：

- HEAD 位于 `test/gate-a-foundation-acceptance`；
- 分支起点是最新 `main`；
- 工作区无修改；
- 依赖锁文件已存在；
- 没有运行中的旧 SuperVideo/Electron 验收实例。

## 七、阶段 1：连续自动化验收

### 7.1 完整命令矩阵

从仓库根目录按以下顺序连续执行，任一命令失败立即保存安全的失败摘要，但继续与失败无关的只读诊断；不要把失败命令自动重试并计作通过。

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

逐项记录：

- 命令；
- exit code；
- 通过/失败；
- 测试数量；
- 粗粒度耗时；
- 若失败，记录稳定错误码和阶段，不复制可能含路径/secret 的原始输出。

### 7.2 Agent 首次运行稳定性

完整矩阵通过后，在不重新 build 的情况下，用全新 Electron 进程连续运行 5 次：

```powershell
$failures = 0
1..5 | ForEach-Object {
  npm run agent:smoke
  if ($LASTEXITCODE -ne 0) { $failures += 1 }
}
if ($failures -ne 0) { throw "Agent smoke stability failed: $failures run(s)." }
```

要求：

- 5 次全部首次通过；
- 每次有界结束，无残留 Worker/Core；
- 记录每次耗时，但不为慢机器硬编码结论；
- 任一次超时或只能重跑通过，Gate A 判 `FAIL`；
- 失败信息必须足以区分 ready timeout、首次 runtime 加载、事件等待和 shutdown timeout，同时不能输出敏感内容。

### 7.3 原始架构 spike 回归

```powershell
Set-Location C:\Project\SuperVideo\spikes\pi-electron-bridge
npm run validate
```

验收点：

- Electron utility process；
- Pi 生命周期；
- Python JSONL 进度；
- provider 注册；
- session 恢复；
- 取消传播。

验证会更新受版本控制的 `validation-report.json`。运行后恢复本次产生的时间戳、PID 和计数差异，确认该文件与 HEAD 内容一致；不要提交运行报告。

## 八、阶段 2：Windows UI 主闭环

所有步骤均使用 `<gate-root>` 和隔离 userData。

### 8.1 启动与安全壳

1. 启动构建后的桌面应用；
2. 确认只出现一个主窗口；
3. 确认页面加载完成、无白屏、无明显控制台错误；
4. 确认 Worker 从 `starting` 进入 `ready`；
5. 确认 Renderer 不暴露 Node、文件系统、任意 IPC 或任意路径输入；
6. 尝试取消一个原生文件夹选择对话框，确认无项目、文件或错误状态残留；
7. 确认窗口关闭后 Worker/Core 可有界退出。

### 8.2 创建项目

1. 在 UI 输入无隐私的测试项目名，例如“Gate A 测试项目”；
2. 目标平台选择抖音；
3. 通过原生对话框选择空的 `<gate-root>\project`；
4. 确认 UI 显示项目已打开；
5. 检查项目目录生成：
   - `project.supervideo.json`；
   - `data/project.db`；
   - `cache/`；
   - `generated/`；
   - `previews/`；
   - `exports/videos/`；
   - `exports/jianying/`；
   - `logs/`；
6. 确认 manifest 不含 API Key、密文或用户隐私；
7. 确认数据库可通过应用重新打开，而不是只能依赖当前内存状态。

### 8.3 外部素材只读引用

使用固定、无隐私的伪 `.mp4` 文件或仓库已有测试夹具：

1. 引用前记录文件大小、修改时间和内容 hash；
2. 通过原生文件对话框引用该文件；
3. UI 显示引用状态和元数据；
4. 项目目录中不存在原素材副本；
5. 引用后大小、修改时间和 hash 完全一致；
6. 重复引用不会生成重复资产记录；
7. 取消文件对话框不会改变资产列表。

不要使用真实视频，不要求伪文件可播放；本阶段只验收路径引用和只读边界。

### 8.4 Agent 流式事件

1. 启动 A03 faux Agent smoke task；
2. 观察 run ID、助手文本增量和工具进度；
3. 确认事件 sequence 单调递增；
4. 等待一次任务成功结束；
5. 再启动一次并在工具进度出现后取消；
6. 确认只取消目标 run，终态为 `cancelled`，Worker 随后回到 `ready`；
7. 确认 UI 没有显示原始 Pi 内部对象、Python stdout 或堆栈。

### 8.5 持久化 job：成功和取消

1. 启动一个 A07 模拟 job；
2. 观察 `queued → running`、进度、stage 和事件序号；
3. 在任务尚未终止时点击取消；
4. 确认可观察到取消请求，并最终进入 `cancelled`；
5. 再启动一个模拟 job 并等待 `succeeded`；
6. 确认 progress 为 100%、有 terminal 时间、事件序号无重复/倒退；
7. 已成功 job 不允许取消或重试；
8. 已取消 job 不应被误显示为成功。

UI 固定模拟任务可能很短。可以使用可靠 UI 自动化及时点击取消，但不得修改产品延迟、数据库或状态来伪造结果。中途 Core 重启恢复由 `jobs:smoke` 提供自动化证据。

### 8.6 应用重启与持久化恢复

1. 记录 UI 中成功和取消 job 的非敏感状态摘要；
2. 正常关闭整个应用，确认 Worker/Core 退出；
3. 使用同一个隔离 userData 重新启动应用；
4. 通过原生对话框重新打开 `<gate-root>\project`；
5. 确认 project ID 没有被重建；
6. 确认资产引用仍存在；
7. 确认成功 job 仍是 `succeeded`，取消 job 仍是 `cancelled`；
8. 确认进度、attempt、最后事件序号与数据库一致；
9. 确认没有重复 terminal event；
10. 确认 Worker/Core 重启不会把终态任务重新执行。

这是 Gate A 的核心阻断场景。任何状态丢失、终态改变、重复执行或只能通过清库恢复，均判 `FAIL`。

## 九、阶段 3：A08 安全、日志和诊断闭环

### 9.1 真实 Windows safeStorage

只使用唯一、明显虚假的随机哨兵 secret；该值不得写入验收报告。

1. 确认 UI 显示 secure storage `available`；
2. 保存一个 LLM 测试凭据；
3. 点击保存后立即确认 password 输入框为空；
4. UI 只显示 service、provider、display name 和 configured，不显示 secret、前后缀、长度、hash 或密文；
5. 重启应用后元数据仍显示已配置，secret 仍不可回显；
6. 使用新的虚假 secret 替换该凭据，旧值不可见；
7. 删除凭据并确认列表更新；
8. 删除不存在的引用行为与文档一致；
9. 检查 `<gate-root>\user-data\security\credentials.v1.json`：格式版本正确、包含 safeStorage 密文、绝不包含明文哨兵；
10. 检查项目 manifest、SQLite、日志和导出文件均不含明文哨兵或密文副本。

如果实际运行没有使用 Windows safeStorage，或不可用时仍能明文保存，立即判 `FAIL`。

### 9.2 结构化日志

检查隔离 userData 下的应用日志：

- 每行是合法 JSON；
- schema、UTC 时间、level、component、event 和 session ID 合法；
- project/job/operation/request/run 的关联 ID 能串起一次任务；
- Worker/Core 启停、项目操作、job 状态、凭据元数据操作和诊断导出有稳定事件；
- 无 Prompt、RPC/IPC 完整 body、checkpoint、完整异常 stack；
- 无明文哨兵、密文、Authorization、Cookie、URL query；
- 无 `<gate-root>` 的完整绝对路径；
- 日志失败不会改变 SQLite job 状态；
- 文件数量和大小符合轮转上限。

日志内允许出现应用生成的不透明 project/job ID；报告中不得抄录这些完整 ID。

### 9.3 诊断导出

1. 点击“导出诊断信息”；
2. 首次取消保存对话框，确认没有文件和错误残留；
3. 再次导出到 `<gate-root>\exports`；
4. 确认 Renderer 只显示 saved/cancelled，不显示目标完整路径；
5. 解析 JSON 并通过版本化 schema；
6. 检查应用/runtime/Worker/Core/schema/job 状态计数合理；
7. 检查日志数量、日志字节和总文件大小受限；
8. 确认文件无 secret、密文、credentialRef、provider/display name、项目/素材名称、绝对路径、环境变量或 SQLite 内容；
9. 确认导出不会打开网页、剪贴板或网络上传；
10. 导出前后项目和 job 状态完全不变。

## 十、阶段 4：磁盘与隐私核验

只扫描仓库与 `<gate-root>`，不得扫描整个用户目录或输出真实环境变量。

至少核验：

- Git 工作区没有 `.env*`、真实凭据、日志、诊断 JSON、SQLite/WAL/SHM、临时项目或构建缓存进入待提交状态；
- `<gate-root>` 中除 safeStorage 密文外不存在哨兵值；
- 项目目录不包含原素材副本；
- 项目 manifest/SQLite 不包含明文凭据；
- 诊断 JSON 不包含 vault 内容；
- 日志不包含完整本机路径；
- 仓库中的 Key/Bearer 命中仅来自明确的虚假脱敏测试夹具；
- `git diff --check` 通过；
- spike 报告已恢复；
- 最终 `git status --short` 只包含计划提交的验收报告。

不要把哨兵本身、密文内容或完整命中行复制到报告。只记录“扫描通过/失败、命中类别和文件类型”。

## 十一、阻断判定

出现以下任一情况，Gate A 必须判 `FAIL`：

- 完整自动化矩阵任一命令失败或只能重跑通过；
- Agent smoke 5 次稳定性测试任一次失败、超时或遗留进程；
- 桌面应用无法创建/重新打开项目；
- Renderer 可直接访问 Node、文件系统、任意 IPC 或任意路径；
- 原素材被复制、修改、覆盖或删除；
- job 取消后进入错误终态，或重启后状态/事件丢失、重复执行；
- SQLite 与 UI 的 terminal 状态不一致；
- Worker/Core 崩溃没有稳定状态或无法恢复；
- safeStorage 不可用时发生明文降级；
- secret、密文、Prompt、绝对路径或完整请求体进入日志/诊断/项目文件；
- 诊断被自动上传或 Renderer 获得保存路径；
- 失败无法通过稳定错误码和阶段定位；
- 为通过 Gate 修改数据库、测试结果或手工伪造状态；
- 工作区包含运行产物或隐私数据。

以下不是 Gate A 阻断项，但必须列入后续限制：

- 尚无真实模型 Provider；
- 尚无 FFmpeg/Whisper/媒体分析；
- 尚无真实混剪、成片或剪映草稿；
- 尚无自然语言视频编辑；
- 尚无跨机器凭据迁移和云同步。

## 十二、验收报告

新增：

```text
docs/acceptance/gate-a-report.md
```

报告必须使用以下结构：

```markdown
# Gate A 验收报告

## 结论
PASS | FAIL | BLOCKED

## 基线
- main commit：短哈希
- 验收分支：test/gate-a-foundation-acceptance
- 日期与时区：
- Windows/Node/npm/Electron/Python：仅版本，不含用户名和路径
- 隔离 userData：是/否

## 自动化结果
| 命令 | 结果 | 测试数/关键输出 | 耗时 |

## Windows UI 场景
| 场景 | 结果 | 安全证据摘要 |

## 持久化核验
- 项目重开：
- 资产引用：
- cancelled job：
- succeeded job：
- event sequence：

## 安全与隐私核验
- safeStorage：
- 明文扫描：
- 日志：
- 诊断导出：
- 原素材只读：

## 缺陷
| ID | 严重度 | 复现步骤 | 预期 | 实际 | 建议归属 |

## 已知限制

## Gate 决策依据
```

报告要求：

- 只记录必要、脱敏的事实；
- 不嵌入日志全文、诊断 JSON、数据库、真实绝对路径、secret、密文或完整 UUID；
- 不把失败截图或终端原始输出直接提交；
- 可以记录安全的错误码、事件名、状态序列和测试数量；
- `PASS` 时“缺陷”必须没有阻断项；
- `FAIL` 时至少有一个可复现阻断缺陷；
- `BLOCKED` 时明确缺少的前置条件和下一步负责人。

## 十三、Gate 通过后的交接

只有结论为 `PASS` 时，向主智能体提供：

1. 分支名；
2. 提交哈希；
3. `main` 基线哈希；
4. 自动化矩阵逐项结果；
5. Agent 5 次稳定性结果和耗时范围；
6. Windows UI 主闭环结果；
7. 项目/资产/job 重启持久化结果；
8. safeStorage、日志、诊断和明文扫描结果；
9. spike validate 结果；
10. 已知非阻断限制；
11. 清理结果；
12. 明确声明未使用真实 Key、未上传数据、未修改项目外素材、未合并 `main`、未推送远程。

主智能体 Review 并合并 PASS 报告后，才可以创建 B01 开发任务。

如果结论为 `FAIL` 或 `BLOCKED`，同样提交报告，但不要声明 Gate 已完成，不要开始 B01，也不要自行创建修复分支。
