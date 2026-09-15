from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import unittest
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from supervideo_core.rpc.models import (
    HealthParams,
    SmokeCountdownParams,
    is_valid_rpc_message,
    validate_rpc_message,
)


ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "contracts" / "core-rpc-fixtures.json"


class RpcModelTests(unittest.TestCase):
    def test_golden_fixture_acceptance_matches_expected(self) -> None:
        fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))
        for fixture in fixtures:
            with self.subTest(fixture=fixture["name"]):
                self.assertEqual(is_valid_rpc_message(fixture["message"]), fixture["valid"])

    def test_known_params_are_strict_and_forbid_extra_fields(self) -> None:
        self.assertEqual(HealthParams.model_validate({}).model_dump(), {})
        with self.assertRaises(ValidationError):
            HealthParams.model_validate({"unexpected": True})
        with self.assertRaises(ValidationError):
            SmokeCountdownParams.model_validate({"steps": "4", "delayMs": 25})
        with self.assertRaises(ValidationError):
            SmokeCountdownParams.model_validate({"steps": 4, "delayMs": 25, "extra": False})

    def test_unknown_method_is_a_valid_envelope_but_not_a_registered_method(self) -> None:
        message = {
            "jsonrpc": "2.0",
            "id": "unknown-method",
            "method": "core.no_such_method",
            "params": {},
        }
        self.assertTrue(is_valid_rpc_message(message))
        self.assertEqual(validate_rpc_message(message).method, "core.no_such_method")


class RpcServerTests(unittest.TestCase):
    def setUp(self) -> None:
        source = ROOT / "services" / "core" / "src"
        environment = {**os.environ, "PYTHONPATH": str(source)}
        self.process = subprocess.Popen(
            [sys.executable, "-m", "supervideo_core.rpc"],
            cwd=ROOT,
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def tearDown(self) -> None:
        if self.process.stdin:
            self.process.stdin.close()
        if self.process.poll() is None:
            self.process.terminate()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=3)
        if self.process.stdout:
            self.process.stdout.close()
        if self.process.stderr:
            self.process.stderr.close()

    def send(self, message: str | dict[str, Any]) -> None:
        assert self.process.stdin is not None
        payload = message if isinstance(message, str) else json.dumps(message, separators=(",", ":"))
        self.process.stdin.write((payload + "\n").encode("utf-8"))
        self.process.stdin.flush()

    def read_line(self) -> dict[str, Any]:
        assert self.process.stdout is not None
        result: queue.Queue[bytes] = queue.Queue()

        def read() -> None:
            assert self.process.stdout is not None
            result.put(self.process.stdout.readline())

        threading.Thread(target=read, daemon=True).start()
        raw = result.get(timeout=3)
        self.assertTrue(raw, "Python RPC server closed stdout before replying")
        return json.loads(raw)

    def test_bad_messages_do_not_kill_server_and_next_health_succeeds(self) -> None:
        self.send("not-json")
        self.assertEqual(self.read_line()["error"]["data"]["errorCode"], "PARSE_ERROR")
        self.send(json.dumps([{"jsonrpc": "2.0"}]))
        self.assertEqual(self.read_line()["error"]["data"]["errorCode"], "INVALID_REQUEST")
        self.send("x" * (256 * 1024 + 1))
        self.assertEqual(self.read_line()["error"]["data"]["errorCode"], "MESSAGE_TOO_LARGE")
        self.send({"jsonrpc": "1.0", "id": "bad-version", "method": "core.health", "params": {}})
        self.assertEqual(self.read_line()["error"]["data"]["errorCode"], "PROTOCOL_MISMATCH")
        self.send({"jsonrpc": "2.0", "id": "health-after-errors", "method": "core.health", "params": {}})
        self.assertEqual(self.read_line()["result"]["status"], "ok")

    def test_countdown_streams_progress_and_cancel_is_scoped(self) -> None:
        self.send(
            {
                "jsonrpc": "2.0",
                "id": "countdown-1",
                "method": "core.smoke.countdown",
                "params": {"steps": 4, "delayMs": 100},
            }
        )
        first = self.read_line()
        self.assertEqual(first["method"], "core.progress")
        self.assertEqual(first["params"]["requestId"], "countdown-1")
        self.send({"jsonrpc": "2.0", "method": "core.cancel", "params": {"requestId": "wrong-id"}})
        self.send({"jsonrpc": "2.0", "method": "core.cancel", "params": {"requestId": "countdown-1"}})
        cancelled = self.read_line()
        self.assertEqual(cancelled["id"], "countdown-1")
        self.assertEqual(cancelled["error"]["data"]["errorCode"], "REQUEST_CANCELLED")

    def test_second_long_call_is_busy_without_replacing_first(self) -> None:
        self.send(
            {
                "jsonrpc": "2.0",
                "id": "first-long-call",
                "method": "core.smoke.countdown",
                "params": {"steps": 3, "delayMs": 25},
            }
        )
        self.send(
            {
                "jsonrpc": "2.0",
                "id": "second-long-call",
                "method": "core.smoke.countdown",
                "params": {"steps": 3, "delayMs": 25},
            }
        )
        messages = [self.read_line() for _ in range(5)]
        busy = next(message for message in messages if message.get("id") == "second-long-call")
        self.assertEqual(busy["error"]["data"]["errorCode"], "BUSY")
        progress = [message for message in messages if message.get("method") == "core.progress"]
        self.assertEqual([item["params"]["sequence"] for item in progress], [1, 2, 3])
        result = next(message for message in messages if message.get("id") == "first-long-call")
        self.assertEqual(result["result"], {"status": "completed", "steps": 3})

    def test_duplicate_active_request_id_is_rejected(self) -> None:
        request = {
            "jsonrpc": "2.0",
            "id": "duplicate-active-call",
            "method": "core.smoke.countdown",
            "params": {"steps": 3, "delayMs": 25},
        }
        self.send(request)
        self.send(request)
        messages = [self.read_line() for _ in range(5)]
        duplicate = next(message for message in messages if message.get("id") == request["id"] and "error" in message)
        self.assertEqual(duplicate["error"]["data"]["errorCode"], "DUPLICATE_REQUEST_ID")
        self.assertEqual([item["params"]["sequence"] for item in messages if item.get("method") == "core.progress"], [1, 2, 3])


if __name__ == "__main__":
    unittest.main()
