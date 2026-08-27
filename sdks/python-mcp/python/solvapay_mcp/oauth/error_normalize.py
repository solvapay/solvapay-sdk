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
    if not isinstance(body, dict):
        return False
    err = body.get("error")
    return isinstance(err, str) and err in VALID_OAUTH_TOKEN_ERROR_CODES


def _zod_errors(body: Mapping[str, object]) -> list[dict[str, object]]:
    raw = body.get("errors")
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _path_has(err: Mapping[str, object], field: str) -> bool:
    path = err.get("path")
    return isinstance(path, list) and any(item == field for item in path)


def derive_oauth_error_code(status: int, nest_body: Mapping[str, object]) -> str:
    if status in (401, 403):
        return "invalid_client"
    if status >= 500:
        return "server_error"

    def touches(field: str) -> bool:
        return any(_path_has(err, field) for err in _zod_errors(nest_body))

    if touches("grant_type"):
        grant_err = next(
            (err for err in _zod_errors(nest_body) if _path_has(err, "grant_type")),
            None,
        )
        received = grant_err.get("received") if grant_err else None
        if received not in (None, "undefined", ""):
            return "unsupported_grant_type"
        return "invalid_request"
    if touches("code") or touches("refresh_token"):
        return "invalid_grant"
    if touches("scope"):
        return "invalid_scope"
    if touches("client_id") or touches("client_secret"):
        return "invalid_client"
    return "invalid_request"


def build_error_description(nest_body: Mapping[str, object]) -> str | None:
    parts: list[str] = []
    for err in _zod_errors(nest_body):
        path = err.get("path")
        message = err.get("message")
        if isinstance(path, list):
            path_str = ".".join(item for item in path if isinstance(item, str))
        else:
            path_str = ""
        msg_str = message if isinstance(message, str) else ""
        if path_str and msg_str:
            parts.append(f"{path_str}: {msg_str}")
        elif path_str or msg_str:
            parts.append(path_str or msg_str)
    if parts:
        return "; ".join(parts)
    message = nest_body.get("message")
    if isinstance(message, str):
        return message
    if isinstance(message, list):
        strings = [item for item in message if isinstance(item, str)]
        if strings:
            return "; ".join(strings)
    return None


def to_oauth_error_body(body: object, text: str, status: int) -> dict[str, object]:
    from solvapay_mcp.core import call

    value = call(
        "mcpNormalizeOauthError",
        {"body": body, "text": text, "status": status},
    )
    if not isinstance(value, dict):
        raise TypeError("mcpNormalizeOauthError did not return an object")
    return {str(k): v for k, v in value.items()}
