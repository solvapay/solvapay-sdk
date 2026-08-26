from __future__ import annotations

from collections.abc import Mapping

from solvapay_mcp.oauth.bearer import (
    decode_jwt_payload,
    extract_bearer_token,
    get_customer_ref_from_jwt_payload,
)


def build_auth_info_from_bearer(
    authorization: str | None,
    *,
    client_id: str | None = None,
    default_scopes: list[str] | None = None,
    include_payload: bool = False,
    claim_priority: list[str] | None = None,
) -> dict[str, object] | None:
    token = extract_bearer_token(authorization)
    if not token:
        return None
    payload = decode_jwt_payload(token)
    customer_ref = get_customer_ref_from_jwt_payload(payload, claim_priority=claim_priority)
    extra: dict[str, object] = {"customer_ref": customer_ref}
    resource = _resource(payload)
    if resource is not None:
        extra["resource"] = resource
    if include_payload:
        extra["payload"] = payload
    auth: dict[str, object] = {
        "token": token,
        "clientId": _client_id(payload, client_id),
        "scopes": _scopes(payload, default_scopes or []),
        "extra": extra,
    }
    expires_at = payload.get("exp")
    if isinstance(expires_at, int):
        auth["expiresAt"] = expires_at
    return auth


def _client_id(payload: Mapping[str, object], explicit: str | None) -> str:
    if explicit:
        return explicit
    for key in ("client_id", "azp"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return "solvapay-mcp-client"


def _resource(payload: Mapping[str, object]) -> str | None:
    for key in ("resource", "aud"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _scopes(payload: Mapping[str, object], default_scopes: list[str]) -> list[str]:
    scp = payload.get("scp")
    if isinstance(scp, list):
        return [item for item in scp if isinstance(item, str)]
    scope = payload.get("scope")
    if isinstance(scope, str) and scope.strip():
        return [part for part in scope.split() if part]
    return list(default_scopes)
