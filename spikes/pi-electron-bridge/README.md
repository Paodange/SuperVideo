# Pi + Electron + Python 架构验证

这个 spike 验证 SuperVideo 第一阶段的 Agent 主链路，不实现真实视频功能。

## 覆盖范围

- Electron `utilityProcess` 中运行 Pi Agent；
- Pi 工具调用通过 JSON Lines 调用 Python；
- Python 任务进度流式返回到 Pi 事件；
- 取消信号终止 Python 子进程；
- Agent 消息落盘后由新工作进程恢复；
- `pi-ai` 注册自定义 OpenAI 兼容 provider。

真实 LLM API、真实媒体任务、Remotion 和剪映操作不在本 spike 范围内。

## 运行

```powershell
npm install
npm run validate
```

成功时进程退出码为 0，并生成：

- `validation-report.json`：检查结果与事件证据；
- `validation-session.json`：用于验证重启恢复的临时会话。

首次安装若 Electron 官方源不可达，可根据 Electron 官方文档设置镜像后执行其安装脚本。

## 关键结论

- 架构主链路验证通过；
- Electron utility process 使用 `.cjs` 薄入口，再导入 ESM Worker；
- 长任务取消必须在工具实现里显式监听 `AbortSignal` 并终止底层进程；
- Agent 会话可以序列化，但正式产品应写入 SQLite，而不是 JSON 文件；
- OpenAI 兼容 provider 本次仅验证注册，首个真实服务接入仍需单独做协议测试。
