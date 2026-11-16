from __future__ import annotations

import json
import time
from typing import Any

import httpx
import jwt
import pytest
import respx
from cryptography.hazmat.primitives.asymmetric import ec

from solvapay import AsyncApiClient, SolvaPayError
from solvapay.agents import (
    AgentCall,
    AgentCalls,
    AgentKeyVerifier,
    AgentLayer,
    AgentRejected,
    AgentTokenVerifier,
    Allowed,
    CallResult,
    Money,
    NotAgent,
    Refused,
    VerifiedAgent,
    amount_string,
    canonical_resource,
    challenge_header,
    prompt_facts,
    refusal_status,
)

API = "https://api.test"
ISSUER = "https://api.test/v1/agent"
KEY = ec.generate_private_key(ec.SECP256R1())


class FakeJwks(jwt.PyJWKClient):
    """The JWKS endpoint, answering with KEY's public half (no kid, as the test tokens)."""

    def __init__(self) -> None:
        super().__init__("https://api.solvapay.test/v1/agent/jwks.json")

    def fetch_data(self) -> Any:
        jwk = jwt.algorithms.ECAlgorithm.to_jwk(KEY.public_key(), as_dict=True)
        return {"keys": [jwk]}


def token(**overrides: Any) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": "prv_1",
        "sub": "agt_1",
        "principal": "ppl_1",
        "scope": "usage",
        "env": "sandbox",
        "iat": now,
        "exp": now + 600,
        "jti": "tok_1",
        "px": True,
        **overrides,
    }
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, KEY, algorithm="ES256")


def verifier(**kw: Any) -> AgentTokenVerifier:
    return AgentTokenVerifier(issuer=ISSUER, provider_ref="prv_1", jwks=FakeJwks(), **kw)


def api() -> AsyncApiClient:
    return AsyncApiClient(api_key="sk_sandbox_test", api_base_url=API)


# Tokens ----------------------------------------------------------------------


def test_a_valid_token_names_the_agent() -> None:
    agent = verifier().verify(token())
    assert isinstance(agent, VerifiedAgent)
    assert (agent.agent_ref, agent.principal_ref, agent.environment) == (
        "agt_1",
        "ppl_1",
        "sandbox",
    )
    assert agent.prompt_excerpt is True and agent.token_id == "tok_1"


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"exp": int(time.time()) - 120}, "expired"),
        ({"aud": "prv_other"}, "invalid"),
        ({"iss": "https://evil.test"}, "invalid"),
        ({"sub": "usr_1"}, "invalid"),
        ({"principal": None}, "invalid"),
        ({"scope": "admin"}, "invalid"),
        ({"env": "prod"}, "invalid"),
        ({"jti": None}, "invalid"),
    ],
)
def test_bad_tokens_are_rejected(overrides: dict[str, Any], reason: str) -> None:
    result = verifier().verify(token(**overrides))
    assert isinstance(result, AgentRejected) and result.reason == reason


def test_a_token_from_the_other_environment_is_rejected() -> None:
    result = verifier(environment="live").verify(token())
    assert isinstance(result, AgentRejected) and result.reason == "environment_mismatch"


def test_an_oauth_token_for_this_resource_is_accepted() -> None:
    v = verifier(resource="https://MCP.example.com:443/mcp/")
    assert isinstance(v.verify(token(aud="https://mcp.example.com/mcp")), VerifiedAgent)


def test_a_token_signed_by_another_key_is_rejected() -> None:
    other = ec.generate_private_key(ec.SECP256R1())
    forged = jwt.encode({"sub": "agt_1"}, other, algorithm="ES256")
    assert isinstance(verifier().verify(forged), AgentRejected)


# Keys and the layer ------------------------------------------------------------


@respx.mock
async def test_agent_keys_are_asked_once_per_30_seconds() -> None:
    route = respx.post(f"{API}/v1/sdk/agent/keys/verifications").respond(
        200,
        json={
            "agentRef": "agt_2",
            "principalRef": "ppl_2",
            "promptExcerpt": False,
            "environment": "sandbox",
        },
    )
    keys = AgentKeyVerifier(api())
    first = await keys.verify("agk_abc")
    assert isinstance(first, VerifiedAgent) and first.agent_ref == "agt_2"
    await keys.verify("agk_abc")
    assert route.call_count == 1


@respx.mock
async def test_a_key_from_the_other_environment_is_rejected() -> None:
    respx.post(f"{API}/v1/sdk/agent/keys/verifications").respond(
        403, json={"statusCode": 403, "code": "environment_mismatch", "message": "Live key"}
    )
    result = await AgentKeyVerifier(api()).verify("agk_abc")
    assert isinstance(result, AgentRejected) and result.reason == "environment_mismatch"


@respx.mock
async def test_solvapay_out_of_reach_raises() -> None:
    respx.post(f"{API}/v1/sdk/agent/keys/verifications").respond(503, json={"statusCode": 503})
    with pytest.raises(SolvaPayError):
        await AgentKeyVerifier(api()).verify("agk_abc")


async def test_the_layer_tells_agents_from_merchant_credentials() -> None:
    async def verify_key(_key: str) -> Any:
        return AgentRejected("invalid", "unknown key")

    layer = AgentLayer(verify_token=verifier().verify, verify_key=verify_key)
    assert isinstance(await layer.identify("sk_live_merchant"), NotAgent)
    assert isinstance(await layer.identify(token()), VerifiedAgent)
    assert isinstance(await layer.identify("agk_unknown"), AgentRejected)


# Calls -------------------------------------------------------------------------


AGENT = VerifiedAgent(
    agent_ref="agt_1", principal_ref="ppl_1", prompt_excerpt=False, environment="sandbox"
)


def call(**kw: Any) -> AgentCall:
    return AgentCall(
        request_id="req_1",
        agent_token="tok",
        agent=AGENT,
        item="gpt-x",
        estimate=Money("0.02", "USD"),
        **kw,
    )


ALLOWED = {
    "status": "allowed",
    "callRef": "call_1",
    "reservation": {
        "held": {"amount": "0.02", "currency": "USD"},
        "expiresAt": "2026-11-12T12:00:00Z",
    },
}
WAITING = {
    "status": "waiting",
    "callRef": "call_1",
    "message": "Waiting for the owner",
    "approval": {"reference": "apr_1", "expiresAt": "2026-11-12T12:00:00Z"},
    "retryAfterSeconds": 0,
}


@respx.mock
async def test_an_allowed_call_completes_once_at_the_reported_cost() -> None:
    authorize = respx.post(f"{API}/v1/sdk/agent/calls").respond(200, json=ALLOWED)
    complete = respx.post(f"{API}/v1/sdk/agent/calls/call_1/complete").respond(
        200,
        json={
            "callRef": "call_1",
            "settled": True,
            "source": "reported",
            "amount": {"amount": "0.0123", "currency": "USD"},
            "duplicate": False,
        },
    )
    begun = await AgentCalls(api(), max_wait_seconds=0).begin(call(prompt=prompt_facts("hello")))
    assert isinstance(begun, Allowed) and begun.call_ref == "call_1"
    sent = json.loads(authorize.calls.last.request.content)
    assert sent["promptHash"].startswith("sha256:") and "promptExcerpt" not in sent
    assert sent["wait"] == 0
    await begun.finish(CallResult(status=200, cost=(0.0123, "USD")))
    assert json.loads(complete.calls.last.request.content) == {
        "status": 200,
        "cost": {"amount": "0.0123", "currency": "USD"},
    }
    with pytest.raises(SolvaPayError):
        await begun.release("again")


@respx.mock
async def test_waiting_for_the_owner_then_allowed() -> None:
    route = respx.post(f"{API}/v1/sdk/agent/calls")
    route.side_effect = [httpx.Response(200, json=WAITING), httpx.Response(200, json=ALLOWED)]
    begun = await AgentCalls(api(), max_wait_seconds=30).begin(call())
    assert isinstance(begun, Allowed)
    assert route.call_count == 2


@respx.mock
async def test_with_no_wait_an_ask_is_refused() -> None:
    respx.post(f"{API}/v1/sdk/agent/calls").respond(200, json=WAITING)
    begun = await AgentCalls(api(), max_wait_seconds=0).begin(call())
    assert begun == Refused("ask", "Waiting for the owner")


@respx.mock
async def test_a_caller_that_left_stops_the_wait() -> None:
    respx.post(f"{API}/v1/sdk/agent/calls").respond(200, json=WAITING)
    begun = await AgentCalls(api(), max_wait_seconds=30).begin(call(cancelled=lambda: True))
    assert isinstance(begun, Refused) and begun.reason == "approval_client_closed"


@respx.mock
async def test_server_refusals_and_failures() -> None:
    respx.post(f"{API}/v1/sdk/agent/calls").respond(
        200,
        json={
            "status": "refused",
            "callRef": "call_1",
            "reason": "topup_required",
            "message": "Top up",
        },
    )
    assert await AgentCalls(api(), max_wait_seconds=0).begin(call()) == Refused(
        "topup_required", "Top up"
    )

    respx.post(f"{API}/v1/sdk/agent/calls").respond(401, json={"statusCode": 401})
    begun = await AgentCalls(api(), max_wait_seconds=0).begin(call())
    assert isinstance(begun, Refused) and begun.reason == "agent_not_accepted"

    respx.post(f"{API}/v1/sdk/agent/calls").respond(500, json={"statusCode": 500})
    begun = await AgentCalls(api(), max_wait_seconds=0).begin(call())
    assert isinstance(begun, Refused) and begun.reason == "unavailable"


# Helpers -------------------------------------------------------------------------


def test_refusal_statuses() -> None:
    assert [refusal_status(r) for r in ("agent_not_accepted", "unavailable", "deny", "ask")] == [
        401,
        502,
        422,
        402,
    ]


def test_amount_string() -> None:
    assert [amount_string(x) for x in (0, 1, 0.1, 0.123456789, "2.50", 1e-9)] == [
        "0",
        "1",
        "0.1",
        "0.12345679",
        "2.5",
        "0",
    ]


def test_canonical_resource_and_challenge() -> None:
    assert canonical_resource("HTTPS://Mcp.Example.com:443/mcp/") == "https://mcp.example.com/mcp"
    assert canonical_resource("http://localhost:3030/mcp") == "http://localhost:3030/mcp"
    with pytest.raises(ValueError):
        canonical_resource("https://u:p@example.com/mcp")
    header = challenge_header(resource="https://mcp.example.com/mcp", description='say "hi"')
    assert (
        'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"'
        in header
    )
    assert 'error_description="say \\"hi\\""' in header
