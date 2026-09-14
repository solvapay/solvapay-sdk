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


def _core_call(op: str, args: dict[str, object]) -> object:
    import json

    from solvapay import _native as native

    return native.call_native_sync(op, json.dumps(args))


def decode_jwt_payload(token: str) -> dict[str, object]:
    payload = _core_call("decode_jwt_payload_unverified", {"token": token})
    if not isinstance(payload, dict):
        raise McpBearerAuthError(
            "Invalid JWT format" if len(token.split(".")) < 2 else "Invalid JWT payload"
        )
    return {str(k): v for k, v in payload.items()}


def extract_bearer_token(authorization: str | None) -> str | None:
    result = _core_call("extract_bearer_token", {"authorizationHeader": authorization})
    if isinstance(result, str) and result.strip():
        return result.strip()
    return None


def get_customer_ref_from_jwt_payload(
    payload: Mapping[str, object],
    *,
    claim_priority: list[str] | None = None,
) -> str:
    priority = claim_priority or ["customerRef", "customer_ref", "sub"]
    result = _core_call(
        "customer_ref_from_claims",
        {"claims": dict(payload), "claimPriority": claim_priority},
    )
    if isinstance(result, str) and result.strip():
        return result.strip()
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

    clock = int(now_unix_secs if now_unix_secs is not None else time.time())
    value = _core_call(
        "default_mcp_bearer_expectations",
        {
            "publicBaseUrl": public_base_url,
            "mcpPath": mcp_path,
            "nowUnixSecs": clock,
        },
    )
    if not isinstance(value, dict):
        raise TypeError("default_mcp_bearer_expectations returned a non-object")
    issuer = value.get("expectedIssuer")
    audience = value.get("expectedAudience")
    now = value.get("nowUnixSecs")
    if not isinstance(issuer, str) or not isinstance(audience, str):
        raise TypeError("default_mcp_bearer_expectations missing issuer/audience")
    return {
        "expected_issuer": issuer,
        "expected_audience": audience,
        "now_unix_secs": int(now) if isinstance(now, int | float) else clock,
    }
