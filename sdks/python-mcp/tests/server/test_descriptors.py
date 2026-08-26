from __future__ import annotations

import pytest
from solvapay.facade import create_solvapay
from tests.server.recording_client import RecordingClient

from solvapay_mcp.register import reset_request_customer_ref, set_request_customer_ref
from solvapay_mcp.server.descriptors import build_solvapay_descriptors
from solvapay_mcp.server.native import native_call
from solvapay_mcp.widget import RESOURCE_URI_META_KEY

RESOURCE = "ui://solvapay/mcp-app.html"


def _names() -> dict[str, str]:
    names = native_call("MCP_TOOL_NAMES", {})
    assert isinstance(names, dict)
    return {str(k): str(v) for k, v in names.items()}


def _bundle(client: RecordingClient, **kwargs: object) -> dict[str, object]:
    solvapay = create_solvapay(api_client=client)
    return build_solvapay_descriptors(
        solvapay=solvapay,
        product_ref="prd_demo",
        resource_uri=RESOURCE,
        public_base_url="https://mcp.example",
        **kwargs,
    )


def _handler(bundle: dict[str, object], name: str):
    handlers = bundle["handlers"]
    assert isinstance(handlers, dict)
    return handlers[name]


@pytest.mark.asyncio
async def test_create_checkout_session_schema_and_call_order() -> None:
    names = _names()
    client = RecordingClient(
        {
            "create_checkout_session": {
                "sessionId": "cs_1",
                "checkoutUrl": "https://pay.example/cs_1",
            }
        }
    )
    bundle = _bundle(client)
    tools = bundle["tools"]
    assert isinstance(tools, list)
    tool = next(
        item
        for item in tools
        if isinstance(item, dict) and item["name"] == names["createCheckoutSession"]
    )
    schema = tool["inputSchema"]
    assert isinstance(schema, dict)
    assert "planRef" in schema["properties"]
    token = set_request_customer_ref("cus_auth")
    try:
        result = await _handler(bundle, names["createCheckoutSession"])({"planRef": "pln_1"})
    finally:
        reset_request_customer_ref(token)
    assert client.calls[0][0] == "create_checkout_session"
    assert client.calls[0][1]["customerRef"] == "cus_auth"
    assert result["structuredContent"]["sessionId"] == "cs_1"


@pytest.mark.asyncio
async def test_create_payment_requires_auth() -> None:
    names = _names()
    bundle = _bundle(RecordingClient())
    result = await _handler(bundle, names["createPayment"])(
        {"planRef": "pln_1", "productRef": "prd_demo"}
    )
    assert result["isError"] is True
    assert result["structuredContent"]["status"] == 401


@pytest.mark.asyncio
async def test_process_payment_call_order() -> None:
    names = _names()
    client = RecordingClient({"process_payment_intent": {"status": "succeeded"}})
    bundle = _bundle(client)
    token = set_request_customer_ref("cus_auth")
    try:
        await _handler(bundle, names["processPayment"])(
            {"paymentIntentId": "pi_1", "productRef": "prd_demo"}
        )
    finally:
        reset_request_customer_ref(token)
    assert client.calls[0][0] == "process_payment_intent"
    assert client.calls[0][1]["paymentIntentId"] == "pi_1"


@pytest.mark.asyncio
async def test_create_customer_session_requires_customer() -> None:
    names = _names()
    client = RecordingClient({"create_customer_session": {"clientSecret": "sec"}})
    bundle = _bundle(client)
    token = set_request_customer_ref("cus_auth")
    try:
        result = await _handler(bundle, names["createCustomerSession"])({})
    finally:
        reset_request_customer_ref(token)
    assert client.calls[0][0] == "create_customer_session"
    assert result["structuredContent"]["clientSecret"] == "sec"


@pytest.mark.asyncio
async def test_create_topup_payment_sends_amount() -> None:
    names = _names()
    client = RecordingClient({"create_topup_payment_intent": {"id": "pi_t"}})
    bundle = _bundle(client)
    token = set_request_customer_ref("cus_auth")
    try:
        await _handler(bundle, names["createTopupPayment"])({"amount": 1000, "currency": "USD"})
    finally:
        reset_request_customer_ref(token)
    assert client.calls[0][0] == "create_topup_payment_intent"
    assert client.calls[0][1]["amount"] == 1000


@pytest.mark.asyncio
async def test_attach_business_details_call() -> None:
    names = _names()
    client = RecordingClient({"attach_business_details": {"ok": True}})
    bundle = _bundle(client)
    token = set_request_customer_ref("cus_auth")
    try:
        await _handler(bundle, names["attachBusinessDetails"])(
            {"paymentIntentId": "pi_1", "isBusiness": True}
        )
    finally:
        reset_request_customer_ref(token)
    assert client.calls[0][0] == "attach_business_details"


@pytest.mark.asyncio
async def test_cancel_and_reactivate_pass_purchase_ref(monkeypatch: pytest.MonkeyPatch) -> None:
    async def no_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr("solvapay_mcp.server.helpers.asyncio.sleep", no_sleep)
    names = _names()
    client = RecordingClient(
        {
            "cancel_purchase": {"reference": "pur_1"},
            "reactivate_purchase": {"reference": "pur_1"},
        }
    )
    bundle = _bundle(client)
    token = set_request_customer_ref("cus_auth")
    try:
        await _handler(bundle, names["cancelRenewal"])({"purchaseRef": "pur_1"})
        await _handler(bundle, names["reactivateRenewal"])({"purchaseRef": "pur_1"})
    finally:
        reset_request_customer_ref(token)
    methods = [name for name, _ in client.calls]
    assert methods == ["cancel_purchase", "reactivate_purchase"]


@pytest.mark.asyncio
async def test_activate_plan_with_ref_calls_core() -> None:
    names = _names()
    client = RecordingClient({"activate_plan": {"status": "active"}})
    bundle = _bundle(client)
    token = set_request_customer_ref("cus_auth")
    try:
        result = await _handler(bundle, names["activatePlan"])(
            {"planRef": "pln_free", "productRef": "prd_demo"}
        )
    finally:
        reset_request_customer_ref(token)
    assert client.calls[0][0] == "activate_plan"
    assert result["structuredContent"]["status"] == "active"


@pytest.mark.asyncio
async def test_intent_tools_bootstrap_without_auth() -> None:
    names = _names()
    client = RecordingClient(
        {
            "get_merchant": {"displayName": "Acme"},
            "get_product": {"reference": "prd_demo", "name": "Demo"},
            "get_platform_config": {},
            "list_plans": [],
        }
    )
    bundle = _bundle(client)
    result = await _handler(bundle, names["upgrade"])({"mode": "text"})
    assert result["structuredContent"]["view"] == "checkout"
    assert "ui" not in result.get("_meta", {})


def test_intent_tool_meta_includes_legacy_uri() -> None:
    names = _names()
    bundle = _bundle(RecordingClient())
    tools = bundle["tools"]
    assert isinstance(tools, list)
    upgrade = next(
        item for item in tools if isinstance(item, dict) and item["name"] == names["upgrade"]
    )
    meta = upgrade["meta"]
    assert isinstance(meta, dict)
    ui = meta.get("ui")
    assert isinstance(ui, dict)
    assert ui["resourceUri"] == RESOURCE
    assert meta[RESOURCE_URI_META_KEY] == RESOURCE


@pytest.mark.asyncio
async def test_trace_preserves_bootstrap_status() -> None:
    names = _names()
    client = RecordingClient(
        {
            "get_merchant": {"error": "gone", "status": 404},
            "get_product": {"reference": "prd_demo"},
            "get_platform_config": {},
            "list_plans": [],
        }
    )
    bundle = _bundle(client)
    result = await _handler(bundle, names["manageAccount"])({})
    assert result["isError"] is True
    assert result["structuredContent"]["status"] == 404
    assert "npx solvapay init" in str(result["content"][0]["text"])
