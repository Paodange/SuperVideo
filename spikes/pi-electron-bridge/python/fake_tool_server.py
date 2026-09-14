"""为 Pi/Electron 技术验证提供受控的 Python JSON Lines 工具服务。"""

from __future__ import annotations

import json
import sys
import time
from typing import Any


def emit(payload: dict[str, Any]) -> None:
    """向标准输出写入单条 JSON Lines 消息。

    参数:
        payload: 要发送给 Electron/Pi 工作进程的结构化消息。
    """
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def run_countdown(request_id: str, seconds: int) -> None:
    """执行可观察的模拟长任务并持续报告进度。

    参数:
        request_id: 调用方生成的请求标识。
        seconds: 模拟任务包含的步骤数。
    """
    for step in range(1, seconds + 1):
        time.sleep(0.15)
        emit(
            {
                "type": "progress",
                "id": request_id,
                "progress": step / seconds,
                "message": f"python-step-{step}",
            }
        )
    emit(
        {
            "type": "result",
            "id": request_id,
            "result": {"status": "completed", "steps": seconds},
        }
    )


def main() -> None:
    """读取标准输入中的 RPC 请求并执行白名单工具。"""
    for raw_line in sys.stdin:
        try:
            request = json.loads(raw_line)
            request_id = str(request["id"])
            method = request["method"]
            params = request.get("params", {})
            if method != "fake_countdown":
                raise ValueError(f"unsupported method: {method}")
            seconds = int(params.get("seconds", 3))
            if not 1 <= seconds <= 20:
                raise ValueError("seconds must be between 1 and 20")
            run_countdown(request_id, seconds)
        except Exception as exc:  # noqa: BLE001 - RPC 边界必须返回结构化错误。
            emit(
                {
                    "type": "error",
                    "id": request.get("id", "unknown") if "request" in locals() else "unknown",
                    "error": str(exc),
                }
            )


if __name__ == "__main__":
    main()
