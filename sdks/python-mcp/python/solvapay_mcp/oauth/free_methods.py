from __future__ import annotations

from typing import Literal

McpAuthMode = Literal["tools-call", "all"]


def is_free_mcp_method(mcp_method: str | None) -> bool:
    method = (mcp_method or "").strip().lower()
    return method != "tools/call"


def requires_bearer_auth(mcp_method: str | None, auth_mode: McpAuthMode) -> bool:
    if auth_mode == "all":
        return True
    return not is_free_mcp_method(mcp_method)
