from __future__ import annotations

from typing import TypedDict


class OAuthBridgePaths(TypedDict, total=False):
    register: str
    authorize: str
    token: str
    revoke: str


class ResolvedOAuthPaths(TypedDict):
    register: str
    authorize: str
    token: str
    revoke: str


DEFAULT_OAUTH_PATHS: ResolvedOAuthPaths = {
    "register": "/oauth/register",
    "authorize": "/oauth/authorize",
    "token": "/oauth/token",
    "revoke": "/oauth/revoke",
}


def without_trailing_slash(value: str) -> str:
    from solvapay_mcp.core import call

    result = call("mcpOauthPath", {"kind": "strip-trailing-slash", "value": value})
    if not isinstance(result, str):
        raise TypeError("mcpOauthPath did not return a string")
    return result


def with_leading_slash(value: str) -> str:
    from solvapay_mcp.core import call

    result = call("mcpOauthPath", {"kind": "leading-slash", "value": value})
    if not isinstance(result, str):
        raise TypeError("mcpOauthPath did not return a string")
    return result


def mcp_resource_identifier(public_base_url: str, mcp_path: str | None = None) -> str:
    from solvapay_mcp.core import call

    payload: dict[str, object] = {
        "kind": "resource-identifier",
        "publicBaseUrl": public_base_url,
    }
    if mcp_path is not None:
        payload["mcpPath"] = mcp_path
    result = call("mcpOauthPath", payload)
    if not isinstance(result, str):
        raise TypeError("mcpOauthPath did not return a string")
    return result


def path_aware_protected_resource_path(mcp_path: str) -> str:
    from solvapay_mcp.core import call

    result = call(
        "mcpOauthPath",
        {"kind": "protected-resource-path", "mcpPath": mcp_path},
    )
    if not isinstance(result, str):
        raise TypeError("mcpOauthPath did not return a string")
    return result


def resolve_oauth_paths(
    paths: OAuthBridgePaths | ResolvedOAuthPaths | None = None,
) -> ResolvedOAuthPaths:
    from solvapay_mcp.core import call

    payload: dict[str, object] = {"kind": "resolve-paths"}
    if paths is not None:
        payload["paths"] = dict(paths)
    value = call("mcpOauthPath", payload)
    if not isinstance(value, dict):
        raise TypeError("mcpOauthPath did not return an object")
    return {
        "register": str(value["register"]),
        "authorize": str(value["authorize"]),
        "token": str(value["token"]),
        "revoke": str(value["revoke"]),
    }


def get_oauth_protected_resource_response(
    public_base_url: str,
    *,
    mcp_path: str | None = None,
) -> dict[str, object]:
    from solvapay_mcp.core import call

    payload: dict[str, object] = {
        "kind": "protected-resource",
        "publicBaseUrl": public_base_url,
    }
    if mcp_path is not None:
        payload["mcpPath"] = mcp_path
    value = call("mcpOauthDiscovery", payload)
    if not isinstance(value, dict):
        raise TypeError("mcpOauthDiscovery did not return an object")
    return {str(k): v for k, v in value.items()}


def get_oauth_authorization_server_response(
    public_base_url: str,
    paths: OAuthBridgePaths | ResolvedOAuthPaths | None = None,
) -> dict[str, object]:
    from solvapay_mcp.core import call

    payload: dict[str, object] = {
        "kind": "authorization-server",
        "publicBaseUrl": public_base_url,
    }
    if paths is not None:
        payload["paths"] = dict(paths)
    value = call("mcpOauthDiscovery", payload)
    if not isinstance(value, dict):
        raise TypeError("mcpOauthDiscovery did not return an object")
    return {str(k): v for k, v in value.items()}
