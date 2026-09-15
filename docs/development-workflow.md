# 开发智能体协作与 Git 流程

## 1. 目标

所有功能开发从 `main` 拉出独立任务分支。开发智能体只在任务分支实现并提交；主智能体负责集成、轻量 Review 和向远程仓库推送。这样可以让每个 2–3 天工作包独立验收，也便于回退和追踪责任边界。

根目录 `AGENTS.md` 是给所有智能体的强制规则，本文件用于解释具体操作。

## 2. 开始任务

在确认没有未提交改动后执行：

```powershell
git switch main
git status --short --branch
git pull --ff-only origin main
git switch -c feat/a01-monorepo-scaffold
```

如果 `main` 有未提交内容、无法快进或目标分支已经存在，停止操作并向主智能体说明，不自行 reset、覆盖或删除。

分支命名：

- 功能：`feat/<task-id>-<short-name>`
- 修复：`fix/<task-id>-<short-name>`
- 文档：`docs/<task-id>-<short-name>`
- 工程：`build/<task-id>-<short-name>`

## 3. 开发与提交

开发智能体应遵守以下范围：

1. 只实现任务提示词中的目标和验收条件；
2. 先阅读 `AGENTS.md`、相关技术方案和现有代码；
3. 保留用户和其他智能体的现有修改；
4. 新增依赖、公共契约或目录结构时同步文档；
5. 运行与任务相关的测试和仓库级检查；
6. 在任务分支形成至少一个可审查提交。

推荐提交格式：

```text
feat(desktop): scaffold A01 development workspace
```

交接内容必须包括：

```text
任务：A01
分支：feat/a01-monorepo-scaffold
提交：<commit hash>
变更：<简要说明>
验证：<命令以及通过/失败结果>
限制：<没有则写“无”>
风险：<需要 Review 关注的地方>
```

## 4. 本地集成与轻量 Review

开发分支完成后，由主智能体执行集成。合并前先确认 `main` 与远程状态，再使用保留分支边界的合并提交：

```powershell
git switch main
git pull --ff-only origin main
git merge --no-ff feat/a01-monorepo-scaffold
```

随后对尚未推送的集成结果做轻量 Review：

```powershell
git status --short --branch
git log --oneline --decorate origin/main..main
git diff --stat origin/main...main
git diff origin/main...main
```

Review 清单：

- 是否只完成当前任务，没有意外扩展范围；
- 是否符合 `docs/phase-1-technical-design.md`；
- 是否存在明显逻辑错误、路径问题或 Windows 不兼容；
- 是否误提交密钥、个人数据、大文件、缓存或构建产物；
- 依赖和锁文件是否合理；
- 文档、健康检查、静态检查和测试是否真实可运行；
- 是否破坏已有 spike、协议或工作流。

如果发现问题，不推送 `main`。在任务分支或明确的修复分支完成修复、重新合并并复查。

## 5. 推送与收尾

Review 和验证均通过后，由主智能体执行：

```powershell
git push origin main
```

推送成功后确认本地 `main` 与 `origin/main` 一致，再决定是否删除已合并任务分支。禁止强制推送 `main`。

## 6. 例外

只有用户明确授权的仓库治理改动，例如 `AGENTS.md`、开发流程或任务模板，才可以直接在 `main` 添加。即使是例外，也必须查看 diff、完成必要检查并形成独立提交。
