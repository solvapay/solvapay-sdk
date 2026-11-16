from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest
import respx

from solvapay import (
    AsyncApiClient,
    FreeLimit,
    PaywallError,
    SolvaPayError,
    create_solvapay,
)
from solvapay.paywall.decide import Paywall

BASE = "https://api.test"
CUSTOMER = {"reference": "cus_1", "email": "u@example.com", "name": "U"}


def paywall(**kw: Any) -> Paywall:
    return Paywall(AsyncApiClient(api_key="sk_sandbox_test", api_base_url=BASE), **kw)


def limits(**fields: Any) -> dict[str, Any]:
    return {"withinLimits": True, "remaining": 5, "meterName": "requests", **fields}


def usage_bodies(route: respx.Route) -> list[dict[str, Any]]:
    return [json.loads(call.request.content) for call in route.calls]


# Customers -----------------------------------------------------------------


@respx.mock
async def test_finds_an_existing_customer_by_external_ref() -> None:
    lookup = respx.get(f"{BASE}/v1/sdk/customers").respond(200, json=CUSTOMER)
    pw = paywall()
    assert await pw.ensure_customer("user_1", "user_1") == "cus_1"
    assert lookup.calls.last.request.url.params["externalRef"] == "user_1"
    # Cached on the instance: no second lookup.
    assert await pw.ensure_customer("user_1", "user_1") == "cus_1"
    assert lookup.call_count == 1


@respx.mock
async def test_creates_the_customer_when_none_exists() -> None:
    respx.get(f"{BASE}/v1/sdk/customers").respond(404, json={"statusCode": 404})
    create = respx.post(f"{BASE}/v1/sdk/customers").respond(201, json=CUSTOMER)
    assert await paywall().ensure_customer("user_1", "user_1", email="u@example.com") == "cus_1"
    body = json.loads(create.calls.last.request.content)
    assert body == {"email": "u@example.com", "externalRef": "user_1", "metadata": {}}


@respx.mock
async def test_a_generated_email_when_none_is_given() -> None:
    respx.get(f"{BASE}/v1/sdk/customers").respond(404, json={"statusCode": 404})
    create = respx.post(f"{BASE}/v1/sdk/customers").respond(201, json=CUSTOMER)
    await paywall().ensure_customer("user_1", "user_1")
    email = json.loads(create.calls.last.request.content)["email"]
    assert email.startswith("user_1-") and email.endswith("@auto-created.local")


@respx.mock
async def test_a_conflict_resolves_by_external_ref() -> None:
    lookup = respx.get(f"{BASE}/v1/sdk/customers")
    lookup.side_effect = [
        httpx.Response(404, json={"statusCode": 404}),
        httpx.Response(200, json=CUSTOMER),
    ]
    respx.post(f"{BASE}/v1/sdk/customers").respond(409, json={"statusCode": 409, "message": "x"})
    assert await paywall().ensure_customer("user_1", "user_1") == "cus_1"


@respx.mock
async def test_an_unresolvable_conflict_fails() -> None:
    respx.get(f"{BASE}/v1/sdk/customers").respond(404, json={"statusCode": 404})
    respx.post(f"{BASE}/v1/sdk/customers").respond(
        409, json={"statusCode": 409, "message": "Customer with email exists"}
    )
    with pytest.raises(SolvaPayError) as caught:
        await paywall().ensure_customer("user_1", "user_1")
    assert caught.value.code == "customer_conflict"


@respx.mock
async def test_a_lookup_error_other_than_404_fails() -> None:
    respx.get(f"{BASE}/v1/sdk/customers").respond(500, json={"statusCode": 500})
    with pytest.raises(SolvaPayError) as caught:
        await paywall().ensure_customer("user_1", "user_1")
    assert caught.value.status == 500


@respx.mock
async def test_concurrent_lookups_share_one_request() -> None:
    lookup = respx.get(f"{BASE}/v1/sdk/customers").respond(200, json=CUSTOMER)
    pw = paywall()
    refs = await asyncio.gather(*(pw.ensure_customer("user_1", "user_1") for _ in range(5)))
    assert refs == ["cus_1"] * 5
    assert lookup.call_count == 1


async def test_cus_and_anonymous_refs_pass_through() -> None:
    pw = paywall()
    assert await pw.ensure_customer("cus_9") == "cus_9"
    assert await pw.ensure_customer("anonymous") == "anonymous"


# Decide --------------------------------------------------------------------


@respx.mock
async def test_allow_then_serve_from_cache_until_the_units_run_out() -> None:
    check = respx.post(f"{BASE}/v1/sdk/limits").respond(200, json=limits(remaining=2))
    usage = respx.post(f"{BASE}/v1/sdk/usages").respond(200, json={"success": True})
    pw = paywall()
    first = await pw.decide(customer_ref="cus_1", product="prd_1")
    second = await pw.decide(customer_ref="cus_1", product="prd_1")
    assert (first.outcome, second.outcome) == ("allow", "allow")
    assert check.call_count == 1
    body = json.loads(check.calls.last.request.content)
    assert body == {
        "customerRef": "cus_1",
        "productRef": "prd_1",
        "meterName": "requests",
        "includeCheckoutSession": True,
    }
    # Two units claimed: the third call re-checks.
    await pw.decide(customer_ref="cus_1", product="prd_1")
    assert check.call_count == 2
    assert not usage.called


@respx.mock
async def test_concurrent_callers_each_claim_a_unit() -> None:
    respx.post(f"{BASE}/v1/sdk/limits").respond(200, json=limits(remaining=2))
    respx.post(f"{BASE}/v1/sdk/usages").respond(200, json={"success": True})
    pw = paywall()
    decisions = await asyncio.gather(
        *(pw.decide(customer_ref="cus_1", product="prd_1") for _ in range(3))
    )
    assert sorted(d.outcome for d in decisions) == ["allow", "allow", "gate"]


@respx.mock
async def test_unlimited_and_overage_are_allowed() -> None:
    respx.post(f"{BASE}/v1/sdk/limits").respond(200, json=limits(remaining=-1))
    assert (await paywall().decide(customer_ref="cus_1", product="prd_1")).allowed

    respx.post(f"{BASE}/v1/sdk/limits").respond(200, json=limits(remaining=0, overage=True))
    decision = await paywall().decide(customer_ref="cus_1", product="prd_2")
    assert decision.allowed and decision.consequence == "overage"


@respx.mock
async def test_a_gate_builds_the_paywall_and_records_a_paywall_event() -> None:
    respx.post(f"{BASE}/v1/sdk/limits").respond(
        200,
        json={
            "withinLimits": False,
            "remaining": 0,
            "meterName": "requests",
            "checkoutUrl": "https://pay.test/c",
        },
    )
    usage = respx.post(f"{BASE}/v1/sdk/usages").respond(200, json={"success": True})
    decision = await paywall().decide(customer_ref="cus_1", product="prd_1", tool_name="search")
    assert decision.outcome == "gate"
    assert decision.gate is not None
    assert decision.gate["kind"] == "payment_required"
    assert "[Open checkout](https://pay.test/c)" in decision.gate["message"]
    [body] = usage_bodies(usage)
    assert body["outcome"] == "paywall"
    assert body["idempotencyKey"] == f"{decision.request_id}:paywall"
    assert body["metadata"] == {
        "action": "requests",
        "requestId": decision.request_id,
        "toolName": "search",
    }


async def test_a_free_limit_needs_an_identity() -> None:
    free = FreeLimit(meter="free-requests", cap=3, scope="lifetime")
    with pytest.raises(SolvaPayError) as caught:
        await paywall().decide(customer_ref="anonymous", product="prd_1", free_limit=free)
    assert (caught.value.code, caught.value.status) == ("identity_required", 401)


@respx.mock
async def test_a_free_limit_is_sent_as_the_free_allowance() -> None:
    check = respx.post(f"{BASE}/v1/sdk/limits").respond(200, json=limits())
    free = FreeLimit(meter="free-search", cap=5, scope="rolling_window", window_days=30)
    await paywall().decide(customer_ref="cus_1", product="prd_1", free_limit=free)
    body = json.loads(check.calls.last.request.content)
    assert body["meterName"] == "free-search"
    assert body["freeAllowance"] == {
        "meter": "free-search",
        "cap": 5,
        "scope": "rolling_window",
        "windowDays": 30,
    }


def test_free_limit_validation() -> None:
    with pytest.raises(SolvaPayError):
        FreeLimit(meter="search", cap=1, scope="lifetime")
    with pytest.raises(SolvaPayError):
        FreeLimit(meter="free-search", cap=1, scope="rolling_window")


# Run and track ---------------------------------------------------------------


@respx.mock
async def test_run_allow_records_success_with_its_usage_class() -> None:
    respx.post(f"{BASE}/v1/sdk/limits").respond(200, json=limits())
    usage = respx.post(f"{BASE}/v1/sdk/usages").respond(200, json={"success": True})
    pw = paywall()
    decision = await pw.decide(customer_ref="cus_1", product="prd_1")

    async def handler() -> str:
        return "done"

    assert await pw.run_allow(decision, handler, product="prd_1") == "done"
    [body] = usage_bodies(usage)
    assert body["outcome"] == "success"
    assert body["metadata"]["usageClass"] == "included"


@respx.mock
async def test_run_allow_records_fail_and_reraises() -> None:
    respx.post(f"{BASE}/v1/sdk/limits").respond(200, json=limits())
    usage = respx.post(f"{BASE}/v1/sdk/usages").respond(200, json={"success": True})
    pw = paywall()
    decision = await pw.decide(customer_ref="cus_1", product="prd_1")

    async def handler() -> str:
        raise RuntimeError("upstream down")

    with pytest.raises(RuntimeError):
        await pw.run_allow(decision, handler, product="prd_1")
    assert usage_bodies(usage)[0]["outcome"] == "fail"


@respx.mock
async def test_a_tracking_failure_is_logged_not_raised(caplog: pytest.LogCaptureFixture) -> None:
    respx.post(f"{BASE}/v1/sdk/usages").respond(500, json={"statusCode": 500})
    await paywall().track_usage(
        customer_ref="cus_1",
        product="prd_1",
        action="requests",
        outcome="success",
        request_id="r1",
        duration_ms=1,
    )
    assert "usage tracking failed" in caplog.text


# The facade ----------------------------------------------------------------


@respx.mock
async def test_payable_runs_the_handler_or_raises_the_gate() -> None:
    check = respx.post(f"{BASE}/v1/sdk/limits")
    check.side_effect = [
        httpx.Response(200, json=limits(remaining=1)),
        httpx.Response(200, json={"withinLimits": False, "remaining": 0}),
    ]
    respx.post(f"{BASE}/v1/sdk/usages").respond(200, json={"success": True})
    solvapay = create_solvapay(api_key="sk_sandbox_test", api_base_url=BASE, product_ref="prd_1")

    @solvapay.payable()
    async def search(query: str, *, customer_ref: str) -> str:
        return f"results for {query}"

    assert await search("cats", customer_ref="cus_1") == "results for cats"
    with pytest.raises(PaywallError) as caught:
        await search("dogs", customer_ref="cus_1")
    assert caught.value.gate["kind"] == "payment_required"


async def test_payable_needs_a_customer() -> None:
    solvapay = create_solvapay(api_key="sk_sandbox_test", api_base_url=BASE, product_ref="prd_1")

    @solvapay.payable()
    async def search(query: str, *, customer_ref: str = "") -> str:
        return query

    with pytest.raises(SolvaPayError) as caught:
        await search("cats")
    assert caught.value.code == "identity_required"


def test_create_solvapay_reads_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOLVAPAY_SECRET_KEY", "sk_sandbox_env")
    monkeypatch.setenv("SOLVAPAY_API_BASE_URL", "https://api.example.test")
    monkeypatch.setenv("SOLVAPAY_PRODUCT_REF", "prd_env")
    solvapay = create_solvapay()
    assert solvapay.api.api_base_url == "https://api.example.test"
    assert solvapay.require_product(None) == "prd_env"


def test_create_solvapay_needs_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SOLVAPAY_SECRET_KEY", raising=False)
    with pytest.raises(SolvaPayError) as caught:
        create_solvapay()
    assert caught.value.code == "missing_secret"
