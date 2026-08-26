from __future__ import annotations

import time

import pytest
from solvapay.facade import create_solvapay
from tests.server.recording_client import RecordingClient

from solvapay_mcp.server.bootstrap import BootstrapLookupError, create_build_bootstrap_payload
from solvapay_mcp.server.helpers import enrich_purchase


def _solvapay(client: RecordingClient) -> object:
    return create_solvapay(api_client=client)


@pytest.mark.asyncio
async def test_bootstrap_fetches_in_parallel() -> None:
    client = RecordingClient(
        {
            "get_platform_config": {"stripePublishableKey": "pk_test"},
            "get_merchant": {"displayName": "Acme"},
            "get_product": {"reference": "prd_demo", "name": "Demo"},
            "list_plans": [{"reference": "pln_1"}],
            "get_customer": {"customerRef": "cus_1", "purchases": []},
            "get_payment_method": {"brand": "visa"},
            "get_customer_balance": {"credits": 10},
            "check_limits": {"withinLimits": True, "remaining": 3, "meterName": "requests"},
        },
        delay=0.05,
    )
    build = create_build_bootstrap_payload(
        solvapay=_solvapay(client),
        product_ref="prd_demo",
        public_base_url="https://mcp.example",
        get_customer_ref=lambda: "cus_1",
    )
    started = time.perf_counter()
    payload = await build("account")
    elapsed = time.perf_counter() - started
    assert elapsed < 0.2
    assert payload["view"] == "account"
    assert payload["merchant"]["displayName"] == "Acme"
    assert payload["customer"]["ref"] == "cus_1"


@pytest.mark.asyncio
async def test_merchant_404_raises_recovery_message() -> None:
    client = RecordingClient(
        {
            "get_merchant": {"error": "not found", "status": 404},
            "get_product": {"reference": "prd_demo"},
            "get_platform_config": {},
            "list_plans": [],
        }
    )
    build = create_build_bootstrap_payload(
        solvapay=_solvapay(client),
        product_ref="prd_demo",
        public_base_url="https://mcp.example",
        get_customer_ref=lambda: None,
    )
    with pytest.raises(BootstrapLookupError) as exc:
        await build("account")
    assert "npx solvapay init" in str(exc.value)
    assert exc.value.status == 404


@pytest.mark.asyncio
async def test_product_failure_raises() -> None:
    client = RecordingClient(
        {
            "get_merchant": {"displayName": "Acme"},
            "get_product": {"error": "missing", "status": 404},
            "get_platform_config": {},
            "list_plans": [],
        }
    )
    build = create_build_bootstrap_payload(
        solvapay=_solvapay(client),
        product_ref="prd_demo",
        public_base_url="https://mcp.example",
        get_customer_ref=lambda: None,
    )
    with pytest.raises(BootstrapLookupError) as exc:
        await build("checkout")
    assert "product lookup failed" in str(exc.value)


@pytest.mark.asyncio
async def test_plans_failure_degrades_to_empty_list() -> None:
    client = RecordingClient(
        {
            "get_merchant": {"displayName": "Acme"},
            "get_product": {"reference": "prd_demo", "name": "Demo"},
            "get_platform_config": {},
            "list_plans": {"error": "boom", "status": 500},
        }
    )
    build = create_build_bootstrap_payload(
        solvapay=_solvapay(client),
        product_ref="prd_demo",
        public_base_url="https://mcp.example",
        get_customer_ref=lambda: None,
    )
    payload = await build("upgrade")
    assert payload["plans"] == []


@pytest.mark.asyncio
async def test_unauthenticated_customer_reads_are_null() -> None:
    client = RecordingClient(
        {
            "get_merchant": {"displayName": "Acme"},
            "get_product": {"reference": "prd_demo", "name": "Demo"},
            "get_platform_config": {"stripePublishableKey": "pk"},
            "list_plans": [],
        }
    )
    build = create_build_bootstrap_payload(
        solvapay=_solvapay(client),
        product_ref="prd_demo",
        public_base_url="https://mcp.example",
        get_customer_ref=lambda: None,
    )
    payload = await build("account")
    assert payload["customer"] is None
    methods = [name for name, _ in client.calls]
    assert "get_customer" not in methods
    assert "get_payment_method" not in methods
    assert "get_customer_balance" not in methods


def test_enrich_purchase_adds_price_display() -> None:
    enriched = enrich_purchase({"amount": 5000, "currency": "USD", "originalAmount": 5000})
    assert enriched["priceDisplay"] == "$50.00"
