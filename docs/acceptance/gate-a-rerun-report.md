# Gate A 重跑验收报告

## 结论

**BLOCKED：不能判定 Gate A PASS，也不开始 B01。**

本轮已完成项目创建、素材引用/去重、Agent 取消与成功、Job 成功、重启恢复、Windows safeStorage 保存、诊断导出和隐私扫描。唯一尚未形成合格原生 UI 证据的是 **A07 持久 Job 的 UI 取消**：当前 UI smoke job 的固定运行窗口约为 1.2 秒，原生 Windows CUA 的一次动作/刷新往返超过了可稳定捕获 Cancel 按钮的时序；本轮没有把后端取消结果冒充 UI 取消证据。

## 验收基线

- 验收分支：`test/gate-a-foundation-acceptance-rerun`
- 产品基线：`33df549`（包含 `518437a` 的 Job 事件绑定修复，以及 `33df549` 的诊断导出错误分阶段处理）
- `main` 与 `origin/main` 仍为 `345b5f0`，未合并、未推送
- 测试数据使用临时 `<gate-root>`，凭据为不可联网的假值；未使用真实服务、真实 API Key 或真实媒体执行器

## 原生 Windows UI 结果

| 场景 | 结果 | 证据 |
|---|---|---|
| 项目创建 | PASS | 通过原生文件夹选择器创建项目；UI 显示 ACTIVE，清单和 `data/project.db` 存在，项目目录结构完整 |
| 素材引用与重复添加 | PASS | 通过原生文件选择器添加 fixture；UI 数量保持 1，第二次显示 `existing`；源文件仍为 32 B，SHA-256 前缀保持 `630DCD2966C4`，项目目录没有素材副本 |
| Agent 流式、取消、成功 | PASS | 原生 UI 观察到 tool progress；一次任务最终为 `cancelled`，另一次为 `completed`，Worker 返回 READY |
| Job 成功 | PASS | 原生 UI 观察到成功 Job 为 100%、`completed`、attempt 1、最终事件 `succeeded`；此前发现并修复了 renderer 闭包导致的 queued 假象 |
| Job UI 取消 | BLOCKED | 自动化 `jobs:smoke` 已覆盖 Worker/Core/SQLite 取消并通过，但本轮没有在原生 UI 中稳定点击到短时 smoke job 的 Cancel 按钮 |
| 重启恢复 | PASS | 关闭并重启 Electron 后通过原生文件夹选择器重新打开同一项目；项目 ID、素材记录、凭据元数据和成功 Job 列表恢复 |
| safeStorage 保存 | PASS | UI 显示 `AVAILABLE`；保存后提示 secret 不可查看，输入框清空；重启后服务元数据仍在，secret 输入框仍为空 |
| 诊断导出 | PASS | 原生 Save 对话框保存 JSON；UI 提示 redacted 且未上传；取消 Save 对话框也显示 `Diagnostics export cancelled.` |

## 落盘与隐私检查

- 项目 manifest schema 为 1，未含 secret/token/password 字段。
- Windows 凭据存储 schema 为 1，包含 1 条记录；记录含 `encryptedValueBase64`，无 `secret`、明文 `value` 或 plaintext 字段。
- 应用日志共 978 行，全部可解析为 JSON；解析错误 0，敏感词/完整临时根路径命中 0。
- 诊断文件约 19 KB，包含固定诊断 sections、最近日志 40 条、`truncated=false`；未发现假凭据、私钥头、授权头、cookie、token、password、secret 或完整临时根路径。
- 原始素材只读引用，项目内没有 `gate-a-fixture.mp4` 副本。

## 自动化验证

以下命令均通过：

- `npm run core:setup`
- `npm run typecheck`
- `npm test`（43 tests）
- `npm run core:test`（41 tests）
- `npm run health`
- `npm run build`
- `npm run core:rpc:smoke`
- `npm run core:storage:smoke`
- `npm run agent:smoke`
- `npm run project:smoke`
- `npm run jobs:smoke`
- `npm run diagnostics:smoke`
- `spikes/pi-electron-bridge` 下的 `npm run validate`

产品修复后的复核命令也全部通过：`npm run typecheck`、`npm run diagnostics:smoke`、`npm run jobs:smoke`、`npm run build`。

## 后续阻塞项

需要补一次真实原生 UI Job 取消：启动一个可留出明确取消窗口的 Job，在 UI 中观察 `running` 后点击 Cancel，并在重启后确认该 Job 持久化为 `cancelled`。在此证据补齐前，Gate A 保持 BLOCKED，不进入 B01。
