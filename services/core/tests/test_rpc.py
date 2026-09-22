from __future__ import annotations

import asyncio
import json
from io import BytesIO
import os
import queue
import shutil
import subprocess
import sys
import threading
import tempfile
import unittest
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from supervideo_core.media.errors import MediaError
from supervideo_core.rpc.errors import error_payload
from supervideo_core.rpc.server import RpcServer
from supervideo_core.rpc.models import (
    HealthParams,
    RpcRequest,
    SmokeCountdownParams,
    health_result,
    is_valid_rpc_message,
    validate_request,
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

    def test_b10_request_health_capability_and_error_codes_are_stable(self) -> None:
        request = {
            "jsonrpc": "2.0",
            "id": "slot-align-1",
            "method": "media.script.align",
            "params": {
                "projectId": "11111111-1111-4111-8111-111111111111",
                "inputKind": "outline",
                "inputText": "1. 岗位介绍\n2. 月薪 8000 元",
                "candidateLimit": 5,
                "useRerank": True,
                "timeoutMs": 120000,
            },
        }
        self.assertEqual(validate_request(request).method, "media.script.align")
        invalid = {**request, "params": {**request["params"], "path": "C:\\secret\\source.mp4"}}
        with self.assertRaises(ValidationError):
            validate_request(invalid)
        self.assertIn("media.script.align", health_result()["capabilities"])
        self.assertIn("plan.optimize_duration", health_result()["capabilities"])
        self.assertIn("media.aroll.cut_join", health_result()["capabilities"])
        self.assertIn("media.subtitle.plan", health_result()["capabilities"])
        self.assertIn("media.preview.render", health_result()["capabilities"])
        expected_codes = {
            "SLOT_INPUT_INVALID": -32346,
            "SLOT_SOURCE_INVALID": -32347,
            "SLOT_SOURCE_STALE": -32348,
            "SLOT_RETRIEVAL_INVALID": -32349,
            "SLOT_OUTPUT_INVALID": -32350,
            "SLOT_TIMEOUT": -32351,
            "SLOT_CANCELLED": -32352,
            "DURATION_OPTIMIZATION_INPUT_INVALID": -32360,
            "DURATION_OPTIMIZATION_SOURCE_INVALID": -32361,
            "DURATION_OPTIMIZATION_ALIGNMENT_INVALID": -32362,
            "DURATION_OPTIMIZATION_OUTPUT_INVALID": -32363,
            "DURATION_OPTIMIZATION_TIMEOUT": -32364,
            "DURATION_OPTIMIZATION_CANCELLED": -32365,
            "AROLL_CUT_JOIN_INPUT_INVALID": -32366,
            "AROLL_CUT_JOIN_TIMELINE_INVALID": -32367,
            "AROLL_CUT_JOIN_SOURCE_INVALID": -32368,
            "AROLL_CUT_JOIN_OUTPUT_INVALID": -32369,
            "AROLL_CUT_JOIN_TOOL_UNAVAILABLE": -32370,
            "AROLL_CUT_JOIN_TOOL_TIMEOUT": -32371,
            "AROLL_CUT_JOIN_CANCELLED": -32372,
            "AROLL_CUT_JOIN_TIMEOUT": -32373,
            "SUBTITLE_INPUT_INVALID": -32374,
            "SUBTITLE_TIMELINE_INVALID": -32375,
            "SUBTITLE_SOURCE_INVALID": -32376,
            "SUBTITLE_TIMECODE_INVALID": -32377,
            "SUBTITLE_OVERLAP": -32378,
            "SUBTITLE_TEXT_INVALID": -32379,
            "SUBTITLE_LINE_COUNT_INVALID": -32380,
            "SUBTITLE_LINE_WIDTH_INVALID": -32381,
            "SUBTITLE_OUTPUT_INVALID": -32382,
            "SUBTITLE_TIMEOUT": -32383,
            "SUBTITLE_CANCELLED": -32384,
        }
        for error_code, code in expected_codes.items():
            with self.subTest(error_code=error_code):
                self.assertEqual(error_payload(error_code)["code"], code)

    def test_c04_aroll_request_uses_timeline_source_contract(self) -> None:
        timeline = json.loads((ROOT / "tests" / "fixtures" / "c04_aroll_cut_join_v1.json").read_text(encoding="utf-8"))
        request = {
            "jsonrpc": "2.0",
            "id": "aroll-cut-join-1",
            "method": "media.aroll.cut_join",
            "params": {
                "projectId": "99999999-9999-4999-8999-999999999999",
                "timeline": timeline,
                "mode": "video",
                "trackId": "track-video-aroll",
            },
        }
        self.assertEqual(validate_request(request).method, "media.aroll.cut_join")
        invalid = {**request, "params": {**request["params"], "command": "ffmpeg"}}
        with self.assertRaises(ValidationError):
            validate_request(invalid)

    def test_c05_subtitle_request_uses_versioned_timeline_contract(self) -> None:
        timeline = json.loads((ROOT / "tests" / "fixtures" / "c01_timeline_ir_v1.json").read_text(encoding="utf-8"))
        request = {
            "jsonrpc": "2.0",
            "id": "subtitle-plan-1",
            "method": "media.subtitle.plan",
            "params": {
                "projectId": "99999999-9999-4999-8999-999999999999",
                "timeline": timeline,
                "maxLines": 2,
                "maxLineWidth": 32,
                "sentenceSources": [],
            },
        }
        self.assertEqual(validate_request(request).method, "media.subtitle.plan")

    def test_c06_preview_request_is_registered_and_does_not_accept_commands(self) -> None:
        request = {
            "jsonrpc": "2.0",
            "id": "preview-render-1",
            "method": "media.preview.render",
            "params": {"projectId": "99999999-9999-4999-8999-999999999999", "arollPlan": {}, "subtitlePlan": {}},
        }
        with self.assertRaises(ValidationError):
            validate_request(request)
        request["params"]["command"] = "ffmpeg"
        with self.assertRaises(ValidationError):
            validate_request(request)
        invalid = {**request, "params": {**request["params"], "command": "render"}}
        with self.assertRaises(ValidationError):
            validate_request(invalid)


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

    def test_c05_subtitle_plan_is_active_busy_and_cancelable(self) -> None:
        async def scenario() -> list[dict[str, Any]]:
            output = BytesIO()
            server = RpcServer(stdin=BytesIO(), stdout=output)
            started = asyncio.Event()

            async def waiting_invoke(_method: str, _params: object, _emit: Any, cancelled: asyncio.Event) -> dict[str, object]:
                started.set()
                await cancelled.wait()
                raise MediaError("SUBTITLE_CANCELLED")

            server.registry.invoke = waiting_invoke  # type: ignore[method-assign]
            first = RpcRequest.model_validate({"jsonrpc": "2.0", "id": "subtitle-active", "method": "media.subtitle.plan", "params": {}})
            second = RpcRequest.model_validate({"jsonrpc": "2.0", "id": "subtitle-busy", "method": "media.subtitle.plan", "params": {}})
            await server.dispatch(first)
            await started.wait()
            self.assertEqual(server.active_request_id, first.id)
            await server.dispatch(second)
            self.assertTrue(server.cancel(first.id))
            active_task = server.active_task
            assert active_task is not None
            await active_task
            await server.close()
            return [json.loads(line) for line in output.getvalue().decode("utf-8").splitlines()]

        messages = asyncio.run(scenario())
        self.assertEqual(next(item for item in messages if item.get("id") == "subtitle-busy")["error"]["data"]["errorCode"], "BUSY")
        self.assertEqual(next(item for item in messages if item.get("id") == "subtitle-active")["error"]["data"]["errorCode"], "SUBTITLE_CANCELLED")

    def test_project_and_asset_methods_use_a_scoped_session(self) -> None:
        import shutil
        import tempfile

        temp_root = Path(tempfile.mkdtemp(prefix="supervideo rpc project "))
        project_root = temp_root / "项目 with spaces"
        project_root.mkdir()
        asset_path = temp_root / "voice.mp4"
        asset_path.write_bytes(b"fixed rpc fixture")
        scan_directory = temp_root / "scan directory"
        scan_directory.mkdir()
        (scan_directory / "scan.mp4").write_bytes(b"scan video fixture")
        (scan_directory / "scan.mp3").write_bytes(b"scan audio fixture")
        try:
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": "project-create",
                    "method": "project.create",
                    "params": {"name": "RPC project", "targetPlatform": "douyin", "projectRoot": str(project_root)},
                }
            )
            created = self.read_line()["result"]
            self.assertEqual(created["databaseSchemaVersion"], 2)
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": "asset-reference",
                    "method": "asset.reference",
                    "params": {"projectId": created["projectId"], "paths": [str(asset_path)]},
                }
            )
            referenced = self.read_line()["result"]
            self.assertEqual(referenced["items"][0]["referenceStatus"], "added")
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": "asset-scan",
                    "method": "asset.scan",
                    "params": {"projectId": created["projectId"], "directory": str(scan_directory)},
                }
            )
            scanned = self.read_line()["result"]
            self.assertEqual(scanned["directory"], os.path.normcase(str(scan_directory.resolve())))
            self.assertEqual([item["kind"] for item in scanned["items"]], ["audio", "video"])
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": "asset-list",
                    "method": "asset.list",
                    "params": {"projectId": created["projectId"], "limit": 10},
                }
            )
            listed = self.read_line()["result"]
            self.assertEqual(len(listed["items"]), 3)
        finally:
            shutil.rmtree(temp_root, ignore_errors=True)

    def test_media_probe_and_proxy_are_scoped_and_cacheable(self) -> None:
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg is None or shutil.which("ffprobe") is None:
            self.skipTest("B02 RPC integration requires allowlisted ffprobe and FFmpeg")
        temp_root = Path(tempfile.mkdtemp(prefix="supervideo rpc media "))
        project_root = temp_root / "project"
        project_root.mkdir()
        asset_path = temp_root / "fixture.mp4"
        subprocess.run(
            [ffmpeg, "-y", "-f", "lavfi", "-i", "color=c=red:s=160x90:d=0.3", "-f", "lavfi", "-i", "sine=frequency=800:duration=0.3", "-shortest", "-c:v", "libx264", "-c:a", "aac", str(asset_path)],
            check=True,
            capture_output=True,
        )
        original = asset_path.read_bytes()
        try:
            self.send({"jsonrpc": "2.0", "id": "media-project", "method": "project.create", "params": {"name": "Media RPC", "targetPlatform": "douyin", "projectRoot": str(project_root)}})
            project = self.read_line()["result"]
            self.send({"jsonrpc": "2.0", "id": "media-asset", "method": "asset.reference", "params": {"projectId": project["projectId"], "paths": [str(asset_path)]}})
            asset = self.read_line()["result"]["items"][0]
            params = {"projectId": project["projectId"], "assetId": asset["assetId"], "timeoutMs": 120000}
            self.send({"jsonrpc": "2.0", "id": "media-probe", "method": "media.probe", "params": params})
            probe = self.read_line()["result"]
            self.assertEqual(probe["cacheStatus"], "created")
            self.assertTrue(probe["metadata"]["streams"])
            self.send({"jsonrpc": "2.0", "id": "media-probe-hit", "method": "media.probe", "params": params})
            self.assertEqual(self.read_line()["result"]["cacheStatus"], "cache-hit")
            self.send({"jsonrpc": "2.0", "id": "media-proxy", "method": "media.proxy", "params": params})
            proxy = self.read_line()["result"]
            self.assertEqual(len(proxy["outputs"]), 3)
            self.assertEqual(asset_path.read_bytes(), original)
        finally:
            shutil.rmtree(temp_root, ignore_errors=True)

    def test_media_cancel_preserves_stable_media_error_code(self) -> None:
        async def scenario() -> dict[str, Any]:
            output = BytesIO()
            server = RpcServer(stdin=BytesIO(), stdout=output)
            request = RpcRequest.model_validate({"jsonrpc": "2.0", "id": "media-cancel", "method": "media.probe", "params": {"projectId": "11111111-1111-4111-8111-111111111111", "assetId": "22222222-2222-4222-8222-222222222222"}})

            async def cancelled_invoke(*_args: Any, **_kwargs: Any) -> dict[str, object]:
                raise MediaError("MEDIA_CANCELLED")

            server.registry.invoke = cancelled_invoke  # type: ignore[method-assign]
            server.active_request_id = request.id
            server.active_cancel = asyncio.Event()
            await server.execute_active(request)
            return json.loads(output.getvalue().decode("utf-8"))

        message = asyncio.run(scenario())
        self.assertEqual(message["error"]["data"]["errorCode"], "MEDIA_CANCELLED")

    def test_persistent_job_returns_fast_and_streams_durable_events(self) -> None:
        import shutil
        import tempfile

        temp_root = Path(tempfile.mkdtemp(prefix="supervideo rpc jobs "))
        project_root = temp_root / "项目 with spaces"
        project_root.mkdir()
        try:
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": "job-project-create",
                    "method": "project.create",
                    "params": {"name": "RPC jobs", "targetPlatform": "douyin", "projectRoot": str(project_root)},
                }
            )
            project = self.read_line()["result"]
            project_id = project["projectId"]
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": "job-start",
                    "method": "job.smoke.start",
                    "params": {
                        "projectId": project_id,
                        "idempotencyKey": "rpc-job-key",
                        "steps": 3,
                        "delayMs": 1,
                        "failAttempts": 0,
                    },
                }
            )
            messages = [self.read_line() for _ in range(7)]
            response = next(message for message in messages if message.get("id") == "job-start")
            self.assertEqual(response["result"]["status"], "queued")
            job_id = response["result"]["jobId"]
            events = [message["params"] for message in messages if message.get("method") == "core.job.event"]
            self.assertEqual([event["sequence"] for event in events], list(range(1, 7)))
            self.assertEqual(events[-1]["status"], "succeeded")
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": "job-events",
                    "method": "job.events.list",
                    "params": {"projectId": project_id, "jobId": job_id, "afterSequence": 3, "limit": 10},
                }
            )
            persisted = self.read_line()["result"]
            self.assertEqual([event["sequence"] for event in persisted["items"]], [4, 5, 6])
        finally:
            shutil.rmtree(temp_root, ignore_errors=True)

    def test_abrupt_core_exit_leaves_recoverable_sqlite_state(self) -> None:
        import shutil
        import tempfile

        temp_root = Path(tempfile.mkdtemp(prefix="supervideo rpc abrupt jobs "))
        project_root = temp_root / "abrupt project"
        project_root.mkdir()
        try:
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": "abrupt-project-create",
                    "method": "project.create",
                    "params": {"name": "Abrupt jobs", "targetPlatform": "douyin", "projectRoot": str(project_root)},
                }
            )
            project_id = self.read_line()["result"]["projectId"]
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": "abrupt-job-start",
                    "method": "job.smoke.start",
                    "params": {
                        "projectId": project_id,
                        "idempotencyKey": "abrupt-key",
                        "steps": 8,
                        "delayMs": 20,
                        "failAttempts": 0,
                    },
                }
            )
            start_messages: list[dict[str, Any]] = []
            while not any(message.get("id") == "abrupt-job-start" for message in start_messages) or not any(
                message.get("method") == "core.job.event" and message["params"]["progress"] > 0 for message in start_messages
            ):
                start_messages.append(self.read_line())
                if len(start_messages) > 20:
                    raise AssertionError("job did not persist progress before abrupt exit")
            start_response = next(message for message in start_messages if message.get("id") == "abrupt-job-start")
            job_id = start_response["result"]["jobId"]
            self.assertTrue(any(message.get("method") == "core.job.event" and message["params"]["progress"] > 0 for message in start_messages))
            old_process = self.process
            old_process.kill()
            old_process.wait(timeout=3)
            if old_process.stdout:
                old_process.stdout.close()
            if old_process.stderr:
                old_process.stderr.close()
            if old_process.stdin:
                old_process.stdin.close()

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

            def read_until(request_id: str) -> dict[str, Any]:
                for _ in range(20):
                    message = self.read_line()
                    if message.get("id") == request_id:
                        return message
                raise AssertionError("RPC response was not observed")

            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": "abrupt-project-open",
                    "method": "project.open",
                    "params": {"projectRoot": str(project_root)},
                }
            )
            self.assertEqual(read_until("abrupt-project-open")["result"]["projectId"], project_id)
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": "abrupt-job-get",
                    "method": "job.get",
                    "params": {"projectId": project_id, "jobId": job_id},
                }
            )
            recovered = read_until("abrupt-job-get")["result"]
            self.assertIn(recovered["status"], {"retrying", "running", "succeeded"})
            self.assertGreaterEqual(recovered["attempt"], 1)
        finally:
            if self.process.poll() is None:
                self.process.terminate()
            shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
