from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Literal

from solvapay_mcp.server.narrate import NARRATORS, ui_placeholder

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
    narrator = NARRATORS.get(tool)
    if narrator is None:
        fallback = tool_result(data)
        if mode == "text" and base_meta and "ui" in base_meta:
            rest = {k: v for k, v in base_meta.items() if k != "ui"}
            return {**fallback, "_meta": rest}
        return {**fallback, "_meta": dict(base_meta)} if base_meta else fallback

    narrated = narrator(data)
    text = str(narrated["text"])
    raw_links = narrated.get("links")
    links = raw_links if isinstance(raw_links, list) else []
    narrated_block: dict[str, object] = {
        "type": "text",
        "text": text,
        "annotations": {"audience": ["assistant"]},
    }
    resource_links: list[dict[str, object]] = []
    for item in links:
        if not isinstance(item, dict):
            continue
        uri = item.get("uri")
        name = item.get("name")
        if isinstance(uri, str) and isinstance(name, str):
            resource_links.append(
                {
                    "type": "resource_link",
                    "uri": uri,
                    "name": name,
                    "annotations": {"audience": ["user"]},
                }
            )
    placeholder_block: dict[str, object] = {"type": "text", "text": ui_placeholder(tool, data)}
    content: list[dict[str, object]]
    if mode == "ui":
        content = [placeholder_block, narrated_block]
    else:
        content = [narrated_block, *resource_links]
    meta: Mapping[str, object] | None
    if mode == "text" and base_meta and "ui" in base_meta:
        meta = {k: v for k, v in base_meta.items() if k != "ui"}
    else:
        meta = dict(base_meta) if base_meta else None
    result: dict[str, object] = {"content": content, "structuredContent": dict(data)}
    if meta:
        result["_meta"] = dict(meta)
    return result
