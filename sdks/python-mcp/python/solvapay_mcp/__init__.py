from __future__ import annotations

__all__ = [
    "MCP_APP_MIME_TYPE",
    "ResponseContext",
    "create_solvapay_mcp_server",
    "default_mcp_app_html",
    "register_payable_tool",
]


def __getattr__(name: str) -> object:
    if name in {"MCP_APP_MIME_TYPE", "default_mcp_app_html"}:
        from solvapay_mcp.widget import MCP_APP_MIME_TYPE, default_mcp_app_html

        values = {
            "MCP_APP_MIME_TYPE": MCP_APP_MIME_TYPE,
            "default_mcp_app_html": default_mcp_app_html,
        }
        return values[name]
    if name == "ResponseContext":
        from solvapay_mcp.response_context import ResponseContext

        return ResponseContext
    if name == "register_payable_tool":
        from solvapay_mcp.register import register_payable_tool

        return register_payable_tool
    if name == "create_solvapay_mcp_server":
        from solvapay_mcp.server.factory import create_solvapay_mcp_server

        return create_solvapay_mcp_server
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
