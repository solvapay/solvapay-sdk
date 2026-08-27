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
    return value[:-1] if value.endswith("/") else value


def with_leading_slash(value: str) -> str:
    return value if value.startswith("/") else f"/{value}"


def mcp_resource_identifier(public_base_url: str, mcp_path: str | None = None) -> str:
    origin = without_trailing_slash(public_base_url)
    if not mcp_path:
        return origin
    path = without_trailing_slash(with_leading_slash(mcp_path))
    return f"{origin}{path}" if path else origin


def path_aware_protected_resource_path(mcp_path: str) -> str:
    path = without_trailing_slash(with_leading_slash(mcp_path))
    return f"/.well-known/oauth-protected-resource{path}" if path else (
        "/.well-known/oauth-protected-resource"
    )


def resolve_oauth_paths(
    paths: OAuthBridgePaths | ResolvedOAuthPaths | None = None,
) -> ResolvedOAuthPaths:
    register = DEFAULT_OAUTH_PATHS["register"]
    authorize = DEFAULT_OAUTH_PATHS["authorize"]
    token = DEFAULT_OAUTH_PATHS["token"]
    revoke = DEFAULT_OAUTH_PATHS["revoke"]
    if paths is not None:
        register_path = paths.get("register")
        if register_path:
            register = register_path
        authorize_path = paths.get("authorize")
        if authorize_path:
            authorize = authorize_path
        token_path = paths.get("token")
        if token_path:
            token = token_path
        revoke_path = paths.get("revoke")
        if revoke_path:
            revoke = revoke_path
    return {
        "register": register,
        "authorize": authorize,
        "token": token,
        "revoke": revoke,
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
