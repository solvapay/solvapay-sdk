"""Paid MCP tools for the official MCP Python SDK. Install with ``pip install 'solvapay[mcp]'``."""

from .app import (
    BOOTSTRAP_URI,
    DEFAULT_CSP,
    RESOURCE_MIME_TYPE,
    HideToolsByAudience,
    is_chatgpt_request,
    merge_csp,
    widget_html,
)
from .auth import SolvaPayTokenVerifier, authorization_server_metadata, oauth_bridge_routes
from .bootstrap import (
    build_bootstrap_payload,
    derive_default_view,
    enrich_purchase,
    select_active_plan_purchase,
)
from .intent import (
    OVERVIEW_MARKDOWN,
    OVERVIEW_URI,
    build_solvapay_prompts,
    narrated_tool_result,
    register_intent_tools,
    tool_error_result,
)
from .narrate import (
    NARRATORS,
    NarratorOutput,
    narrate_activate_plan,
    narrate_auto_recharge,
    narrate_manage_account,
    narrate_topup,
    narrate_upgrade,
    ui_placeholder,
)
from .response import CustomerSnapshot, Nudge, ResponseContext, ResponseResult
from .server import SolvaPayMcpServer, create_solvapay_mcp_server
from .tools import (
    PAID_TOOL_HINT,
    default_customer_ref,
    free_tool_description_suffix,
    register_free_tool,
    register_payable_tool,
)
from .transport import TRANSPORT_TOOL_NAMES, register_transport_tools

__all__ = [
    "BOOTSTRAP_URI",
    "DEFAULT_CSP",
    "NARRATORS",
    "OVERVIEW_MARKDOWN",
    "OVERVIEW_URI",
    "PAID_TOOL_HINT",
    "RESOURCE_MIME_TYPE",
    "TRANSPORT_TOOL_NAMES",
    "CustomerSnapshot",
    "HideToolsByAudience",
    "NarratorOutput",
    "Nudge",
    "ResponseContext",
    "ResponseResult",
    "SolvaPayMcpServer",
    "SolvaPayTokenVerifier",
    "authorization_server_metadata",
    "build_bootstrap_payload",
    "build_solvapay_prompts",
    "create_solvapay_mcp_server",
    "default_customer_ref",
    "derive_default_view",
    "enrich_purchase",
    "free_tool_description_suffix",
    "is_chatgpt_request",
    "merge_csp",
    "narrate_activate_plan",
    "narrate_auto_recharge",
    "narrate_manage_account",
    "narrate_topup",
    "narrate_upgrade",
    "narrated_tool_result",
    "oauth_bridge_routes",
    "register_free_tool",
    "register_intent_tools",
    "register_payable_tool",
    "register_transport_tools",
    "select_active_plan_purchase",
    "tool_error_result",
    "ui_placeholder",
    "widget_html",
]
