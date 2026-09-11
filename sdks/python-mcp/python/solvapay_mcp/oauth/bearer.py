from __future__ import annotations

from collections.abc import Mapping
from typing import TypedDict

from solvapay_mcp.core import call


class McpBearerExpectations(TypedDict):
    expected_issuer: str
    expected_audience: str
    now_unix_secs: int


class McpBearerAuthError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.name = "McpBearerAuthError"


def decode_jwt_payload(token: str) -> dict[str, object]:
    """Structural payload parse. Not an authorization check."""
    import base64
    import json

    parts = token.split(".")
    if len(parts) < 2:
        raise McpBearerAuthError("Invalid JWT format")
    padded = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(raw)
    except (ValueError, json.JSONDecodeError) as err:
        raise McpBearerAuthError("Invalid JWT payload") from err
    if not isinstance(payload, dict):
        raise McpBearerAuthError("Invalid JWT payload")
    return {str(k): v for k, v in payload.items()}


def extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    if not authorization.startswith("Bearer "):
        return None
    token = authorization[7:].strip()
    return token or None


def get_customer_ref_from_jwt_payload(
    payload: Mapping[str, object],
    *,
    claim_priority: list[str] | None = None,
) -> str:
    priority = claim_priority or ["customerRef", "customer_ref", "sub"]
    for claim in priority:
        value = payload.get(claim)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise McpBearerAuthError(
        f"No customer reference claim found (checked: {', '.join(priority)})"
    )


def verify_bearer(
    token: str,
    *,
    expected_issuer: str,
    expected_audience: str,
    now_unix_secs: int,
    jwks_json: object | None = None,
    hs256_secret: str | None = None,
    claim_priority: list[str] | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "token": token,
        "expectedIssuer": expected_issuer,
        "expectedAudience": expected_audience,
        "nowUnixSecs": now_unix_secs,
    }
    if jwks_json is not None:
        payload["jwksJson"] = jwks_json
    if hs256_secret is not None:
        payload["hs256Secret"] = hs256_secret
    if claim_priority is not None:
        payload["claimPriority"] = claim_priority
    value = call("mcpVerifyBearer", payload)
    if not isinstance(value, dict):
        raise TypeError("mcpVerifyBearer did not return an object")
    return {str(k): v for k, v in value.items()}


def get_customer_ref_from_bearer_auth_header(
    authorization: str | None,
    *,
    expected_issuer: str,
    expected_audience: str,
    now_unix_secs: int,
    jwks_json: object | None = None,
    hs256_secret: str | None = None,
    claim_priority: list[str] | None = None,
) -> str:
    token = extract_bearer_token(authorization)
    if not token:
        raise McpBearerAuthError("Missing bearer token")
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
        message = result.get("message")
        raise McpBearerAuthError(str(message) if message else "Unauthorized")
    ref = result.get("customerRef")
    if not isinstance(ref, str) or not ref.strip():
        raise McpBearerAuthError("No customer reference claim found")
    return ref.strip()


def default_mcp_bearer_expectations(
    public_base_url: str,
    mcp_path: str | None = None,
    now_unix_secs: int | None = None,
) -> McpBearerExpectations:
    import time

    issuer = public_base_url.rstrip("/")
    path = (mcp_path or "").strip().rstrip("/")
    audience = f"{issuer}{path if path.startswith('/') else f'/{path}'}" if path else issuer
    return {
        "expected_issuer": issuer,
        "expected_audience": audience,
        "now_unix_secs": int(now_unix_secs if now_unix_secs is not None else time.time()),
    }
