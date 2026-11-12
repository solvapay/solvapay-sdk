"""The agent MCP route: ``create_agent_mcp_route`` and ``register_paid_tool``.

Mirrors ``packages/agents/src/__tests__/mcp.test.ts`` and the route half of
``oauth.test.ts``: real MCP requests through the route, SolvaPay's agent API
mocked.
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx
import jwt
import pytest
import respx
from mcp.server.mcpserver import MCPServer
from mcp.types import CallToolResult, TextContent
from pydantic import BaseModel, Field
from starlette.responses import PlainTextResponse
from starlette.types import Receive, Scope, Send
from test_agents import ALLOWED, ISSUER, FakeJwks, token

from solvapay import AsyncApiClient
from solvapay.agents import AgentCalls, AgentKeyVerifier, AgentLayer, AgentTokenVerifier, Money
from solvapay.agents.mcp import (
    PaidCall,
    PaidTool,
    PaidToolRun,
    ProtectedResource,
    create_agent_mcp_route,
)

API = "https://api.test"
MCP_URL = "http://merchant.test/mcp"
COMPLETED = {
    "callRef": "call_1",
    "settled": True,
    "source": "reported",
    "amount": {"amount": "0.004", "currency": "USD"},
    "duplicate": False,
}


class Question(BaseModel):
    question: str = Field(description="What to answer.")


async def ok(_args: Question, _call: PaidCall) -> PaidToolRun:
    return PaidToolRun(
        status=200,
        cost=(0.004, "USD"),
        result=CallToolResult(content=[TextContent(type="text", text="42")]),
    )


def free_tools(server: MCPServer) -> None:
    @server.tool(name="ping", description="Free.")
    def ping() -> str:
        return "pong"


def route_for(
    run: Any = ok,
    *,
    environment: Any = None,
    protected: ProtectedResource | None = None,
    lazy_auth: bool = True,
) -> Any:
    api = AsyncApiClient(api_key="sk_sandbox_test", api_base_url=API)
    layer = AgentLayer(
        verify_token=AgentTokenVerifier(
            issuer=ISSUER,
            provider_ref="prv_1",
            resource=protected.resource if protected else None,
            environment=environment,
            jwks=FakeJwks(),  # type: ignore[arg-type]
        ).verify,
        verify_key=AgentKeyVerifier(api, environment=environment).verify,
    )
    return create_agent_mcp_route(
        issuer=ISSUER,
        agent_layer=layer,
        calls=AgentCalls(api, max_wait_seconds=0),
        mcp_path="/mcp",
        server_name="merchant-test",
        protected_resource=protected,
        lazy_auth=lazy_auth,
        free_tools=free_tools,
        tools=lambda _server, paid, _call: paid(
            PaidTool(
                name="answer",
                description="Answers a question.",
                input=Question,
                item=lambda _a: "answer-v1",
                estimate=lambda _a: Money("0.01", "USD"),
                prompt=lambda a: a.question,
                run=run,
            )
        ),
    )


async def merchant(scope: Scope, receive: Receive, send: Send) -> None:
    body = b""
    while True:
        message = await receive()
        body += message.get("body", b"")
        if not message.get("more_body"):
            break
    await PlainTextResponse(f"merchant:{body.decode()}", status_code=418)(scope, receive, send)


def client(route: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=route.middleware(merchant)),
        base_url="http://merchant.test",
    )


def rpc(method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": 7, "method": method, "params": params or {}}


async def post(route: Any, body: dict[str, Any], bearer: str | None = None) -> httpx.Response:
    headers = {"accept": "application/json, text/event-stream"}
    if bearer:
        headers["authorization"] = f"Bearer {bearer}"
    async with client(route) as http:
        return await http.post("/mcp", json=body, headers=headers)


def ask(question: str = "What is 6 x 7?") -> dict[str, Any]:
    return rpc("tools/call", {"name": "answer", "arguments": {"question": question}})


@respx.mock
async def test_a_paid_call_is_authorized_run_and_completed_at_the_reported_cost() -> None:
    authorize = respx.post(f"{API}/v1/sdk/agent/calls").respond(200, json=ALLOWED)
    complete = respx.post(f"{API}/v1/sdk/agent/calls/call_1/complete").respond(200, json=COMPLETED)
    response = await post(route_for(), ask(), token())
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["content"] == [{"type": "text", "text": "42"}]
    sent = json.loads(authorize.calls.last.request.content)
    assert (sent["item"], sent["estimate"]) == ("answer-v1", {"amount": "0.01", "currency": "USD"})
    assert sent["promptExcerpt"] == "What is 6 x 7?"  # the token's px claim allows it
    assert json.loads(complete.calls.last.request.content) == {
        "status": 200,
        "cost": {"amount": "0.004", "currency": "USD"},
    }


@respx.mock
async def test_a_refusal_is_a_tool_error_and_the_tool_never_runs() -> None:
    respx.post(f"{API}/v1/sdk/agent/calls").respond(
        200,
        json={"status": "refused", "callRef": "call_1", "reason": "topup_required",
              "message": "Top up your balance."},
    )  # fmt: skip
    ran = []

    async def run(args: Question, call: PaidCall) -> PaidToolRun:
        ran.append(args)
        return await ok(args, call)

    result = (await post(route_for(run), ask(), token())).json()["result"]
    assert result["isError"] is True
    assert result["content"] == [{"type": "text", "text": "Top up your balance."}]
    assert result["structuredContent"] == {
        "refusal": {"reason": "topup_required", "message": "Top up your balance."}
    }
    assert ran == []


@respx.mock
async def test_an_unreachable_upstream_releases_the_call() -> None:
    respx.post(f"{API}/v1/sdk/agent/calls").respond(200, json=ALLOWED)
    complete = respx.post(f"{API}/v1/sdk/agent/calls/call_1/complete").respond(200, json=COMPLETED)

    async def broken(_args: Question, _call: PaidCall) -> PaidToolRun:
        raise ConnectionError("upstream down")

    result = (await post(route_for(broken), ask(), token())).json()["result"]
    assert result["isError"] is True
    assert result["content"][0]["text"] == (
        "The service behind this tool could not be reached. Nothing was charged."
    )
    assert json.loads(complete.calls.last.request.content) == {
        "status": 502,
        "cost": None,
        "interrupted": "upstream_unreachable",
    }


async def test_a_token_that_does_not_verify_is_401_and_other_requests_pass_through() -> None:
    route = route_for()
    rejected = await post(route, ask(), token(exp=int(time.time()) - 3600))
    assert rejected.status_code == 401
    assert rejected.json()["error"]["message"] == "The agent token was not accepted (expired)."
    assert rejected.headers["www-authenticate"].startswith('Bearer error="invalid_token"')

    merchant_token = jwt.encode(
        {"iss": "https://merchant.test"}, "a-merchant-secret-of-32-bytes-ok!", algorithm="HS256"
    )
    passed = await post(route, ask(), merchant_token)
    assert passed.status_code == 418
    assert json.loads(passed.text.removeprefix("merchant:")) == ask()
    async with client(route) as http:
        assert (await http.get("/elsewhere")).status_code == 418


async def test_an_agent_from_the_other_environment_is_403() -> None:
    response = await post(route_for(environment="live"), ask(), token())
    assert response.status_code == 403
    assert "environment_mismatch" in response.json()["error"]["message"]


@respx.mock
async def test_an_agent_key_is_served_and_passed_to_solvapay() -> None:
    respx.post(f"{API}/v1/sdk/agent/keys/verifications").respond(
        200,
        json={"agentRef": "agt_2", "principalRef": "ppl_2", "promptExcerpt": False,
              "environment": "sandbox"},
    )  # fmt: skip
    authorize = respx.post(f"{API}/v1/sdk/agent/calls").respond(200, json=ALLOWED)
    respx.post(f"{API}/v1/sdk/agent/calls/call_1/complete").respond(200, json=COMPLETED)
    result = (await post(route_for(), ask(), "agk_live1")).json()["result"]
    assert result["content"] == [{"type": "text", "text": "42"}]
    sent = json.loads(authorize.calls.last.request.content)
    assert sent["agentToken"] == "agk_live1"
    assert "promptExcerpt" not in sent


@respx.mock
async def test_an_unknown_agent_key_is_401() -> None:
    respx.post(f"{API}/v1/sdk/agent/keys/verifications").respond(
        401, json={"statusCode": 401, "message": "Unknown key"}
    )
    assert (await post(route_for(), ask(), "agk_nope")).status_code == 401


# OAuth on ------------------------------------------------------------------------

PROTECTED = ProtectedResource(resource="http://merchant.test/mcp")


async def test_the_metadata_is_served_at_both_paths() -> None:
    route = route_for(protected=PROTECTED)
    async with client(route) as http:
        for path in (
            "/.well-known/oauth-protected-resource/mcp",
            "/mcp/.well-known/oauth-protected-resource",
        ):
            response = await http.get(path)
            assert response.json() == {
                "resource": "http://merchant.test/mcp",
                "authorization_servers": [ISSUER],
                "scopes_supported": ["usage"],
                "bearer_methods_supported": ["header"],
                "resource_name": "merchant-test",
            }
            assert response.headers["access-control-allow-origin"] == "*"


async def test_before_sign_in_tools_list_and_free_tools_run() -> None:
    route = route_for(protected=PROTECTED)
    listed = (await post(route, rpc("tools/list"))).json()["result"]["tools"]
    tools = {tool["name"]: tool for tool in listed}
    assert set(tools) == {"ping", "answer"}
    assert tools["answer"]["annotations"] == {"readOnlyHint": False, "destructiveHint": False}
    assert tools["answer"]["title"] == "answer"
    assert tools["answer"]["inputSchema"]["properties"]["question"]["description"] == (
        "What to answer."
    )
    free = (await post(route, rpc("tools/call", {"name": "ping", "arguments": {}}))).json()
    assert free["result"]["content"] == [{"type": "text", "text": "pong"}]


async def test_a_paid_call_without_a_token_gets_the_challenge() -> None:
    response = await post(route_for(protected=PROTECTED), ask())
    assert response.status_code == 401
    assert response.json() == {
        "jsonrpc": "2.0",
        "id": 7,
        "error": {"code": -32001, "message": "Sign in to pay for this tool"},
    }
    assert response.headers["www-authenticate"] == (
        'Bearer error="invalid_token", error_description="Sign in to pay for this tool", '
        'resource_metadata="http://merchant.test/.well-known/oauth-protected-resource/mcp", '
        'scope="usage"'
    )
    assert response.headers["access-control-expose-headers"] == "WWW-Authenticate"


async def test_with_lazy_auth_off_a_free_call_is_challenged_too() -> None:
    route = route_for(protected=PROTECTED, lazy_auth=False)
    free = await post(route, rpc("tools/call", {"name": "ping", "arguments": {}}))
    assert free.status_code == 401
    assert (await post(route, rpc("tools/list"))).status_code == 200


async def test_the_merchants_own_bearer_goes_to_its_handler_unless_it_calls_a_paid_tool() -> None:
    route = route_for(protected=PROTECTED)
    listed = await post(route, rpc("tools/list"), "merchant-session-token")
    assert listed.status_code == 418
    assert (await post(route, ask(), "merchant-session-token")).status_code == 401


async def test_an_expired_token_is_challenged_so_the_host_refreshes() -> None:
    response = await post(
        route_for(protected=PROTECTED),
        ask(),
        token(aud="http://merchant.test/mcp", exp=int(time.time()) - 3600),
    )
    assert response.status_code == 401
    assert response.json()["error"]["message"] == "The sign-in has expired: sign in again"
    assert 'resource_metadata="' in response.headers["www-authenticate"]


@respx.mock
async def test_a_signed_in_host_is_served_with_its_oauth_token() -> None:
    respx.post(f"{API}/v1/sdk/agent/calls").respond(200, json=ALLOWED)
    respx.post(f"{API}/v1/sdk/agent/calls/call_1/complete").respond(200, json=COMPLETED)
    response = await post(
        route_for(protected=PROTECTED), ask(), token(aud="http://merchant.test/mcp")
    )
    assert response.json()["result"]["content"] == [{"type": "text", "text": "42"}]


@respx.mock
async def test_a_signed_in_agent_keeps_the_free_tools_and_pays_nothing_for_them() -> None:
    authorize = respx.post(f"{API}/v1/sdk/agent/calls").respond(200, json=ALLOWED)
    response = await post(
        route_for(protected=PROTECTED),
        rpc("tools/call", {"name": "ping", "arguments": {}}),
        token(aud="http://merchant.test/mcp"),
    )
    assert response.json()["result"]["content"] == [{"type": "text", "text": "pong"}]
    assert authorize.call_count == 0


@pytest.mark.parametrize("path", ["/mcp", "/other"])
async def test_without_oauth_a_request_with_no_bearer_is_the_merchants(path: str) -> None:
    async with client(route_for()) as http:
        response = await http.post(path, json=ask())
    assert response.status_code == 418
