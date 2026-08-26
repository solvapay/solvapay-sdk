from __future__ import annotations

import base64
import json
from collections.abc import Mapping


class McpBearerAuthError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.name = "McpBearerAuthError"


def extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    if not authorization.startswith("Bearer "):
        return None
    token = authorization[7:].strip()
    return token or None


def _b64url_decode(value: str) -> bytes:
    padded = value + "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def decode_jwt_payload(token: str) -> dict[str, object]:
    parts = token.split(".")
    if len(parts) < 2:
        raise McpBearerAuthError("Invalid JWT format")
    try:
        payload = json.loads(_b64url_decode(parts[1]))
    except (ValueError, json.JSONDecodeError) as err:
        raise McpBearerAuthError("Invalid JWT payload") from err
    if not isinstance(payload, dict):
        raise McpBearerAuthError("Invalid JWT payload")
    return {str(key): value for key, value in payload.items()}


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


def get_customer_ref_from_bearer_auth_header(
    authorization: str | None,
    *,
    claim_priority: list[str] | None = None,
) -> str:
    token = extract_bearer_token(authorization)
    if not token:
        raise McpBearerAuthError("Missing bearer token")
    payload = decode_jwt_payload(token)
    return get_customer_ref_from_jwt_payload(payload, claim_priority=claim_priority)
