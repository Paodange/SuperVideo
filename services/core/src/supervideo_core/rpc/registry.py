"""Explicit, non-dynamic RPC method registry."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, ValidationError

from .errors import RpcServiceError
from .models import HealthParams, SmokeCountdownParams, health_result

ProgressEmitter = Callable[[int, float, str], Awaitable[None]]


async def health_handler(_params: HealthParams, _emit: ProgressEmitter, _cancelled: asyncio.Event) -> dict[str, object]:
    return health_result()


async def countdown_handler(
    params: SmokeCountdownParams,
    emit: ProgressEmitter,
    cancelled: asyncio.Event,
) -> dict[str, object]:
    for step in range(1, params.steps + 1):
        try:
            await asyncio.wait_for(cancelled.wait(), timeout=params.delay_ms / 1_000)
        except TimeoutError:
            pass
        if cancelled.is_set():
            raise RpcServiceError("REQUEST_CANCELLED")
        await emit(step, step / params.steps, f"step-{step}")
    return {"status": "completed", "steps": params.steps}


class RpcRegistry:
    """Registry whose method names are all explicit source-level entries."""

    def __init__(self) -> None:
        self._methods: dict[str, tuple[type[BaseModel], Callable[..., Awaitable[dict[str, object]]]]] = {
            "core.health": (HealthParams, health_handler),
            "core.smoke.countdown": (SmokeCountdownParams, countdown_handler),
        }

    def contains(self, method: str) -> bool:
        return method in self._methods

    def validate_params(self, method: str, params: object) -> BaseModel:
        spec = self._methods.get(method)
        if spec is None:
            raise RpcServiceError("METHOD_NOT_FOUND")
        params_model, _handler = spec
        try:
            return params_model.model_validate(params)
        except ValidationError as error:
            raise RpcServiceError("INVALID_PARAMS") from error

    async def invoke(
        self,
        method: str,
        params: object,
        emit: ProgressEmitter,
        cancelled: asyncio.Event,
    ) -> dict[str, object]:
        spec = self._methods.get(method)
        if spec is None:
            raise RpcServiceError("METHOD_NOT_FOUND")
        params_model = self.validate_params(method, params)
        return await spec[1](params_model, emit, cancelled)
