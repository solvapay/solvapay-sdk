from __future__ import annotations

import json

from solvapay_mcp.oauth.discovery import (
    get_oauth_authorization_server_response,
    get_oauth_protected_resource_response,
)


def test_protected_resource_strips_trailing_slash() -> None:
    assert get_oauth_protected_resource_response("https://mcp.example.com/") == {
        "resource": "https://mcp.example.com",
        "authorization_servers": ["https://mcp.example.com"],
        "scopes_supported": ["openid", "profile", "email"],
        "bearer_methods_supported": ["header"],
    }


def test_protected_resource_uses_mcp_path_as_canonical_resource() -> None:
    assert get_oauth_protected_resource_response(
        "https://mcp.example.com/",
        mcp_path="/mcp",
    ) == {
        "resource": "https://mcp.example.com/mcp",
        "authorization_servers": ["https://mcp.example.com"],
        "scopes_supported": ["openid", "profile", "email"],
        "bearer_methods_supported": ["header"],
    }


def test_authorization_server_uses_default_paths() -> None:
    doc = get_oauth_authorization_server_response("https://mcp.example.com/")
    assert doc == {
        "issuer": "https://mcp.example.com",
        "authorization_endpoint": "https://mcp.example.com/oauth/authorize",
        "token_endpoint": "https://mcp.example.com/oauth/token",
        "registration_endpoint": "https://mcp.example.com/oauth/register",
        "revocation_endpoint": "https://mcp.example.com/oauth/revoke",
        "token_endpoint_auth_methods_supported": [
            "client_secret_basic",
            "client_secret_post",
        ],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "scopes_supported": ["openid", "profile", "email"],
        "code_challenge_methods_supported": ["S256"],
    }
    json.dumps(doc)
