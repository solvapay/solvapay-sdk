"""The SolvaPay widget: its UI resource, the ``account`` tool's ``_meta.ui``, the
bootstrap resource, the transport tools and ``hide_tools_by_audience``.

What each transport tool answers is pinned by ``conformance/cases/transport-tools``;
these tests cover the wiring and what the cases cannot see (request bodies, the
cancel path TypeScript cannot run).
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
import respx
from mcp.types import CallToolResult, ListToolsResult, Tool

from solvapay import SolvaPayError, create_solvapay
from solvapay.business_details import validate_business_details
from solvapay.mcp import create_solvapay_mcp_server, transport
from solvapay.mcp.app import (
    BOOTSTRAP_URI,
    RESOURCE_MIME_TYPE,
    HideToolsByAudience,
    default_resource_uri,
    merge_csp,
    widget_html,
)

API = "https://api.test"
PUBLIC = "https://mcp.test"
# A customer token as SolvaPay issues one: a JWT whose payload names the customer.
TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjdXNfMSJ9.c2ln"
UI = "ui://solvapay-mcp/mcp-app.html"
TRANSPORT_TOOLS = {
    "create_hosted_session",
    "create_payment_intent",
    "process_payment",
    "attach_business_details",
    "set_renewal",
    "get_history",
}
PURCHASE = {
    "reference": "pur_1",
    "status": "active",
    "customerRef": "cus_1",
    "amount": 2900,
    "currency": "USD",
    "isRecurring": True,
    "startDate": "2026-11-01T00:00:00Z",
    "createdAt": "2026-11-01T00:00:00Z",
}


def server(customer: str | None = "cus_1", **kw: Any) -> Any:
    solvapay = create_solvapay(api_key="sk_sandbox_test", api_base_url=API, product_ref="prd_1")
    return create_solvapay_mcp_server(
        solvapay=solvapay,
        public_base_url=PUBLIC,
        get_customer_ref=lambda _args, _context: customer,
        **kw,
    )


async def call(mcp: Any, name: str, args: dict[str, Any]) -> dict[str, Any]:
    result = await mcp.server.call_tool(name, args)
    assert isinstance(result, CallToolResult)
    return result.model_dump(by_alias=True, exclude_none=True, mode="json")


def mock_catalog(router: respx.MockRouter) -> None:
    router.get(f"{API}/v1/sdk/merchant").respond(
        200, json={"displayName": "Acme", "legalName": "Acme Ltd"}
    )
    router.get(f"{API}/v1/sdk/products/prd_1").respond(
        200,
        json={
            "reference": "prd_1",
            "name": "Stock Research",
            "status": "active",
            "balance": 0,
            "isManagedMcp": False,
            "isMcpPay": False,
            "totalTransactions": 0,
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        },
    )
    router.get(f"{API}/v1/sdk/products/prd_1/plans").respond(200, json={"plans": []})
    router.get(f"{API}/v1/sdk/platform-config").respond(200, json={"stripePublishableKey": "pk_1"})


# ---- the UI resource -----------------------------------------------------------


def test_the_widget_ships_with_the_package() -> None:
    html = widget_html()
    assert html.startswith("<!doctype html>")
    assert '<div id="root"></div>' in html
    # One self-contained file: no script or stylesheet loaded from elsewhere.
    assert "<script" in html
    assert 'src="/' not in html


async def test_the_widget_is_served_as_an_mcp_app() -> None:
    mcp = server()
    assert mcp.resource_uri == UI
    listed = {str(r.uri): r for r in await mcp.server.list_resources()}
    assert listed[UI].mime_type == RESOURCE_MIME_TYPE
    contents = list(await mcp.server.read_resource(UI))
    assert len(contents) == 1
    assert contents[0].content == widget_html()
    assert contents[0].mime_type == RESOURCE_MIME_TYPE
    ui = contents[0].meta["ui"]
    assert ui == listed[UI].meta["ui"]
    assert ui["prefersBorder"] is True
    assert "https://js.stripe.com" in ui["csp"]["frameDomains"]
    # The API origin, for branding images and API calls from the iframe.
    assert ui["csp"]["resourceDomains"][-1] == API
    assert ui["csp"]["connectDomains"][-1] == API


def test_csp_merges_overrides_once() -> None:
    csp = merge_csp(
        {"connectDomains": ["https://api.example.com", "https://api.stripe.com"]},
        "https://api.test/v1/",
    )
    assert csp["connectDomains"].count("https://api.stripe.com") == 1
    assert csp["connectDomains"][-2:] == ["https://api.example.com", "https://api.test"]
    assert "https://api.test" not in csp["frameDomains"]
    with pytest.raises(SolvaPayError):
        merge_csp({"scriptDomains": ["https://x.test"]})


def test_resource_uri_defaults_to_the_server_name() -> None:
    assert default_resource_uri("Stock Research") == "ui://stock-research/mcp-app.html"
    assert server(name="research").resource_uri == "ui://research/mcp-app.html"
    assert server(resource_uri="ui://acme/app.html").resource_uri == "ui://acme/app.html"


# ---- the account tool ----------------------------------------------------------


async def test_account_lists_the_widget() -> None:
    tools = {tool.name: tool for tool in await server().server.list_tools()}
    assert tools["account"].meta == {"ui": {"resourceUri": UI}, "ui/resourceUri": UI}
    assert tools["activate_plan"].meta == {"openai/widgetAccessible": True}


@respx.mock
async def test_account_opens_the_widget_except_in_text_mode() -> None:
    mock_catalog(respx.mock)
    mcp = server(customer=None)
    auto = await call(mcp, "account", {"view": "checkout"})
    ui = await call(mcp, "account", {"view": "checkout", "mode": "ui"})
    text = await call(mcp, "account", {"view": "checkout", "mode": "text"})
    assert auto["_meta"]["ui"] == {"resourceUri": UI}
    assert ui["_meta"]["ui"] == {"resourceUri": UI}
    assert "ui" not in text["_meta"]
    assert "openai/widgetSessionId" in text["_meta"]
    # Text-only hosts read the same narration whether or not the widget opens.
    assert auto["content"] == text["content"]
    assert auto["structuredContent"] == text["structuredContent"]


@respx.mock
async def test_the_bootstrap_resource_is_the_default_view_for_the_caller() -> None:
    mock_catalog(respx.mock)
    mcp = server(customer=None)
    listed = {str(r.uri): r for r in await mcp.server.list_resources()}
    assert listed[BOOTSTRAP_URI].mime_type == "application/json"
    contents = list(await mcp.server.read_resource(BOOTSTRAP_URI))
    payload = json.loads(contents[0].content)
    tool = await call(mcp, "account", {})
    assert payload["view"] == "checkout"
    # The same snapshot `account` answers when no view is given.
    assert payload == tool["structuredContent"]


# ---- transport tools -----------------------------------------------------------


async def test_transport_tools_are_for_the_widget_only() -> None:
    tools = {tool.name: tool for tool in await server().server.list_tools()}
    for name in TRANSPORT_TOOLS:
        assert tools[name].meta == {
            "ui": {"resourceUri": UI, "visibility": ["app"]},
            "audience": "ui",
            "openai/widgetAccessible": True,
            "openai/visibility": "private",
            "ui/resourceUri": UI,
        }, name
        assert tools[name].description.startswith("UI-only; agents should prefer `account`")
        assert tools[name].annotations.open_world_hint is True
    assert tools["create_payment_intent"].input_schema["required"] == ["purpose"]
    assert tools["set_renewal"].input_schema["required"] == ["purchaseRef", "enabled"]
    assert tools["get_history"].input_schema["properties"]["limit"]["anyOf"][0] == {
        "exclusiveMinimum": 0,
        "maximum": 100,
        "type": "integer",
    }


@pytest.fixture
def no_settle(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(transport, "SETTLE_SECONDS", 0)


@respx.mock
async def test_set_renewal_cancels(no_settle: None) -> None:
    route = respx.post(f"{API}/v1/sdk/purchases/pur_1/cancel").respond(
        200,
        json={
            "success": True,
            "purchase": {**PURCHASE, "status": "cancelled", "cancelledAt": "2026-11-12T00:00:00Z"},
        },
    )
    result = await call(
        server(), "set_renewal", {"purchaseRef": "pur_1", "enabled": False, "reason": "Too pricey"}
    )
    assert json.loads(route.calls.last.request.content) == {"reason": "Too pricey"}
    assert "isError" not in result or result["isError"] is False
    assert result["structuredContent"]["cancelledAt"] == "2026-11-12T00:00:00Z"
    assert json.loads(result["content"][0]["text"]) == result["structuredContent"]


@respx.mock
@pytest.mark.parametrize(
    ("status", "error"),
    [
        (404, "Purchase not found"),
        (400, "Purchase cannot be cancelled or does not belong to provider"),
        (409, "Already cancelled"),
    ],
)
async def test_set_renewal_maps_a_refused_cancel(no_settle: None, status: int, error: str) -> None:
    respx.post(f"{API}/v1/sdk/purchases/pur_1/cancel").respond(
        status, json={"message": "Already cancelled"}
    )
    result = await call(server(), "set_renewal", {"purchaseRef": "pur_1", "enabled": False})
    assert result["isError"] is True
    assert result["structuredContent"] == {
        "error": error,
        "status": 500 if status == 409 else status,
        "details": "Already cancelled",
    }


@respx.mock
async def test_set_renewal_refuses_a_cancel_the_api_did_not_make(no_settle: None) -> None:
    respx.post(f"{API}/v1/sdk/purchases/pur_1/cancel").respond(
        200, json={"success": True, "purchase": PURCHASE}
    )
    result = await call(server(), "set_renewal", {"purchaseRef": "pur_1", "enabled": False})
    assert result["structuredContent"]["status"] == 500
    assert "without cancelledAt" in result["structuredContent"]["error"]


@respx.mock
async def test_attach_business_details_sends_the_validated_fields() -> None:
    route = respx.post(f"{API}/v1/sdk/payment-intents/pi_1/business-details").respond(
        200,
        json={
            "taxBreakdown": {
                "subtotal": 2900,
                "taxAmount": 239,
                "taxRate": 0.0825,
                "treatment": "standard",
                "total": 3139,
                "currency": "USD",
                "inclusive": False,
            }
        },
    )
    await call(
        server(),
        "attach_business_details",
        {
            "paymentIntentId": "pi_1",
            "isBusiness": False,
            "customerCountry": "us",
            "customerName": " Ada ",
            "customerState": "TX",
            "customerPostalCode": " 78701 ",
        },
    )
    assert json.loads(route.calls.last.request.content) == {
        "isBusiness": False,
        "customerCountry": "US",
        "customerName": "Ada",
        "customerState": "TX",
        "customerPostalCode": "78701",
        "customerRef": "cus_1",
    }


@respx.mock
async def test_create_payment_intent_sends_an_idempotency_key() -> None:
    route = respx.post(f"{API}/v1/sdk/payment-intents").respond(
        200,
        json={
            "processorPaymentId": "pi_1",
            "clientSecret": "s",
            "publishableKey": "pk",
            "amount": 1000,
            "currency": "usd",
            "status": "requires_payment_method",
        },
    )
    await call(
        server(),
        "create_payment_intent",
        {
            "purpose": "topup",
            "amount": 1000,
            "currency": "USD",
            "autoRecharge": {
                "enabled": True,
                "triggerType": "balance",
                "topupAmountMajor": 10,
                "currency": "USD",
            },
        },
    )
    request = route.calls.last.request
    assert request.headers["idempotency-key"].startswith("topup-")
    assert json.loads(request.content) == {
        "customerRef": "cus_1",
        "purpose": "credit_topup",
        "amount": 1000,
        "currency": "USD",
        "autoRecharge": {
            "enabled": True,
            "triggerType": "balance",
            "topupAmountMajor": 10,
            "currency": "USD",
        },
    }


@respx.mock
async def test_get_history_reads_both_in_one_go() -> None:
    purchases = respx.get(f"{API}/v1/sdk/purchases").respond(200, json={"purchases": []})
    activity = respx.get(f"{API}/v1/sdk/credits/activity").respond(
        200, json={"entries": [], "hasMore": False}
    )
    result = await call(server(), "get_history", {"productRef": "prd_2", "limit": 5})
    assert dict(purchases.calls.last.request.url.params) == {
        "productRef": "prd_2",
        "customerRef": "cus_1",
    }
    assert dict(activity.calls.last.request.url.params) == {"customerRef": "cus_1", "limit": "5"}
    assert result["structuredContent"] == {
        "charges": [],
        "creditActivity": {"entries": [], "hasMore": False},
    }


# ---- hide_tools_by_audience ----------------------------------------------------


def tools_list_context(user_agent: str | None = None, client: str | None = None) -> Any:
    headers = {"user-agent": user_agent} if user_agent else {}
    params = SimpleNamespace(client_info=SimpleNamespace(name=client)) if client else None
    return SimpleNamespace(
        method="tools/list",
        request=SimpleNamespace(headers=headers),
        session=SimpleNamespace(client_params=params),
    )


LISTED = ListToolsResult(
    tools=[
        Tool(name="account", input_schema={"type": "object"}),
        Tool(name="get_history", input_schema={"type": "object"}, _meta={"audience": "ui"}),
    ]
)


async def next_handler(_ctx: Any) -> Any:
    return LISTED


async def test_hide_tools_by_audience_filters_tools_list() -> None:
    hide = HideToolsByAudience(["ui"])
    result = await hide(tools_list_context("Claude-User"), next_handler)
    assert [tool.name for tool in result.tools] == ["account"]


@pytest.mark.parametrize(
    ("user_agent", "client"), [("openai-mcp/1.0.0", None), (None, "openai-mcp")]
)
async def test_chatgpt_gets_every_tool(user_agent: str | None, client: str | None) -> None:
    hide = HideToolsByAudience(["ui"])
    result = await hide(tools_list_context(user_agent, client), next_handler)
    assert result is LISTED


async def test_other_methods_pass_through() -> None:
    hide = HideToolsByAudience(["ui"], bypass_when=lambda _ctx: False)
    ctx = tools_list_context()
    ctx.method = "tools/call"
    assert await hide(ctx, next_handler) is LISTED


def test_hide_tools_by_audience_is_opt_in() -> None:
    def installed(mcp: Any) -> list[Any]:
        middleware = mcp.server._lowlevel_server.middleware
        return [m for m in middleware if isinstance(m, HideToolsByAudience)]

    assert installed(server()) == []
    assert installed(server(hide_tools_by_audience=["ui"]))[0].hidden == {"ui"}


# ---- business details ----------------------------------------------------------


def test_business_details_normalise_the_tax_id() -> None:
    assert validate_business_details(
        is_business=True, country=" de ", business_name="Acme", tax_id="de 123 456 789"
    ) == {
        "isBusiness": True,
        "country": "DE",
        "customerCountry": "DE",
        "businessName": "Acme",
        "taxId": "DE123456789",
        "taxIdType": "eu_vat",
    }


def test_a_consumer_without_a_country_sends_only_the_name() -> None:
    assert validate_business_details(
        is_business=False, customer_name="Ada", customer_state="TX"
    ) == {"isBusiness": False, "customerName": "Ada"}


def test_a_long_name_is_refused() -> None:
    with pytest.raises(SolvaPayError) as raised:
        validate_business_details(is_business=False, customer_name="a" * 101)
    assert raised.value.status == 400


# ---- over HTTP -----------------------------------------------------------------


async def rpc(http: Any, method: str, params: dict[str, Any], **headers: str) -> Any:
    response = await http.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 2, "method": method, "params": params},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    if response.headers["content-type"].startswith("text/event-stream"):
        data = [line[5:] for line in response.text.splitlines() if line.startswith("data:")]
        return json.loads(data[-1])["result"]
    return response.json()["result"]


@respx.mock
@pytest.mark.parametrize(
    ("user_agent", "listed"),
    [("Claude-User", False), ("openai-mcp/1.0.0", True)],
)
async def test_the_widget_over_http(user_agent: str, listed: bool) -> None:
    respx.get(f"{API}/v1/customer/auth/userinfo").respond(200, json={"sub": "cus_1"})
    respx.route(host="mcp.test").pass_through()
    solvapay = create_solvapay(api_key="sk_sandbox_test", api_base_url=API, product_ref="prd_1")
    app = create_solvapay_mcp_server(
        solvapay=solvapay, public_base_url=PUBLIC, hide_tools_by_audience=["ui"]
    ).http_app()
    headers = {
        "authorization": f"Bearer {TOKEN}",
        "accept": "application/json, text/event-stream",
        "user-agent": user_agent,
    }
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=PUBLIC, headers=headers
        ) as http,
    ):
        init = await http.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "test", "version": "1"},
                },
            },
        )
        session = {"mcp-session-id": init.headers.get("mcp-session-id", "")}
        await http.post(
            "/mcp",
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
            headers=session,
        )
        tools = await rpc(http, "tools/list", {}, **session)
        read = await rpc(http, "resources/read", {"uri": UI}, **session)
    names = {tool["name"] for tool in tools["tools"]}
    assert "account" in names
    # Hidden from every host but ChatGPT, whose iframe can only call listed tools.
    assert names & TRANSPORT_TOOLS == (TRANSPORT_TOOLS if listed else set())
    account = next(tool for tool in tools["tools"] if tool["name"] == "account")
    assert account["_meta"]["ui"] == {"resourceUri": UI}
    [contents] = read["contents"]
    assert contents["mimeType"] == RESOURCE_MIME_TYPE
    assert contents["_meta"]["ui"]["prefersBorder"] is True
    assert contents["text"] == widget_html()
