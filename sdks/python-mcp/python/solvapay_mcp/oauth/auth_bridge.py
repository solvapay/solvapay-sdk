from __future__ import annotations

from collections.abc import Mapping

from solvapay_mcp.oauth.bearer import (
    extract_bearer_token,
    verify_bearer,
)


def build_auth_info_from_bearer(
    authorization: str | None,
    *,
    expected_issuer: str,
    expected_audience: str,
    now_unix_secs: int,
    jwks_json: object | None = None,
    hs256_secret: str | None = None,
    client_id: str | None = None,
    default_scopes: list[str] | None = None,
    include_payload: bool = False,
    claim_priority: list[str] | None = None,
) -> dict[str, object] | None:
    token = extract_bearer_token(authorization)
    if not token:
        return None
    result = verify_bearer(
        token,
        expected_issuer=expected_issuer,
        expected_audience=expected_audience,
        now_unix_secs=now_unix_secs,
        jwks_json=jwks_json,
        hs256_secret=hs256_secret,
        claim_priority=claim_priority,
    )
    if result.get("kind") != "ok":
        return None
    payload_raw = result.get("claims")
    payload: Mapping[str, object] = payload_raw if isinstance(payload_raw, dict) else {}
    customer_ref = result.get("customerRef")
    extra: dict[str, object] = {}
    if isinstance(customer_ref, str):
        extra["customer_ref"] = customer_ref
    resource = _resource(payload)
    if resource is not None:
        extra["resource"] = resource
    if include_payload:
        extra["payload"] = dict(payload)
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
