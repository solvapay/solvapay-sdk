"""Paid MCP tools for the official MCP Python SDK. Install with ``pip install 'solvapay[mcp]'``."""

from .auth import SolvaPayTokenVerifier, authorization_server_metadata, oauth_bridge_routes
from .response import CustomerSnapshot, Nudge, ResponseContext, ResponseResult
from .server import SolvaPayMcpServer, create_solvapay_mcp_server
from .tools import (
    PAID_TOOL_HINT,
    default_customer_ref,
    free_tool_description_suffix,
    register_free_tool,
    register_payable_tool,
)

__all__ = [
    "PAID_TOOL_HINT",
    "CustomerSnapshot",
    "Nudge",
    "ResponseContext",
    "ResponseResult",
    "SolvaPayMcpServer",
    "SolvaPayTokenVerifier",
    "authorization_server_metadata",
    "create_solvapay_mcp_server",
    "default_customer_ref",
    "free_tool_description_suffix",
    "oauth_bridge_routes",
    "register_free_tool",
    "register_payable_tool",
]
