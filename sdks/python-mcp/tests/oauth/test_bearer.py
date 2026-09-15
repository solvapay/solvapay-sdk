from __future__ import annotations

import pytest

from solvapay_mcp.oauth.bearer import (
    McpBearerAuthError,
    decode_jwt_payload,
    get_customer_ref_from_bearer_auth_header,
    get_customer_ref_from_jwt_payload,
)

VERIFY = {
    "expected_issuer": "https://mcp.example.com",
    "expected_audience": "https://mcp.example.com",
    "now_unix_secs": 1_700_000_000,
}


def test_claim_priority_customer_ref_camel_first() -> None:
    payload = {"customerRef": "cus_a", "customer_ref": "cus_b", "sub": "cus_c"}
    assert get_customer_ref_from_jwt_payload(payload) == "cus_a"


def test_claim_priority_falls_through_to_sub() -> None:
    payload = {"sub": "cus_c"}
    assert get_customer_ref_from_jwt_payload(payload) == "cus_c"


def test_malformed_token_raises() -> None:
    with pytest.raises(McpBearerAuthError, match="Invalid JWT format"):
        decode_jwt_payload("not-a-jwt")
    with pytest.raises(McpBearerAuthError):
        get_customer_ref_from_bearer_auth_header("Bearer not-a-jwt", **VERIFY)


def test_token_without_usable_claim_raises() -> None:
    with pytest.raises(McpBearerAuthError, match="No customer reference claim found"):
        get_customer_ref_from_jwt_payload({"email": "a@b.c"})
