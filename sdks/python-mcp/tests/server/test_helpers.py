from __future__ import annotations

import json
from pathlib import Path

import pytest
from tests.server.recording_client import RecordingClient

from solvapay_mcp.server.helpers import (
    activate_plan_core,
    cancel_purchase_core,
    create_checkout_session_core,
    create_payment_intent_core,
    get_merchant_core,
    get_product_core,
    list_plans_core,
    reactivate_purchase_core,
)
from solvapay_mcp.server.native import native_call

REPO = Path(__file__).resolve().parents[4]
FIXTURES = REPO / "contract" / "fixtures"


def test_checkout_validation_replays_missing_product_fixture() -> None:
    fixture = json.loads(
        (FIXTURES / "helper-checkout" / "checkout-product-missing.json").read_text()
    )
    result = native_call("validate_checkout_session_params", fixture["input"]["args"])
    assert result == fixture["expect"]["result"]


@pytest.mark.asyncio
async def test_checkout_core_calls_client_after_validation() -> None:
    client = RecordingClient(
        {
            "create_checkout_session": {
                "sessionId": "cs_1",
                "checkoutUrl": "https://pay.example/cs_1",
            }
        }
    )
    result = await create_checkout_session_core(
        client,
        customer_ref="cus_1",
        product_ref="prd_demo",
        plan_ref="pln_1",
        return_url="https://mcp.example",
    )
    assert result == {"sessionId": "cs_1", "checkoutUrl": "https://pay.example/cs_1"}
    assert client.calls[0][0] == "create_checkout_session"
    assert client.calls[0][1]["customerRef"] == "cus_1"


@pytest.mark.asyncio
async def test_get_product_core_rejects_empty_ref() -> None:
    client = RecordingClient()
    result = await get_product_core(client, "")
    assert isinstance(result, dict)
    assert result.get("error") or result.get("status")
    assert client.calls == []


@pytest.mark.asyncio
async def test_list_plans_core_projects_plans() -> None:
    client = RecordingClient({"list_plans": [{"reference": "pln_1"}]})
    result = await list_plans_core(client, "prd_demo")
    assert result == {"plans": [{"reference": "pln_1"}], "productRef": "prd_demo"}


@pytest.mark.asyncio
async def test_get_merchant_core_invokes_client() -> None:
    client = RecordingClient({"get_merchant": {"displayName": "Acme"}})
    result = await get_merchant_core(client)
    assert result == {"displayName": "Acme"}


@pytest.mark.asyncio
async def test_create_payment_intent_core_projects_result() -> None:
    client = RecordingClient(
        {
            "create_payment_intent": {
                "id": "pi_1",
                "processorPaymentId": "pi_1",
                "clientSecret": "sec",
                "publishableKey": "pk_test",
            }
        }
    )
    result = await create_payment_intent_core(
        client, customer_ref="cus_1", plan_ref="pln_1", product_ref="prd_demo"
    )
    assert not (isinstance(result, dict) and result.get("error"))
    assert client.calls[0][0] == "create_payment_intent"


@pytest.mark.asyncio
async def test_activate_plan_core_sends_refs() -> None:
    client = RecordingClient({"activate_plan": {"status": "active"}})
    result = await activate_plan_core(
        client, customer_ref="cus_1", product_ref="prd_demo", plan_ref="pln_free"
    )
    assert result == {"status": "active"}
    assert client.calls[0][1] == {
        "productRef": "prd_demo",
        "planRef": "pln_free",
        "customerRef": "cus_1",
    }


@pytest.mark.asyncio
async def test_cancel_purchase_core_sleeps_for_eventual_consistency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    slept: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    monkeypatch.setattr("solvapay_mcp.server.helpers.asyncio.sleep", fake_sleep)
    client = RecordingClient({"cancel_purchase": {"reference": "pur_1", "status": "cancelled"}})
    await cancel_purchase_core(client, purchase_ref="pur_1")
    assert slept == [0.5]


@pytest.mark.asyncio
async def test_reactivate_purchase_core_sleeps_for_eventual_consistency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    slept: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    monkeypatch.setattr("solvapay_mcp.server.helpers.asyncio.sleep", fake_sleep)
    client = RecordingClient({"reactivate_purchase": {"reference": "pur_1", "status": "active"}})
    await reactivate_purchase_core(client, purchase_ref="pur_1")
    assert slept == [0.5]


@pytest.mark.asyncio
async def test_invoke_prefers_blocking_twin_off_the_event_loop() -> None:
    from solvapay_mcp.server.helpers import _invoke

    class BlockingTwin:
        def get_merchant_blocking(self, args_json: str) -> str:
            _ = json.loads(args_json)
            return json.dumps({"ok": True, "value": {"displayName": "Acme"}})

    result = await _invoke(BlockingTwin(), "get_merchant", {})
    assert result == {"displayName": "Acme"}
