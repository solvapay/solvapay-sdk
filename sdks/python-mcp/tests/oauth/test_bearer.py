from __future__ import annotations

import base64
import json

import pytest

from solvapay_mcp.oauth.bearer import (
    McpBearerAuthError,
    get_customer_ref_from_bearer_auth_header,
    get_customer_ref_from_jwt_payload,
)


def _token(payload: dict[str, object]) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    return f"e30.{body}.sig"


def test_claim_priority_customer_ref_camel_first() -> None:
    payload = {"customerRef": "cus_a", "customer_ref": "cus_b", "sub": "cus_c"}
    assert get_customer_ref_from_jwt_payload(payload) == "cus_a"


def test_claim_priority_falls_through_to_sub() -> None:
    payload = {"sub": "cus_c"}
    assert get_customer_ref_from_jwt_payload(payload) == "cus_c"


def test_malformed_token_raises() -> None:
    with pytest.raises(McpBearerAuthError, match="Invalid JWT format"):
        get_customer_ref_from_bearer_auth_header("Bearer not-a-jwt")


def test_token_without_usable_claim_raises() -> None:
    with pytest.raises(McpBearerAuthError, match="No customer reference claim found"):
        get_customer_ref_from_bearer_auth_header(f"Bearer {_token({'email': 'a@b.c'})}")
