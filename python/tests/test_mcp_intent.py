"""The built-in ``account`` and ``activate_plan`` tools, prompts and docs resource.

The narration copy itself is pinned by the conformance suite
(``conformance/cases/narration``); these tests cover the API reads behind it and
how the tools answer.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
import respx
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import CallToolResult

from solvapay import create_solvapay
from solvapay.mcp import ResponseContext, create_solvapay_mcp_server

API = "https://api.test"
PUBLIC = "https://mcp.test"
CHECKOUT = "https://solvapay.com/customer/checkout?id=cs_1"
PORTAL = "https://solvapay.com/customer/manage?session=s_1"

PRO_OPTIONS = [
    {"kind": "billingCycle", "interval": "month"},
    {"kind": "charge", "per": "flat", "amountMinor": 2900, "currency": "USD"},
    {"kind": "limit", "meter": "requests", "cap": 5000, "onExceed": "block"},
]


def plan(ref: str, name: str, options: list[Any], **extra: Any) -> dict[str, Any]:
    return {
        "reference": ref,
        "name": name,
        "options": options,
        "type": "recurring",
        "status": "active",
        "isActive": True,
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-01-01T00:00:00Z",
        **extra,
    }


PLANS = [
    plan(
        "pln_free",
        "Free",
        [{"kind": "billingCycle", "interval": "month"}, {"kind": "limit", "cap": 100}],
        requiresPayment=False,
        price=0,
    ),
    plan("pln_pro", "Pro", PRO_OPTIONS, requiresPayment=True, price=2900, currency="USD"),
]

PURCHASE = {
    "reference": "pur_1",
    "status": "active",
    "productRef": "prd_1",
    "planRef": "pln_pro",
    "customerRef": "cus_1",
    "amount": 2900,
    "currency": "USD",
    "isRecurring": True,
    "startDate": "2026-11-01T00:00:00Z",
    "createdAt": "2026-11-01T00:00:00Z",
    "planSnapshot": {"reference": "pln_pro", "name": "Pro", "price": 2900, "currency": "USD",
                     "options": PRO_OPTIONS},
    "usage": {"periodStart": "2026-11-01T00:00:00Z", "periodEnd": "2026-12-01T00:00:00Z"},
}  # fmt: skip


def server(**kw: Any) -> Any:
    solvapay = create_solvapay(api_key="sk_sandbox_test", api_base_url=API, product_ref="prd_1")
    return create_solvapay_mcp_server(solvapay=solvapay, public_base_url=PUBLIC, **kw)


def as_customer(ref: str | None) -> Any:
    return lambda _args, _context: ref


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
    router.get(f"{API}/v1/sdk/products/prd_1/plans").respond(200, json={"plans": PLANS})
    router.get(f"{API}/v1/sdk/platform-config").respond(200, json={"stripePublishableKey": "pk_1"})


def mock_customer(router: respx.MockRouter, limits: dict[str, Any]) -> dict[str, Any]:
    routes = {
        "customer": router.get(f"{API}/v1/sdk/customers/cus_1").respond(
            200,
            json={
                "reference": "cus_1",
                "email": " ada@example.com ",
                "name": "Ada",
                "purchases": [PURCHASE, {**PURCHASE, "reference": "pur_old", "status": "expired"}],
            },
        ),
        "payment": router.get(f"{API}/v1/sdk/payment-method").respond(200, json={"kind": "none"}),
        "balance": router.get(f"{API}/v1/sdk/customers/cus_1/balance").respond(
            200,
            json={
                "customerRef": "cus_1",
                "credits": 2500,
                "creditsPerMinorUnit": 100,
                "displayCurrency": "USD",
                "displayExchangeRate": 1,
                "display": {
                    "amountMajor": 0.25,
                    "currency": "USD",
                    "exchangeRate": 1,
                    "formatted": "$0.25",
                    "rateSource": "parity",
                },
            },
        ),
        "limits": router.post(f"{API}/v1/sdk/limits").respond(200, json=limits),
        "portal": router.post(f"{API}/v1/sdk/customers/customer-sessions").respond(
            200, json={"sessionId": "s_1", "customerUrl": PORTAL}
        ),
        "checkout": router.post(f"{API}/v1/sdk/checkout-sessions").respond(
            200, json={"sessionId": "cs_1", "checkoutUrl": CHECKOUT}
        ),
    }
    return routes


async def test_tools_list_has_the_builtin_tools_next_to_paid_ones() -> None:
    mcp = server()

    async def quote(symbol: str, ctx: ResponseContext) -> Any:
        return ctx.respond({"symbol": symbol})

    mcp.register_payable("quote", handler=quote)
    tools = {tool.name: tool for tool in await mcp.server.list_tools()}
    assert set(tools) == {
        "account",
        "activate_plan",
        "quote",
        # The widget's transport tools (tests/test_mcp_app.py).
        "create_hosted_session",
        "create_payment_intent",
        "process_payment",
        "attach_business_details",
        "set_renewal",
        "get_history",
    }
    assert tools["account"].annotations.read_only_hint is True
    assert tools["account"].input_schema["properties"]["view"]["anyOf"][0]["enum"] == [
        "checkout",
        "account",
        "topup",
    ]
    assert tools["activate_plan"].input_schema["required"] == ["planRef"]
    prompts = [prompt.name for prompt in await mcp.server.list_prompts()]
    assert prompts == ["upgrade", "manage_account", "topup", "activate_plan"]
    resources = [str(resource.uri) for resource in await mcp.server.list_resources()]
    assert resources == [
        "docs://solvapay/overview.md",
        "ui://solvapay-mcp/mcp-app.html",
        "solvapay://bootstrap.json",
    ]


async def test_views_limit_the_account_tool_and_its_prompts() -> None:
    mcp = server(views=["account"])
    tools = {tool.name: tool for tool in await mcp.server.list_tools()}
    assert tools["account"].input_schema["properties"]["view"]["anyOf"][0]["const"] == "account"
    assert [p.name for p in await mcp.server.list_prompts()] == ["manage_account", "activate_plan"]
    assert "account" not in {tool.name for tool in await server(views=[]).server.list_tools()}


@respx.mock
async def test_account_reads_the_customer_and_narrates() -> None:
    mock_catalog(respx.mock)
    routes = mock_customer(
        respx.mock,
        {"withinLimits": True, "remaining": 4200, "limit": 5000, "used": 800,
         "planRef": "pln_pro", "meterName": "requests"},
    )  # fmt: skip
    mcp = server(get_customer_ref=as_customer("cus_1"))
    result = await call(mcp, "account", {"view": "account", "mode": "text"})

    assert result["isError"] is False
    text = result["content"][0]["text"]
    assert text.startswith(
        "**Stock Research — your account**\n\nStock Research is on Pro, $29 a month."
    )
    assert "4,200 of 5,000 calls left this period, renewing Dec 1" in text
    assert "Signed in as: ada@example.com · cus_1" in text
    assert result["content"][1:] == [
        {"type": "resource_link", "uri": PORTAL, "name": "Manage account"},
        {"type": "resource_link", "uri": CHECKOUT, "name": "Open checkout"},
    ]
    data = result["structuredContent"]
    assert data["view"] == "account"
    assert data["stripePublishableKey"] == "pk_1"
    assert data["autoRechargeUrl"] == f"{PORTAL}&tab=credits&intent=autorecharge"
    customer = data["customer"]
    assert (customer["ref"], customer["email"], customer["canCall"]) == (
        "cus_1",
        "ada@example.com",
        True,
    )
    assert [p["reference"] for p in customer["purchase"]["purchases"]] == ["pur_1"]
    assert customer["purchase"]["purchases"][0]["priceDisplay"] == "$29.00"
    assert customer["usage"] == {
        "meterRef": "requests", "total": 5000, "used": 800, "remaining": 4200,
        "percentUsed": 16, "periodStart": "2026-11-01T00:00:00Z",
        "periodEnd": "2026-12-01T00:00:00Z", "purchaseRef": "pur_1",
    }  # fmt: skip
    assert "nextAction" not in customer
    # Whole numbers stay ints on the wire, as TypeScript sends them.
    assert all(type(customer["usage"][k]) is int for k in ("total", "used", "remaining"))
    assert json.loads(routes["limits"].calls.last.request.content) == {
        "customerRef": "cus_1",
        "productRef": "prd_1",
        "meterName": "requests",
    }
    assert json.loads(routes["checkout"].calls.last.request.content) == {
        "productRef": "prd_1",
        "customerRef": "cus_1",
    }
    assert result["_meta"]["openai/widgetSessionId"]


@respx.mock
async def test_account_without_a_view_lands_on_topup_at_a_topup_gate() -> None:
    mock_catalog(respx.mock)
    routes = mock_customer(
        respx.mock,
        {"withinLimits": False, "remaining": 0, "paywallReason": "topup_required",
         "creditBalance": 0, "creditsPerUnit": 10, "planRef": "pln_pro"},
    )  # fmt: skip
    result = await call(server(get_customer_ref=as_customer("cus_1")), "account", {})
    assert result["structuredContent"]["view"] == "topup"
    assert result["structuredContent"]["customer"]["nextAction"] == "topup"
    assert result["content"][0]["text"].startswith("**Top up — Stock Research**")
    body = json.loads(routes["checkout"].calls.last.request.content)
    assert body["purpose"] == "credit_topup"


@respx.mock
async def test_account_without_a_customer_reads_only_the_catalog() -> None:
    mock_catalog(respx.mock)
    result = await call(server(), "account", {"mode": "ui"})
    data = result["structuredContent"]
    assert (data["view"], data["customer"], data["checkoutUrl"]) == ("checkout", None, None)
    assert result["content"][0]["text"] == "Opened Stock Research upgrade. Pro · $29.00."
    assert result["content"][1]["text"].startswith("**Upgrade — Stock Research**")
    assert {call.request.url.path for call in respx.mock.calls} == {
        "/v1/sdk/merchant",
        "/v1/sdk/products/prd_1",
        "/v1/sdk/products/prd_1/plans",
        "/v1/sdk/platform-config",
    }


@respx.mock
async def test_a_failed_customer_read_is_left_out() -> None:
    mock_catalog(respx.mock)
    routes = mock_customer(respx.mock, {"withinLimits": True, "remaining": 1})
    routes["customer"].respond(503, json={"message": "down"})
    routes["balance"].respond(500, json={"message": "down"})
    mcp = server(get_customer_ref=as_customer("cus_1"))
    result = await call(mcp, "account", {"view": "account"})
    customer = result["structuredContent"]["customer"]
    assert (customer["purchase"], customer["balance"]) == (None, None)
    assert result["isError"] is False


@respx.mock
async def test_a_missing_merchant_is_a_tool_error_with_the_recovery() -> None:
    mock_catalog(respx.mock)
    respx.get(f"{API}/v1/sdk/merchant").respond(404, json={"message": "Not found"})
    result = await call(server(), "account", {"view": "checkout"})
    assert result["isError"] is True
    assert result["content"][0]["text"].startswith(
        "Provider account not found on this SolvaPay deployment."
    )
    assert result["structuredContent"]["status"] == 404


async def test_a_disabled_view_is_refused() -> None:
    with pytest.raises(ToolError, match="Input should be 'checkout' or 'account'"):
        await server(views=["checkout", "account"]).server.call_tool("account", {"view": "topup"})


@respx.mock
async def test_auto_recharge_still_parses_as_account() -> None:
    mock_catalog(respx.mock)
    result = await call(server(), "account", {"view": "auto-recharge"})
    assert result["structuredContent"]["view"] == "account"


@respx.mock
async def test_activate_plan_mints_checkout_for_a_paid_plan() -> None:
    mock_catalog(respx.mock)
    activate = respx.post(f"{API}/v1/sdk/activate").respond(
        200, json={"status": "payment_required"}
    )
    respx.post(f"{API}/v1/sdk/checkout-sessions").respond(
        200, json={"sessionId": "cs_1", "checkoutUrl": CHECKOUT}
    )
    mcp = server(get_customer_ref=as_customer("cus_1"))
    mcp.solvapay.paywall._limits["cus_1:prd_1:requests"] = object()
    result = await call(mcp, "activate_plan", {"planRef": " pln_pro "})
    assert result["content"][0]["text"] == (
        f"Pro requires payment. [Open checkout]({CHECKOUT}) (expires in 15 minutes), or "
        "Call `account` with view: 'checkout' to pay."
    )
    assert result["structuredContent"] == {"status": "payment_required", "checkoutUrl": CHECKOUT}
    assert json.loads(activate.calls.last.request.content) == {
        "customerRef": "cus_1",
        "productRef": "prd_1",
        "planRef": "pln_pro",
    }
    assert mcp.solvapay.paywall._limits == {}


async def test_activate_plan_needs_a_plan_ref_and_a_customer() -> None:
    missing = await call(server(), "activate_plan", {"planRef": "  "})
    assert (missing["isError"], missing["structuredContent"]["status"]) == (True, 400)
    anonymous = await call(
        server(get_customer_ref=as_customer("anonymous")), "activate_plan", {"planRef": "pln_pro"}
    )
    assert anonymous["structuredContent"] == {
        "error": "Unauthorized",
        "status": 401,
        "details": "customer_ref missing from MCP auth context",
    }


@pytest.mark.parametrize(
    ("name", "args", "text"),
    [
        ("upgrade", {}, 'Call the `account` tool with view: "checkout" to show upgrade options.'),
        (
            "upgrade",
            {"planRef": "pln_pro"},
            'Call the `account` tool with view: "checkout", then activate plan pln_pro.',
        ),
        ("topup", {"amount": "$10"}, 'Call the `account` tool with view: "topup" and top up '
         "my credits by $10."),
        ("activate_plan", {"planRef": "pln_pro"},
         "Call the `activate_plan` tool with planRef pln_pro."),
    ],
)  # fmt: skip
async def test_prompts_are_one_user_message(name: str, args: dict[str, Any], text: str) -> None:
    result = await server().server.get_prompt(name, args)
    message = result.messages[0]
    assert (message.role, message.content.text) == ("user", text)


async def test_the_overview_resource_reads_as_markdown() -> None:
    contents = list(await server().server.read_resource("docs://solvapay/overview.md"))
    assert contents[0].content.startswith("# SolvaPay MCP server — overview")
    assert contents[0].mime_type == "text/markdown"
