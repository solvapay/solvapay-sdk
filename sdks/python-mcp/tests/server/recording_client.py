from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any


class RecordingClient:
    def __init__(self, responses: dict[str, Any] | None = None, *, delay: float = 0) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.responses = responses or {}
        self.delay = delay

    def _handle(self, method: str, args_json: str) -> str:
        payload = json.loads(args_json)
        if not isinstance(payload, dict):
            payload = {}
        self.calls.append((method, payload))
        if method in {"mcp_dispatch", "mcp_dispatch_blocking"} and "mcp_dispatch" not in self.responses:
            from solvapay_mcp.core import call

            value = call("mcpHandleRequest", payload)
            if isinstance(value, dict) and value.get("kind") == "callBuiltin":
                value = {
                    "kind": "rpc",
                    "rpc": {
                        "jsonrpc": "2.0",
                        "id": value.get("rpcId"),
                        "result": {
                            "content": [{"type": "text", "text": str(value.get("name") or "")}],
                            "isError": True,
                        },
                    },
                }
            elif isinstance(value, dict) and value.get("kind") == "readResource":
                uri = value.get("uri")
                text = "{}"
                if uri == "solvapay://bootstrap.json":
                    config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
                    text = json.dumps(
                        {
                            "productRef": config.get("productRef"),
                            "returnUrl": config.get("publicBaseUrl"),
                        }
                    )
                value = {
                    "kind": "rpc",
                    "rpc": {
                        "jsonrpc": "2.0",
                        "id": value.get("rpcId"),
                        "result": {
                            "contents": [
                                {
                                    "uri": uri,
                                    "mimeType": "application/json",
                                    "text": text,
                                }
                            ]
                        },
                    },
                }
            return json.dumps({"ok": True, "value": value})
        value = self.responses.get(method, {})
        if callable(value):
            value = value(payload)
        if isinstance(value, dict) and "error" in value and "ok" not in value:
            status = value.get("status", 500)
            return json.dumps(
                {
                    "ok": False,
                    "error": {
                        "kind": "Api",
                        "status": status,
                        "message": value.get("error") or "error",
                    },
                }
            )
        return json.dumps({"ok": True, "value": value})

    def __getattr__(self, name: str) -> Callable[[str], Any]:
        async def invoke(args_json: str) -> str:
            if self.delay:
                import asyncio

                await asyncio.sleep(self.delay)
            return self._handle(name, args_json)

        return invoke
