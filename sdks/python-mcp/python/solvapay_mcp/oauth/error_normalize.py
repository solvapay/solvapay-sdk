from __future__ import annotations

from collections.abc import Mapping

VALID_OAUTH_TOKEN_ERROR_CODES = frozenset(
    {
        "invalid_request",
        "invalid_client",
        "invalid_grant",
        "unauthorized_client",
        "unsupported_grant_type",
        "invalid_scope",
        "server_error",
        "temporarily_unavailable",
        "access_denied",
    }
)


def has_oauth_error_shape(body: object) -> bool:
    from solvapay_mcp.core import call

    value = call("mcpOauthErrorInspect", {"kind": "has-shape", "body": body})
    if not isinstance(value, bool):
        raise TypeError("mcpOauthErrorInspect did not return a bool")
    return value


def derive_oauth_error_code(status: int, nest_body: Mapping[str, object]) -> str:
    from solvapay_mcp.core import call

    value = call(
        "mcpOauthErrorInspect",
        {"kind": "derive-code", "status": status, "body": dict(nest_body)},
    )
    if not isinstance(value, str):
        raise TypeError("mcpOauthErrorInspect did not return a string")
    return value


def build_error_description(nest_body: Mapping[str, object]) -> str | None:
    from solvapay_mcp.core import call

    value = call(
        "mcpOauthErrorInspect",
        {"kind": "build-description", "body": dict(nest_body)},
    )
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("mcpOauthErrorInspect did not return a string")
    return value


def to_oauth_error_body(body: object, text: str, status: int) -> dict[str, object]:
    from solvapay_mcp.core import call

    value = call(
        "mcpNormalizeOauthError",
        {"body": body, "text": text, "status": status},
    )
    if not isinstance(value, dict):
        raise TypeError("mcpNormalizeOauthError did not return an object")
    return {str(k): v for k, v in value.items()}
