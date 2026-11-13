from __future__ import annotations

import json

import httpx
import pytest
import respx

from solvapay import ApiClient, AsyncApiClient, SolvaPayError
from solvapay._generated import models

BASE = "https://api.test"
MERCHANT = {"displayName": "Acme", "legalName": "Acme Ltd"}


def client(**kw: object) -> AsyncApiClient:
    return AsyncApiClient(api_key="sk_sandbox_test", api_base_url=BASE, **kw)  # type: ignore[arg-type]


@respx.mock
async def test_sends_auth_and_parses_the_response() -> None:
    route = respx.get(f"{BASE}/v1/sdk/customers/cus_1").respond(
        200, json={"reference": "cus_1", "email": "a@example.com", "name": "A"}
    )
    async with client() as api:
        customer = await api.get_customer(reference="cus_1")
    request = route.calls.last.request
    assert request.headers["authorization"] == "Bearer sk_sandbox_test"
    assert request.headers["user-agent"].startswith("solvapay-python/")
    assert customer.reference == "cus_1"


@respx.mock
async def test_path_parameters_are_encoded() -> None:
    route = respx.get(f"{BASE}/v1/sdk/customers/a%2F..%2Fb").respond(
        200, json={"reference": "x", "email": "a@example.com", "name": "A"}
    )
    async with client() as api:
        await api.get_customer(reference="a/../b")
    assert route.called


async def test_an_empty_path_parameter_fails() -> None:
    async with client() as api:
        with pytest.raises(SolvaPayError) as caught:
            await api.get_customer(reference="")
    assert caught.value.code == "invalid_argument"


@respx.mock
async def test_body_uses_wire_names_and_keeps_explicit_nulls() -> None:
    route = respx.post(f"{BASE}/v1/sdk/agent/calls/call_1/complete").respond(
        200,
        json={
            "callRef": "call_1",
            "settled": False,
            "source": "none",
            "amount": {"amount": "0", "currency": "USD"},
            "duplicate": False,
        },
    )
    async with client() as api:
        result = await api.complete_agent_call(
            call_ref="call_1", body=models.CompleteCallDto(status=500, cost=None)
        )
    assert json.loads(route.calls.last.request.content) == {"status": 500, "cost": None}
    assert result.settled is False


@respx.mock
async def test_query_booleans_and_unset_values() -> None:
    route = respx.get(f"{BASE}/v1/sdk/purchases").respond(200, json={"purchases": []})
    async with client() as api:
        await api.list_purchases(customer_ref="cus_1", include_free=True)
    params = dict(route.calls.last.request.url.params)
    assert params == {"customerRef": "cus_1", "includeFree": "true"}


@respx.mock
async def test_api_error_carries_status_and_code() -> None:
    respx.get(f"{BASE}/v1/sdk/merchant").respond(
        403,
        json={
            "code": "KEY_ENV_MISMATCH",
            "message": "Live key, sandbox merchant",
            "statusCode": 403,
        },
    )
    async with client() as api:
        with pytest.raises(SolvaPayError) as caught:
            await api.get_merchant()
    assert (caught.value.status, caught.value.code) == (403, "KEY_ENV_MISMATCH")
    assert caught.value.message == "Live key, sandbox merchant"


@respx.mock
async def test_api_error_without_code_is_coded_by_status() -> None:
    respx.get(f"{BASE}/v1/sdk/merchant").respond(
        400, json={"message": ["a is required", "b is required"], "statusCode": 400}
    )
    async with client() as api:
        with pytest.raises(SolvaPayError) as caught:
            await api.get_merchant()
    assert caught.value.code == "http_400"
    assert caught.value.message == "a is required; b is required"


@respx.mock
async def test_api_error_code_that_is_not_a_string_is_coded_by_status() -> None:
    # As TypeScript: only a non-empty string is the API's own code.
    respx.get(f"{BASE}/v1/sdk/merchant").respond(409, json={"code": 42, "message": "x"})
    async with client() as api:
        with pytest.raises(SolvaPayError) as caught:
            await api.get_merchant()
    assert caught.value.code == "http_409"


@respx.mock
async def test_non_json_error() -> None:
    respx.get(f"{BASE}/v1/sdk/merchant").respond(502, text="<html>bad gateway</html>")
    async with client(max_retries=0) as api:
        with pytest.raises(SolvaPayError) as caught:
            await api.get_merchant()
    assert (caught.value.status, caught.value.code) == (502, "non_json_response")


@respx.mock
async def test_reads_retry_on_503_then_succeed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("solvapay._http._retry_after", lambda *_: 0)
    route = respx.get(f"{BASE}/v1/sdk/merchant")
    route.side_effect = [
        httpx.Response(503, json={"statusCode": 503}),
        httpx.Response(200, json=MERCHANT),
    ]
    async with client() as api:
        await api.get_merchant()
    assert route.call_count == 2


@respx.mock
async def test_writes_without_idempotency_key_are_not_retried() -> None:
    route = respx.post(f"{BASE}/v1/sdk/usages").respond(503, json={"statusCode": 503})
    async with client() as api:
        with pytest.raises(SolvaPayError):
            await api.record_usage(body={"customerRef": "cus_1"})
    assert route.call_count == 1


@respx.mock
async def test_writes_with_idempotency_key_are_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("solvapay._http._retry_after", lambda *_: 0)
    route = respx.post(f"{BASE}/v1/sdk/customers/cus_1/credits")
    route.side_effect = [
        httpx.Response(503, json={"statusCode": 503}),
        httpx.Response(
            200, json={"success": True, "customerRef": "cus_1", "credits": 1, "balance": 1}
        ),
    ]
    async with client() as api:
        await api.grant_credits(reference="cus_1", body={"amount": 1}, idempotency_key="k1")
    assert route.call_count == 2
    assert route.calls.last.request.headers["idempotency-key"] == "k1"


@respx.mock
async def test_an_unreadable_response_fails_loudly() -> None:
    respx.get(f"{BASE}/v1/sdk/customers/cus_1").respond(200, json={"unexpected": True})
    async with client() as api:
        with pytest.raises(SolvaPayError) as caught:
            await api.get_customer(reference="cus_1")
    assert caught.value.code == "invalid_response"


def test_a_secret_key_is_required() -> None:
    with pytest.raises(SolvaPayError) as caught:
        ApiClient(api_key="")
    assert caught.value.code == "missing_secret"


@respx.mock
def test_blocking_client() -> None:
    respx.get(f"{BASE}/v1/sdk/merchant").respond(200, json=MERCHANT)
    with ApiClient(api_key="sk_sandbox_test", api_base_url=BASE) as api:
        merchant = api.get_merchant()
    assert merchant.display_name == "Acme"
