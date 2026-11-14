"""solvapay.web.routes beyond the web-routes conformance cases: identity comes only from
the merchant's hook, paths and mounting, and the inputs the cases don't cover."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.routing import Mount

from solvapay import SolvaPayError, create_solvapay
from solvapay.web import SOLVAPAY_ROUTES, User, routes

API = "https://api.test"
APP = "https://app.test"
ADA = User(id="user_1", email="ada@example.com", name="Ada")
CUSTOMER = {
    "reference": "cus_1",
    "externalRef": "user_1",
    "email": "ada@example.com",
    "name": "Ada",
}


def solvapay() -> Any:
    return create_solvapay(api_key="sk_sandbox_test", api_base_url=API, max_retries=0)


async def as_user(_request: Request) -> User | None:
    return ADA


async def nobody(_request: Request) -> User | None:
    return None


async def send(app: Any, method: str, path: str, **kwargs: Any) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=APP) as client:
        return await client.request(method, path, **kwargs)


def test_get_user_is_required() -> None:
    with pytest.raises(TypeError):
        routes(solvapay())  # type: ignore[call-arg]
    with pytest.raises(SolvaPayError) as raised:
        routes(solvapay(), get_user=None)  # type: ignore[arg-type]
    assert raised.value.code == "invalid_argument"


def test_serves_every_route_react_calls() -> None:
    assert len(SOLVAPAY_ROUTES) == 22
    assert list(SOLVAPAY_ROUTES["auto-recharge"]) == ["GET", "PUT", "DELETE"]


@respx.mock
async def test_a_client_user_id_header_is_never_identity() -> None:
    app = routes(solvapay(), get_user=nobody)
    response = await send(app, "GET", "/api/check-purchase", headers={"x-user-id": "victim"})
    assert response.status_code == 401
    assert response.json() == {
        "error": "Unauthorized",
        "details": "User ID not found. Ensure middleware is configured.",
    }


@respx.mock
async def test_the_customer_is_the_verified_users_whatever_the_client_says() -> None:
    lookup = respx.get(f"{API}/v1/sdk/customers").respond(200, json=CUSTOMER)
    respx.get(f"{API}/v1/sdk/customers/cus_1/balance").respond(
        200,
        json={
            "customerRef": "cus_1",
            "credits": 500,
            "displayCurrency": "USD",
            "creditsPerMinorUnit": 100,
            "displayExchangeRate": 1,
            "display": {
                "amountMajor": 0.05,
                "currency": "USD",
                "formatted": "$0.05",
                "exchangeRate": 1,
                "rateSource": "parity",
            },
        },
    )
    app = routes(solvapay(), get_user=as_user)
    response = await send(app, "GET", "/api/customer-balance", headers={"x-user-id": "victim"})
    assert response.status_code == 200
    assert lookup.calls.last.request.url.params["externalRef"] == "user_1"


@respx.mock
async def test_a_user_id_like_a_customer_ref_is_still_looked_up() -> None:
    """TypeScript's ensureCustomer uses a ``cus_`` id as the customer itself."""
    lookup = respx.get(f"{API}/v1/sdk/customers").respond(
        200, json={**CUSTOMER, "reference": "cus_9"}
    )

    async def lookalike(_request: Request) -> User:
        return User(id="cus_someone_else")

    response = await send(routes(solvapay(), get_user=lookalike), "POST", "/api/sync-customer")
    assert response.json() == {"customerRef": "cus_9"}
    assert lookup.calls.last.request.url.params["externalRef"] == "cus_someone_else"


@respx.mock
async def test_the_customer_is_remembered_per_user() -> None:
    lookup = respx.get(f"{API}/v1/sdk/customers").respond(200, json=CUSTOMER)
    app = routes(solvapay(), get_user=as_user)
    for _ in range(2):
        assert (await send(app, "POST", "/api/sync-customer")).json() == {"customerRef": "cus_1"}
    assert lookup.call_count == 1


@respx.mock
async def test_a_sync_identity_hook_works_too() -> None:
    respx.get(f"{API}/v1/sdk/customers").respond(200, json=CUSTOMER)
    app = routes(solvapay(), get_user=lambda _request: ADA)
    assert (await send(app, "POST", "/api/sync-customer")).status_code == 200


async def test_an_identity_hook_answering_something_else_fails_loudly() -> None:
    app = routes(solvapay(), get_user=lambda _request: {"id": "user_1"})  # type: ignore[arg-type,return-value]
    with pytest.raises(TypeError):
        await send(app, "POST", "/api/sync-customer")


@respx.mock
async def test_base_path_moves_the_routes() -> None:
    respx.get(f"{API}/v1/sdk/merchant").respond(200, json={"displayName": "Acme"})
    app = routes(solvapay(), get_user=as_user, base_path="/billing/")
    assert (await send(app, "GET", "/billing/merchant")).json() == {"displayName": "Acme"}
    assert (await send(app, "GET", "/api/merchant")).status_code == 404


@respx.mock
async def test_mounted_below_a_prefix() -> None:
    respx.get(f"{API}/v1/sdk/merchant").respond(200, json={"displayName": "Acme"})
    app = Starlette(routes=[Mount("/api", app=routes(solvapay(), get_user=as_user, base_path=""))])
    assert (await send(app, "GET", "/api/merchant")).json() == {"displayName": "Acme"}
    missing = await send(app, "GET", "/api/nothing")
    assert missing.status_code == 404
    assert missing.json() == {"error": "Not found"}


async def test_a_body_that_is_not_json_is_refused() -> None:
    app = routes(solvapay(), get_user=as_user)
    response = await send(app, "POST", "/api/activate-plan", content=b"{not json")
    assert response.status_code == 400
    assert response.json()["error"] == "Invalid JSON body"


@respx.mock
async def test_auto_recharge_is_saved_on_the_users_own_customer() -> None:
    respx.get(f"{API}/v1/sdk/customers").respond(200, json=CUSTOMER)
    save = respx.put(f"{API}/v1/sdk/auto-recharge").respond(200, json={"enabled": True})
    app = routes(solvapay(), get_user=as_user)
    await send(
        app, "PUT", "/api/auto-recharge", json={"enabled": True, "customerRef": "cus_victim"}
    )
    assert json.loads(save.calls.last.request.content)["customerRef"] == "cus_1"


@respx.mock
async def test_a_failed_customer_read_is_an_error_not_an_empty_account() -> None:
    """TypeScript's checkPurchaseCore answers ``{customerRef: userId, purchases: []}``."""
    respx.get(f"{API}/v1/sdk/customers").respond(200, json=CUSTOMER)
    respx.get(f"{API}/v1/sdk/customers/cus_1").respond(503, json={"message": "Unavailable"})
    response = await send(routes(solvapay(), get_user=as_user), "GET", "/api/check-purchase")
    assert response.status_code == 503
    assert response.json()["error"] == 'Get customer failed (503): {"message":"Unavailable"}'
