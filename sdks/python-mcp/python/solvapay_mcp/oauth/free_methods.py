from __future__ import annotations

from typing import Literal

McpAuthMode = Literal["tools-call", "all"]


def is_free_mcp_method(mcp_method: str | None) -> bool:
    from solvapay_mcp.core import call

    value = call("mcpIsFreeMethod", {"mcpMethod": mcp_method})
    if not isinstance(value, bool):
        raise TypeError("mcpIsFreeMethod did not return a bool")
    return value


def requires_bearer_auth(mcp_method: str | None, auth_mode: McpAuthMode) -> bool:
    from solvapay_mcp.core import call

    value = call(
        "mcpRequiresBearerAuth",
        {"mcpMethod": mcp_method, "authMode": auth_mode},
    )
    if not isinstance(value, bool):
        raise TypeError("mcpRequiresBearerAuth did not return a bool")
    return value
