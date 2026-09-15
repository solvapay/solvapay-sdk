from __future__ import annotations

import asyncio
import inspect
import json

from solvapay.errors import SolvaPayError
from solvapay.facade import SolvaPay

from solvapay_mcp.server.native import unwrap_client_envelope


def facade_api_client(solvapay: SolvaPay) -> object:
    getter = getattr(solvapay, "get_api_client", None)
    if callable(getter):
        return getter()
    return object.__getattribute__(solvapay, "_bound_client")


class DeferredApiClient:
    def __init__(self, solvapay: SolvaPay) -> None:
        self._solvapay = solvapay

    def __getattr__(self, name: str) -> object:
        return getattr(facade_api_client(self._solvapay), name)


async def _invoke(client: object, method: str, payload: dict[str, object]) -> object:
    encoded = json.dumps(payload)
    blocking = getattr(client, f"{method}_blocking", None)
    if callable(blocking) and not inspect.iscoroutinefunction(blocking):
        raw = await asyncio.to_thread(blocking, encoded)
    else:
        fn = getattr(client, method, None)
        if not callable(fn):
            raise SolvaPayError(f"{method} method not available")
        raw = fn(encoded)
        if asyncio.iscoroutine(raw):
            raw = await raw
    if not isinstance(raw, str):
        raise SolvaPayError(f"{method} returned unexpected envelope")
    return unwrap_client_envelope(raw)
