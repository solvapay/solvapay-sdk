from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx
from mcp.types import CallToolResult

from solvapay import FreeLimit, SolvaPayError, create_solvapay
from solvapay.mcp import (
    Nudge,
    ResponseContext,
    SolvaPayTokenVerifier,
    create_solvapay_mcp_server,
)

API = "https://api.test"
PUBLIC = "https://mcp.test"


def server(**kw: Any) -> Any:
    solvapay = create_solvapay(api_key="sk_sandbox_test", api_base_url=API, product_ref="prd_1")
    return create_solvapay_mcp_server(solvapay=solvapay, public_base_url=PUBLIC, **kw)


def as_customer(ref: str) -> Any:
    return lambda _args, _context: ref


def limits(**fields: Any) -> dict[str, Any]:
    return {"withinLimits": True, "remaining": 5, "meterName": "requests", **fields}


def dump(result: CallToolResult) -> dict[str, Any]:
    return result.model_dump(by_alias=True, exclude_none=True, mode="json")


async def call(mcp: Any, name: str, args: dict[str, Any]) -> dict[str, Any]:
    result = await mcp.server.call_tool(name, args)
    assert isinstance(result, CallToolResult)
    return dump(result)


async def quote(symbol: str, ctx: ResponseContext) -> Any:
    return ctx.respond({"symbol": symbol, "price": 101.5})


@respx.mock
async def test_an_allowed_call_runs_the_handler_and_records_success() -> None:
    respx.post(f"{API}/v1/sdk/limits").respond(200, json=limits())
    usage = respx.post(f"{API}/v1/sdk/usages").respond(200, json={"success": True})
    mcp = server()
    mcp.register_payable("quote", handler=quote, get_customer_ref=as_customer("cus_1"))
    result = await call(mcp, "quote", {"symbol": "ACME"})
    assert result["isError"] is False
    assert result["content"] == [{"type": "text", "text": '{"symbol":"ACME","price":101.5}'}]
    assert result["structuredContent"] == {"symbol": "ACME", "price": 101.5}
    body = json.loads(usage.calls.last.request.content)
    assert (body["outcome"], body["metadata"]["toolName"]) == ("success", "quote")


@respx.mock
async def test_a_gated_call_returns_the_paywall() -> None:
    respx.post(f"{API}/v1/sdk/limits").respond(
        200, json={"withinLimits": False, "remaining": 0, "checkoutUrl": "https://pay.test/c"}
    )
    respx.post(f"{API}/v1/sdk/usages").respond(200, json={"success": True})
    mcp = server()
    mcp.register_payable("quote", handler=quote, get_customer_ref=as_customer("cus_1"))
    result = await call(mcp, "quote", {"symbol": "ACME"})
    assert result["isError"] is False
    assert result["structuredContent"]["kind"] == "payment_required"
    assert result["content"][0]["text"] == result["structuredContent"]["message"]


async def test_a_call_without_a_customer_is_refused() -> None:
    mcp = server()
    mcp.register_payable("quote", handler=quote)
    result = await call(mcp, "quote", {"symbol": "ACME"})
    assert result["isError"] is True
    assert "signed-in customer" in result["content"][0]["text"]


@respx.mock
async def test_text_and_nudge_shape_the_content() -> None:
    respx.post(f"{API}/v1/sdk/limits").respond(200, json=limits(remaining=1))
    respx.post(f"{API}/v1/sdk/usages").respond(200, json={"success": True})

    async def handler(symbol: str, ctx: ResponseContext) -> Any:
        await ctx.emit({"type": "text", "text": "first"})
        return ctx.respond(
            {"symbol": symbol},
            text=f"{symbol} is up",
            nudge=Nudge(kind="approaching-limit", message="One call left."),
        )

    mcp = server()
    mcp.register_payable("quote", handler=handler, get_customer_ref=as_customer("cus_1"))
    result = await call(mcp, "quote", {"symbol": "ACME"})
    assert result["content"] == [
        {"type": "text", "text": "first"},
        {"type": "text", "text": "ACME is up\n\nOne call left."},
        {"type": "text", "text": '{"symbol":"ACME"}'},
        {
            "type": "resource",
            "resource": {
                "uri": "solvapay://nudge",
                "mimeType": "text/plain",
                "text": "One call left.",
            },
        },
    ]


@respx.mock
async def test_ctx_gate_returns_a_paywall_without_a_fail_event() -> None:
    respx.post(f"{API}/v1/sdk/limits").respond(200, json=limits())
    usage = respx.post(f"{API}/v1/sdk/usages").respond(200, json={"success": True})

    async def handler(symbol: str, ctx: ResponseContext) -> Any:
        ctx.gate("Upgrade for real-time prices")
        return ctx.respond({})

    mcp = server()
    mcp.register_payable("quote", handler=handler, get_customer_ref=as_customer("cus_1"))
    result = await call(mcp, "quote", {"symbol": "ACME"})
    assert result["isError"] is False
    assert result["structuredContent"]["message"] == "Upgrade for real-time prices"
    assert not usage.called


@respx.mock
async def test_a_handler_error_is_a_tool_error_and_records_fail() -> None:
    respx.post(f"{API}/v1/sdk/limits").respond(200, json=limits())
    usage = respx.post(f"{API}/v1/sdk/usages").respond(200, json={"success": True})

    async def handler(symbol: str, ctx: ResponseContext) -> Any:
        raise RuntimeError("market data unavailable")

    mcp = server()
    mcp.register_payable("quote", handler=handler, get_customer_ref=as_customer("cus_1"))
    result = await call(mcp, "quote", {"symbol": "ACME"})
    assert result["isError"] is True
    assert "market data unavailable" in result["content"][0]["text"]
    assert json.loads(usage.calls.last.request.content)["outcome"] == "fail"


@respx.mock
async def test_free_tools_send_their_allowance_and_describe_it() -> None:
    check = respx.post(f"{API}/v1/sdk/limits").respond(200, json=limits())
    respx.post(f"{API}/v1/sdk/usages").respond(200, json={"success": True})
    mcp = server()
    limit = FreeLimit(cap=3, scope="lifetime", meter="free-quotes")
    mcp.register_free("quote", handler=quote, limit=limit, get_customer_ref=as_customer("cus_1"))
    mcp.register_free("quote2", handler=quote, limit=limit, get_customer_ref=as_customer("cus_1"))
    tools = {t.name: t for t in await mcp.server.list_tools()}
    assert tools["quote"].description == (
        "Free tool — 3 calls per lifetime, then a plan is required. "
        "Call `account` for remaining usage."
    )
    assert tools["quote2"].description.endswith("Shares a free allowance with `quote`.")
    await call(mcp, "quote", {"symbol": "ACME"})
    body = json.loads(check.calls.last.request.content)
    assert body["freeAllowance"] == {"meter": "free-quotes", "cap": 3, "scope": "lifetime"}


def test_free_tools_on_one_meter_must_agree() -> None:
    mcp = server()
    mcp.register_free("a", handler=quote, limit=FreeLimit(cap=3, scope="lifetime"))
    with pytest.raises(SolvaPayError):
        mcp.register_free("b", handler=quote, limit=FreeLimit(cap=5, scope="lifetime"))


def test_a_handler_needs_a_response_context() -> None:
    async def bad(symbol: str) -> Any:
        return symbol

    with pytest.raises(SolvaPayError) as caught:
        server().register_payable("bad", handler=bad)
    assert caught.value.code == "invalid_handler"


# Sign-in -------------------------------------------------------------------


@respx.mock
async def test_the_token_verifier_asks_solvapay() -> None:
    route = respx.get(f"{API}/v1/customer/auth/userinfo")
    route.side_effect = [
        httpx.Response(200, json={"sub": "cus_7", "email": "c@example.com"}),
        httpx.Response(401, json={"statusCode": 401}),
    ]
    verifier = SolvaPayTokenVerifier(api_base_url=API)
    token = await verifier.verify_token("good")
    assert token is not None and token.subject == "cus_7"
    assert route.calls.last.request.headers["authorization"] == "Bearer good"
    assert await verifier.verify_token("good") is token  # cached
    assert await verifier.verify_token("bad") is None


@respx.mock
async def test_a_verification_outage_fails_loudly() -> None:
    respx.get(f"{API}/v1/customer/auth/userinfo").respond(503)
    with pytest.raises(SolvaPayError):
        await SolvaPayTokenVerifier(api_base_url=API).verify_token("t")


def client(mcp: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=mcp.http_app()), base_url=PUBLIC)


async def test_the_mcp_endpoint_asks_for_sign_in() -> None:
    async with client(server()) as http:
        response = await http.post("/mcp", json={})
    assert response.status_code == 401
    assert "/.well-known/oauth-protected-resource/mcp" in response.headers["www-authenticate"]


async def test_discovery_points_clients_at_this_server() -> None:
    async with client(server()) as http:
        resource = (await http.get("/.well-known/oauth-protected-resource/mcp")).json()
        auth = (await http.get("/.well-known/oauth-authorization-server")).json()
    assert resource["resource"] == f"{PUBLIC}/mcp"
    assert resource["authorization_servers"] == [PUBLIC]
    assert auth["token_endpoint"] == f"{PUBLIC}/oauth/token"
    assert auth["registration_endpoint"] == f"{PUBLIC}/oauth/register"


async def test_authorize_redirects_to_solvapay_with_the_query() -> None:
    async with client(server()) as http:
        response = await http.get("/oauth/authorize?client_id=c1&code_challenge=x%2By")
    assert response.status_code == 302
    assert response.headers["location"] == (
        f"{API}/v1/customer/auth/authorize?client_id=c1&code_challenge=x%2By"
    )


@respx.mock
async def test_register_is_forwarded_for_the_product() -> None:
    upstream = respx.post(f"{API}/v1/customer/auth/register").respond(201, json={"client_id": "c1"})
    respx.route(host="mcp.test").pass_through()
    async with client(server()) as http:
        response = await http.post("/oauth/register", json={"redirect_uris": ["x"]})
    assert response.status_code == 201
    assert upstream.calls.last.request.url.params["product_ref"] == "prd_1"


@respx.mock
async def test_token_errors_are_oauth_shaped_and_bodies_pass_verbatim() -> None:
    upstream = respx.post(f"{API}/v1/customer/auth/token").respond(
        400, json={"statusCode": 400, "message": "code expired"}
    )
    respx.route(host="mcp.test").pass_through()
    raw = "grant_type=authorization_code&code_verifier=a+b%20c"
    async with client(server()) as http:
        response = await http.post(
            "/oauth/token",
            content=raw,
            headers={"content-type": "application/x-www-form-urlencoded", "origin": "https://x"},
        )
    assert response.json() == {"error": "invalid_request", "error_description": "code expired"}
    assert response.headers["access-control-allow-origin"] == "https://x"
    assert upstream.calls.last.request.content.decode() == raw
