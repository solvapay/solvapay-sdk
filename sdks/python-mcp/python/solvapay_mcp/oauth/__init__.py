from solvapay_mcp.oauth.auth_bridge import build_auth_info_from_bearer
from solvapay_mcp.oauth.bearer import (
    McpBearerAuthError,
    decode_jwt_payload,
    extract_bearer_token,
    get_customer_ref_from_bearer_auth_header,
    get_customer_ref_from_jwt_payload,
)
from solvapay_mcp.oauth.discovery import (
    DEFAULT_OAUTH_PATHS,
    get_oauth_authorization_server_response,
    get_oauth_protected_resource_response,
    resolve_oauth_paths,
    without_trailing_slash,
)
from solvapay_mcp.oauth.free_methods import (
    McpAuthMode,
    is_free_mcp_method,
    requires_bearer_auth,
)

__all__ = [
    "DEFAULT_OAUTH_PATHS",
    "McpAuthMode",
    "McpBearerAuthError",
    "build_auth_info_from_bearer",
    "decode_jwt_payload",
    "extract_bearer_token",
    "get_customer_ref_from_bearer_auth_header",
    "get_customer_ref_from_jwt_payload",
    "get_oauth_authorization_server_response",
    "get_oauth_protected_resource_response",
    "is_free_mcp_method",
    "requires_bearer_auth",
    "resolve_oauth_paths",
    "without_trailing_slash",
]
