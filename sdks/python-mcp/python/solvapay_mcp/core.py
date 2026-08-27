from __future__ import annotations

import json
from collections.abc import Mapping, Sequence


def native_available() -> bool:
    try:
        from solvapay._solvapay import solvapay_call  # type: ignore[attr-defined]
    except ImportError:
        return False
    return callable(solvapay_call)


def call(op: str, args: Mapping[str, object] | None = None) -> object:
    try:
        from solvapay._solvapay import solvapay_call  # type: ignore[attr-defined]
    except ImportError as exc:
        raise RuntimeError("SolvaPay native MCP API is not installed") from exc
    if not callable(solvapay_call):
        raise RuntimeError("SolvaPay native MCP API is not installed")

    payload = json.dumps({"op": op, "args": dict(args) if args else {}})
    envelope = json.loads(solvapay_call(payload))
    if not isinstance(envelope, dict) or envelope.get("ok") is not True:
        message = "mcp op failed"
        error = envelope.get("error") if isinstance(envelope, dict) else None
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            message = error["message"]
        raise RuntimeError(message)
    return envelope.get("value")


def hide_tools_by_audience(
    tools: Sequence[Mapping[str, object]],
    audiences: Sequence[str],
    user_agent: str | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "tools": [dict(item) for item in tools],
        "audiences": list(audiences),
    }
    if user_agent is not None:
        payload["userAgent"] = user_agent
    value = call("mcpHideToolsByAudience", payload)
    if not isinstance(value, dict):
        raise TypeError("mcpHideToolsByAudience did not return an object")
    return {str(k): v for k, v in value.items()}
