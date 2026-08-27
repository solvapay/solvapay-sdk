from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Literal

from solvapay_mcp.core import call

SolvaPayToolMode = Literal["ui", "text", "auto"]


def parse_mode(raw: object) -> SolvaPayToolMode:
    if raw == "ui":
        return "ui"
    if raw == "text":
        return "text"
    if raw == "auto":
        return "auto"
    return "ui"


def tool_result(data: object) -> dict[str, object]:
    return {
        "content": [{"type": "text", "text": json.dumps(data)}],
        "structuredContent": data,
    }


def tool_error_result(error: Mapping[str, object]) -> dict[str, object]:
    details = error.get("details")
    message = details if isinstance(details, str) and details else str(error.get("error") or "")
    return {
        "isError": True,
        "content": [{"type": "text", "text": message}],
        "structuredContent": dict(error),
    }


def preview_json(value: object, max_len: int = 400) -> str:
    try:
        encoded = json.dumps(value)
    except TypeError:
        return str(value)
    if len(encoded) > max_len:
        return f"{encoded[:max_len]}…(+{len(encoded) - max_len} chars)"
    return encoded


def narrated_tool_result(
    tool: str,
    data: Mapping[str, object],
    mode: SolvaPayToolMode = "ui",
    base_meta: Mapping[str, object] | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "tool": tool,
        "payload": dict(data),
        "mode": mode,
    }
    if base_meta is not None:
        payload["meta"] = dict(base_meta)
    value = call("mcpNarrate", payload)
    if not isinstance(value, dict):
        raise TypeError("mcpNarrate did not return a tool result object")
    return {str(k): v for k, v in value.items()}
