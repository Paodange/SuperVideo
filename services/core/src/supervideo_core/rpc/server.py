"""Async JSON Lines server for the local Python Core subprocess."""

from __future__ import annotations

import asyncio
import contextlib
import json
import sys
from typing import Any, BinaryIO

from pydantic import ValidationError

from supervideo_core.project.errors import ProjectError
from supervideo_core.jobs.errors import JobError
from supervideo_core.media.errors import MediaError
from supervideo_core.observability import StructuredDiagnosticLogger

from .errors import RpcServiceError, error_response
from .models import (
    CORE_RPC_MAX_LINE_BYTES,
    JSON_RPC_VERSION,
    RpcCancelNotification,
    RpcRequest,
    REQUEST_ID_PATTERN,
    validate_request,
)
from .registry import RpcRegistry


def read_bounded_line(stream: BinaryIO, maximum: int) -> tuple[bytes, bool] | None:
    """Read one line while retaining at most maximum+1 bytes in memory."""

    first = stream.readline(maximum + 1)
    if first == b"":
        return None
    captured = bytearray(first[: maximum + 1])
    total = len(first)
    while not first.endswith(b"\n"):
        first = stream.readline(8_192)
        if first == b"":
            break
        total += len(first)
        if len(captured) <= maximum:
            captured.extend(first[: maximum + 1 - len(captured)])
    value = bytes(captured)
    if value.endswith(b"\n"):
        value = value[:-1]
    if value.endswith(b"\r"):
        value = value[:-1]
    return value, total > maximum


class RpcServer:
    def __init__(self, stdin: BinaryIO | None = None, stdout: BinaryIO | None = None, logger: StructuredDiagnosticLogger | None = None) -> None:
        self.stdin = stdin or sys.stdin.buffer
        self.stdout = stdout or sys.stdout.buffer
        self.registry = RpcRegistry(on_job_event=self._on_job_event)
        self.writer_lock = asyncio.Lock()
        self.active_request_id: str | None = None
        self.active_cancel: asyncio.Event | None = None
        self.active_task: asyncio.Task[None] | None = None
        self.closing = False
        self.logger = logger or StructuredDiagnosticLogger()

    async def serve(self) -> None:
        self.logger.emit("core-started")
        while not self.closing:
            line = await asyncio.to_thread(read_bounded_line, self.stdin, CORE_RPC_MAX_LINE_BYTES)
            if line is None:
                break
            await self.handle_line(*line)
        await self.close()

    async def handle_line(self, raw_line: bytes, too_large: bool = False) -> None:
        if too_large:
            await self.send_error(None, "MESSAGE_TOO_LARGE")
            return
        if not raw_line.strip():
            await self.send_error(None, "INVALID_REQUEST")
            return
        try:
            text = raw_line.decode("utf-8")
            value = json.loads(text, parse_constant=self._reject_non_finite)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
            await self.send_error(None, "PARSE_ERROR")
            return
        if isinstance(value, list) or not isinstance(value, dict):
            await self.send_error(None, "INVALID_REQUEST")
            return
        if value.get("jsonrpc") != JSON_RPC_VERSION:
            await self.send_error(self.safe_request_id(value), "PROTOCOL_MISMATCH")
            return
        if value.get("method") == "core.cancel" and "id" not in value:
            try:
                notification = RpcCancelNotification.model_validate(value)
            except ValidationError:
                await self.send_error(None, "INVALID_PARAMS")
                return
            self.cancel(notification.params.request_id)
            return
        if "id" not in value or "method" not in value:
            await self.send_error(self.safe_request_id(value), "INVALID_REQUEST")
            return
        try:
            request = RpcRequest.model_validate(value)
        except ValidationError:
            await self.send_error(self.safe_request_id(value), "INVALID_REQUEST")
            return
        try:
            validate_request(value)
        except ValidationError:
            await self.send_error(request.id, "INVALID_PARAMS")
            return
        except ValueError:
            await self.send_error(request.id, "INVALID_REQUEST")
            return
        await self.dispatch(request)

    async def dispatch(self, request: RpcRequest) -> None:
        self.logger.emit("core-request-started", request_id=request.id, details={"method": request.method})
        if request.method in {"core.smoke.countdown", "media.probe", "media.proxy", "media.transcribe", "media.vad", "media.sentences", "media.sentences.index", "media.sentences.retrieve", "media.script.align", "plan.create_remix", "media.aroll.cut_join"}:
            if self.active_request_id == request.id:
                await self.send_error(request.id, "DUPLICATE_REQUEST_ID")
                return
            if self.active_request_id is not None:
                await self.send_error(request.id, "BUSY")
                return
            self.active_request_id = request.id
            self.active_cancel = asyncio.Event()
            self.active_task = asyncio.create_task(self.execute_active(request))
            return
        try:
            result = await self.registry.invoke(request.method, request.params, self.emit_progress, asyncio.Event())
        except RpcServiceError as error:
            self.logger.emit("core-request-failed", request_id=request.id, error_code=error.error_code, level="warn")
            await self.send_error(request.id, error.error_code)
        except ProjectError as error:
            self.logger.emit("core-request-failed", request_id=request.id, error_code=error.code, level="warn")
            await self.send_error(request.id, error.code)
        except JobError as error:
            self.logger.emit("core-request-failed", request_id=request.id, error_code=error.code, level="warn")
            await self.send_error(request.id, error.code)
        except MediaError as error:
            self.logger.emit("core-request-failed", request_id=request.id, error_code=error.code, level="warn")
            await self.send_error(request.id, error.code)
        except Exception:
            self.logger.emit("core-request-failed", request_id=request.id, error_code="INTERNAL_ERROR", level="error")
            await self.send_error(request.id, "INTERNAL_ERROR")
        else:
            if request.method == "core.health" and isinstance(result, dict):
                self.logger.emit("core-ready", details={"coreVersion": result.get("coreVersion", "unknown"), "capabilityCount": len(result.get("capabilities", [])) if isinstance(result.get("capabilities"), list) else 0})
            self.logger.emit("core-request-finished", request_id=request.id)
            await self.send_result(request.id, result)

    async def execute_active(self, request: RpcRequest) -> None:
        cancelled = self.active_cancel or asyncio.Event()
        try:
            result = await self.registry.invoke(request.method, request.params, self.emit_progress, cancelled)
        except RpcServiceError as error:
            if not self.closing:
                self.logger.emit("core-request-failed", request_id=request.id, error_code=error.error_code, level="warn")
                await self.send_error(request.id, error.error_code)
        except MediaError as error:
            if not self.closing:
                self.logger.emit("core-request-failed", request_id=request.id, error_code=error.code, level="warn")
                await self.send_error(request.id, error.code)
        except ProjectError as error:
            if not self.closing:
                self.logger.emit("core-request-failed", request_id=request.id, error_code=error.code, level="warn")
                await self.send_error(request.id, error.code)
        except asyncio.CancelledError:
            if not self.closing:
                self.logger.emit("core-request-failed", request_id=request.id, error_code="REQUEST_CANCELLED", level="warn")
                await self.send_error(request.id, "REQUEST_CANCELLED")
        except Exception:
            if not self.closing:
                self.logger.emit("core-request-failed", request_id=request.id, error_code="INTERNAL_ERROR", level="error")
                await self.send_error(request.id, "INTERNAL_ERROR")
        else:
            if not self.closing:
                self.logger.emit("core-request-finished", request_id=request.id)
                await self.send_result(request.id, result)
        finally:
            if self.active_request_id == request.id:
                self.active_request_id = None
                self.active_cancel = None
                self.active_task = None

    def cancel(self, request_id: str) -> bool:
        if self.active_request_id != request_id or self.active_cancel is None:
            return False
        self.active_cancel.set()
        return True

    async def emit_progress(self, sequence: int, progress: float, message: str) -> None:
        if self.active_request_id is None:
            return
        await self.send_message(
            {
                "jsonrpc": JSON_RPC_VERSION,
                "method": "core.progress",
                "params": {
                    "requestId": self.active_request_id,
                    "sequence": sequence,
                    "progress": progress,
                    "message": message,
                },
            }
        )

    async def send_result(self, request_id: str, result: object) -> None:
        message = {"jsonrpc": JSON_RPC_VERSION, "id": request_id, "result": result}
        if not await self.send_message(message):
            await self.send_error(request_id, "MESSAGE_TOO_LARGE")

    async def send_error(self, request_id: str | None, error_code: str) -> None:
        await self.send_message(error_response(request_id, error_code))

    async def send_message(self, message: dict[str, object]) -> bool:
        encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(encoded) > CORE_RPC_MAX_LINE_BYTES:
            return False
        async with self.writer_lock:
            try:
                self.stdout.write(encoded + b"\n")
                self.stdout.flush()
            except (BrokenPipeError, OSError):
                self.closing = True
                return False
        return True

    async def close(self) -> None:
        if self.closing and self.active_task is None:
            await self.registry.shutdown()
            self.logger.emit("core-exit")
            return
        self.closing = True
        task = self.active_task
        if task is not None and not task.done():
            if self.active_cancel is not None:
                self.active_cancel.set()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=1.0)
        self.active_request_id = None
        self.active_cancel = None
        self.active_task = None
        await self.registry.shutdown()
        self.logger.emit("core-exit")

    def _on_job_event(self, event: object) -> None:
        if self.closing:
            return
        if not hasattr(event, "project_id"):
            return
        self.logger.emit(
            "job-event",
            project_id=str(event.project_id),
            job_id=str(event.job_id),
            details={"sequence": event.sequence, "status": event.status, "eventType": event.event_type, "progress": event.progress},
        )
        self._schedule_job_event(event)

    def _schedule_job_event(self, event: object) -> None:
        """Publish only after the repository transaction has returned."""

        asyncio.create_task(self.send_job_event(event))

    async def send_job_event(self, event: object) -> None:
        try:
            await self.send_message({
                "jsonrpc": JSON_RPC_VERSION,
                "method": "core.job.event",
                "params": {
                    "projectId": event.project_id,
                    "jobId": event.job_id,
                    "sequence": event.sequence,
                    "eventType": event.event_type,
                    "status": event.status,
                    "progress": event.progress,
                    "stage": event.stage,
                    "attempt": event.attempt,
                    "timestamp": event.created_at_ms,
                    "payload": event.payload_json,
                },
            })
        except Exception:
            # Notification delivery is best effort; the event is durable.
            return

    @staticmethod
    def safe_request_id(value: Any) -> str | None:
        candidate = value.get("id") if isinstance(value, dict) else None
        if isinstance(candidate, str) and len(candidate) <= 64 and REQUEST_ID_PATTERN.fullmatch(candidate) is not None:
            return candidate
        return None

    @staticmethod
    def _reject_non_finite(_value: str) -> object:
        raise ValueError("non-finite JSON number")


def main() -> None:
    asyncio.run(RpcServer().serve())


if __name__ == "__main__":
    main()
