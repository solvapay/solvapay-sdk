"""``routes()``: every route ``@solvapay/react`` calls, as one ASGI app.

A port of TypeScript's ``solvapayRoutes()`` (``packages/server/src/fetch``) and the
``*Core`` helpers under it (``packages/server/src/helpers``): the same paths, the
same SolvaPay API requests in the same order, and the same answers, status and
error strings included. ``conformance/cases/web-routes`` checks them.

Identity comes only from the merchant's ``get_user`` hook: the merchant verifies
the request with their own auth there. Nothing the client sends is identity (an
``x-user-id`` header is ignored), and a request without a user is refused with
401 before SolvaPay is called. ``merchant``, ``get-product`` and ``list-plans``
answer without a user, as in TypeScript: they read the merchant's public catalog.

Where TypeScript swallows an error and answers as if nothing failed, these routes
fail loudly instead (see "Known divergences" in ``conformance/README.md``).
"""

from __future__ import annotations

import asyncio
import inspect
import json
import secrets
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, TypeGuard, TypeVar

try:
    from starlette.requests import Request
    from starlette.responses import JSONResponse, Response
    from starlette.types import Receive, Scope, Send
except ImportError as error:  # pragma: no cover - depends on the install
    raise ImportError("solvapay.web needs Starlette: pip install 'solvapay[web]'") from error

from pydantic import BaseModel

from .._generated.models import CustomerBalanceResponse, CustomerResponse, SdkPurchaseResponse
from .._http import path_segment
from .._js import js_round
from ..client import AsyncApiClient
from ..errors import SolvaPayError
from ..pricing import counts_usage
from ..solvapay import SolvaPay

Json = dict[str, Any]
M = TypeVar("M", bound=BaseModel)

__all__ = ["SOLVAPAY_ROUTES", "GetUser", "SolvaPayRoutes", "User", "routes"]


@dataclass(frozen=True)
class User:
    """The person the merchant's own auth verified: ``id`` is your user id, which
    SolvaPay stores as the customer's ``externalRef``."""

    id: str
    email: str | None = None
    name: str | None = None


GetUser = Callable[[Request], Awaitable[User | None] | User | None]
"""Verifies a request with the merchant's own auth: the signed-in ``User``, or None."""

UNAUTHORIZED_DETAILS = "User ID not found. Ensure middleware is configured."
"""TypeScript's 401 details for a request without a verified user."""

API_ERROR_BODY_MAX = 240
"""How much of an API error's body the message carries, as TypeScript's client."""

SETTLE_SECONDS = 0.5
"""How long cancel and reactivate wait after the API answers, as TypeScript's
``cancelPurchaseCore`` and ``reactivatePurchaseCore`` do, so the next read sees it."""

TOPUP_BALANCE_POLL_DELAYS = (0.5, 1.0, 2.0, 4.0)
"""TypeScript's ``TOPUP_BALANCE_POLL_DELAYS_MS``: when to look for a top-up's credits."""


class _Refusal(Exception):
    """An answer other than 200: TypeScript's ``ErrorResult``."""

    def __init__(self, error: str, status: int, details: str | None = None) -> None:
        super().__init__(error)
        self.error = error
        self.status = status
        self.details = details


def _error_response(error: str, status: int, details: str | None = None) -> JSONResponse:
    # TypeScript's errorResponse: ``details`` only when it says something.
    body: Json = {"error": error, **({"details": details} if details else {})}
    return _json(body, status)


def _json(data: Any, status: int = 200) -> JSONResponse:
    return _JsJsonResponse(data, status_code=status)


class _JsJsonResponse(JSONResponse):
    """``JSON.stringify``: compact, and non-ASCII characters as they are."""

    def render(self, content: Any) -> bytes:
        return json.dumps(
            content, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")


# ---- the API, as TypeScript's client reads it ---------------------------------


def _api_detail(error: SolvaPayError) -> str:
    """What TypeScript's client puts after the colon: the response body, cut at 240."""
    if error.code == "non_json_response":
        return f"non-JSON response — the API may not have been reached. Body: {error.body}"
    # Python keeps the parsed body; written back compactly it is the body the API sent.
    text = json.dumps(error.body, ensure_ascii=False, separators=(",", ":"))
    return f"{text[:API_ERROR_BODY_MAX]}…" if len(text) > API_ERROR_BODY_MAX else text


def _api_failure(operation: str, error: SolvaPayError) -> SolvaPayError:
    """An API failure with TypeScript's message, ``"<Operation> failed (<status>): <body>"``:
    the routes answer React with the message, and the web-routes cases compare it."""
    if error.status is None:  # never reached the API: the message says why
        return error
    return SolvaPayError(
        f"{operation} failed ({error.status}): {_api_detail(error)}",
        code=error.code,
        status=error.status,
        body=error.body,
    )


def _invalid(what: str, value: Any) -> SolvaPayError:
    return SolvaPayError(
        f"The SolvaPay API answered {what} with something this SDK cannot read: {value!r}",
        code="invalid_response",
    )


def _dump(model: BaseModel) -> Json:
    """A model as the API sent it: wire names, only the fields it had."""
    dumped: Json = model.model_dump(mode="json", by_alias=True, exclude_unset=True)
    return dumped


def _idempotency_key(prefix: str) -> str:
    return f"{prefix}-{int(time.time() * 1000)}-{secrets.token_hex(5)[:9]}"


def _number(value: Any) -> TypeGuard[int | float]:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _js_number(value: float) -> int | float:
    """A computed number as JavaScript writes it: 30.0 is 30."""
    return int(value) if float(value).is_integer() else value


class _Api:
    """The SolvaPay requests the routes make, each named as TypeScript's client names it."""

    def __init__(self, client: AsyncApiClient) -> None:
        self._client = client

    async def call(
        self,
        operation: str,
        method: str,
        path: str,
        *,
        query: Mapping[str, Any] | None = None,
        body: Any = None,
        idempotency_key: str | None = None,
    ) -> Any:
        try:
            return await self._client.request_json(
                method,
                path,
                query=query,
                headers={"Idempotency-Key": idempotency_key} if idempotency_key else None,
                body=body,
            )
        except SolvaPayError as error:
            raise _api_failure(operation, error) from error

    async def typed(self, operation: str, request: Awaitable[M]) -> M:
        """A generated method's answer, its API failure named as TypeScript names it."""
        try:
            return await request
        except SolvaPayError as error:
            raise _api_failure(operation, error) from error

    @property
    def client(self) -> AsyncApiClient:
        return self._client

    async def get_customer(self, customer_ref: str) -> CustomerResponse:
        return await self.typed("Get customer", self._client.get_customer(reference=customer_ref))

    async def balance(self, customer_ref: str) -> CustomerBalanceResponse:
        return await self.typed(
            "Get customer balance", self._client.get_customer_balance(reference=customer_ref)
        )

    async def purchase(self, purchase_ref: str) -> SdkPurchaseResponse:
        """``GET /v1/sdk/purchases/{ref}``; a 404 is "Purchase not found", as TypeScript says."""
        try:
            return await self._client.get_purchase(purchase_ref=purchase_ref)
        except SolvaPayError as error:
            if error.status == 404:
                raise SolvaPayError(
                    f"Purchase not found: {_api_detail(error)}",
                    code=error.code,
                    status=404,
                    body=error.body,
                ) from error
            raise _api_failure("Get purchase", error) from error

    async def cancel(self, purchase_ref: str, reason: str | None) -> Any:
        """``POST /v1/sdk/purchases/{ref}/cancel``, its 404 and 400 named as TypeScript's
        client names them."""
        try:
            return await self._client.request_json(
                "POST",
                f"/v1/sdk/purchases/{path_segment(purchase_ref)}/cancel",
                body={"reason": reason} if reason else {},
            )
        except SolvaPayError as error:
            named = {
                404: "Purchase not found",
                400: "Purchase cannot be cancelled or does not belong to provider",
            }.get(error.status or 0)
            if named is None:
                raise _api_failure("Cancel purchase", error) from error
            raise SolvaPayError(
                f"{named}: {_api_detail(error)}",
                code=error.code,
                status=error.status,
                body=error.body,
            ) from error


# ---- routes ---------------------------------------------------------------------


class _Call:
    """One request to a route: its user, customer and body, each read once."""

    def __init__(self, routes: SolvaPayRoutes, request: Request) -> None:
        self.routes = routes
        self.request = request
        self.api = routes.api
        self._user: User | None = None

    @property
    def query(self) -> Mapping[str, str]:
        return self.request.query_params

    async def user(self) -> User:
        if self._user is None:
            found = self.routes.get_user(self.request)
            if inspect.isawaitable(found):
                found = await found
            if found is None:
                raise _Refusal("Unauthorized", 401, UNAUTHORIZED_DETAILS)
            if not isinstance(found, User) or not isinstance(found.id, str) or not found.id:
                raise TypeError(
                    f"get_user must answer a solvapay.web.User with an id, or None: {found!r}"
                )
            self._user = found
        return self._user

    async def customer_ref(self) -> str:
        """TypeScript's ``syncCustomerCore``: the verified user's customer, found by their id
        as ``externalRef``, created with their email and name on first use."""
        return await self.routes.ensure_customer(await self.user())

    async def body(self) -> Json:
        raw = await self.request.body()
        # A route that takes no body may be sent none.
        if not raw.strip():
            return {}
        try:
            body = json.loads(raw)
        except ValueError as error:
            raise _Refusal("Invalid JSON body", 400, str(error)) from error
        if not isinstance(body, dict):
            raise _Refusal("Invalid JSON body", 400, "The body must be a JSON object")
        return body


Handler = Callable[[_Call], Awaitable[Any]]


def _text(value: Any) -> str | None:
    """A string field, or None when it is missing, empty or not a string (JavaScript's falsy)."""
    return value if isinstance(value, str) and value else None


def _present(source: Mapping[str, Any], *keys: str) -> Json:
    """The keys ``source`` has, as ``JSON.stringify`` of ``{ key: source.key }`` writes them:
    a missing key drops out, a null stays."""
    return {key: source[key] for key in keys if key in source}


def _active(purchases: Any) -> list[Any]:
    return [p for p in purchases or [] if isinstance(p, dict) and p.get("status") == "active"]


def _purchase_check(customer: CustomerResponse) -> Json:
    dumped = _dump(customer)
    return {
        "customerRef": customer.reference,
        **_present(dumped, "email", "name"),
        "purchases": _active(dumped.get("purchases")),
    }


async def check_purchase(call: _Call) -> Json:
    """``checkPurchaseCore``: the user's customer and their active purchases."""
    user = await call.user()
    cached = call.request.headers.get("x-solvapay-customer-ref")
    if cached:
        # A ref the client cached is only a hint: used when that customer is this user's.
        try:
            customer: CustomerResponse | None = await call.api.get_customer(cached)
        except SolvaPayError as error:
            if error.status != 404:
                raise
            customer = None  # a stale ref: look the user up instead
        if customer is not None and customer.external_ref == user.id:
            return _purchase_check(customer)
    customer = await call.api.get_customer(await call.customer_ref())
    return _purchase_check(customer)


async def sync_customer(call: _Call) -> Json:
    return {"customerRef": await call.customer_ref()}


async def customer_balance(call: _Call) -> Json:
    return _dump(await call.api.balance(await call.customer_ref()))


async def create_payment_intent(call: _Call) -> Json:
    body = await call.body()
    plan_ref, product_ref = _text(body.get("planRef")), _text(body.get("productRef"))
    if not plan_ref or not product_ref:
        raise _Refusal("Missing required parameters: planRef and productRef are required", 400)
    customer_ref = await call.customer_ref()
    request: Json = {"productRef": product_ref, "planRef": plan_ref, "customerRef": customer_ref}
    if _text(body.get("currency")):
        request["currency"] = body["currency"]
    intent = await call.api.call(
        "Create payment intent",
        "POST",
        "/v1/sdk/payment-intents",
        body=request,
        idempotency_key=_idempotency_key(f"payment-{plan_ref}"),
    )
    return _intent_answer(intent, customer_ref)


def _intent_answer(intent: Any, customer_ref: str) -> Json:
    if not isinstance(intent, dict):
        raise _invalid("a payment intent", intent)
    return {
        **_present(intent, "processorPaymentId", "clientSecret", "publishableKey", "accountId"),
        "customerRef": customer_ref,
    }


async def create_topup_payment_intent(call: _Call) -> Json:
    body = await call.body()
    amount = body.get("amount")
    if not _number(amount) or amount <= 0:
        raise _Refusal("Missing or invalid amount: must be a positive number", 400)
    currency = body.get("currency")
    if not currency:
        raise _Refusal("Missing required parameter: currency", 400)
    if not isinstance(currency, str) or currency != currency.upper():
        raise _Refusal(
            f'Invalid currency "{currency}": must be an uppercase ISO 4217 code '
            '(e.g. "USD", "EUR")',
            400,
        )
    customer_ref = await call.customer_ref()
    request: Json = {
        "customerRef": customer_ref,
        "purpose": "credit_topup",
        "amount": amount,
        "currency": currency,
        **_present(body, "description"),
    }
    if body.get("autoRecharge"):
        request["autoRecharge"] = body["autoRecharge"]
    intent = await call.api.call(
        "Create topup payment intent",
        "POST",
        "/v1/sdk/payment-intents",
        body=request,
        idempotency_key=_idempotency_key("topup"),
    )
    return _intent_answer(intent, customer_ref)


async def process_payment(call: _Call) -> Any:
    body = await call.body()
    payment_intent_id = _text(body.get("paymentIntentId"))
    if not payment_intent_id or not _text(body.get("productRef")):
        raise _Refusal("paymentIntentId and productRef are required", 400)
    customer_ref = await call.customer_ref()
    return await call.api.call(
        "Process payment",
        "POST",
        f"/v1/sdk/payment-intents/{path_segment(payment_intent_id)}/process",
        body={
            "productRef": body["productRef"],
            "customerRef": customer_ref,
            **_present(body, "planRef"),
        },
    )


async def process_topup_payment(call: _Call) -> Json:
    """``processTopupPaymentIntentCore``: processes the top-up, then waits for its credits
    so React can show the new balance at once."""
    body = await call.body()
    payment_intent_id = _text(body.get("paymentIntentId"))
    if not payment_intent_id:
        raise _Refusal("paymentIntentId is required", 400)
    customer_ref = await call.customer_ref()
    # The balance before the top-up lands, to measure it against. TypeScript carries on
    # without it when this read fails; here the failure is the answer.
    before = (await call.api.balance(customer_ref)).credits
    result = await call.api.call(
        "Process payment",
        "POST",
        f"/v1/sdk/payment-intents/{path_segment(payment_intent_id)}/process",
        body={"customerRef": customer_ref},
    )
    status = result.get("status") if isinstance(result, dict) else None
    if status == "timeout":
        return {"status": "timeout", **_present(result, "message")}
    if status in ("failed", "cancelled"):
        return {"status": status}
    if status != "succeeded":
        # TypeScript reports an unknown status as "failed"; it is the API's answer that is wrong.
        raise _invalid("a processed payment", result)
    for delay in TOPUP_BALANCE_POLL_DELAYS:
        await asyncio.sleep(delay)
        after = (await call.api.balance(customer_ref)).credits
        if after > before:
            return {"status": "succeeded", "creditsAdded": _js_number(after - before)}
    # The payment succeeded; its credits have not been booked yet. React refetches the
    # balance either way, so this says no more than that (TypeScript's answer).
    return {"status": "succeeded"}


BUSINESS_DETAIL_KEYS = ("isBusiness", "businessName", "country", "taxId", "taxIdType")
"""The details TypeScript's client sends; the web-routes cases pin its request body. (The
widget's ``attach_business_details`` tool also sends the billing fields, see Known divergences.)"""


async def attach_business_details(call: _Call) -> Any:
    from ..business_details import validate_business_details

    body = await call.body()
    payment_intent_id = _text(body.get("paymentIntentId"))
    if not payment_intent_id:
        raise _Refusal("paymentIntentId is required", 400)
    fields = {}
    for key in (
        "businessName",
        "country",
        "customerCountry",
        "customerName",
        "customerState",
        "customerPostalCode",
        "taxId",
    ):
        value = body.get(key)
        if value is not None and not isinstance(value, str):
            raise _Refusal(f"Invalid input: {key} must be a string", 400)
        fields[key] = value
    try:
        details = validate_business_details(
            is_business=body.get("isBusiness") is True,
            business_name=fields["businessName"],
            country=fields["country"],
            customer_country=fields["customerCountry"],
            customer_name=fields["customerName"],
            customer_state=fields["customerState"],
            customer_postal_code=fields["customerPostalCode"],
            tax_id=fields["taxId"],
        )
    except SolvaPayError as error:
        if error.code != "invalid_business_details":
            raise
        raise _Refusal(error.message, 400) from error
    # The details go on the verified user's own customer; a customerRef in the body is
    # never used.
    customer_ref = await call.customer_ref()
    return await call.api.call(
        "Attach business details",
        "POST",
        f"/v1/sdk/payment-intents/{path_segment(payment_intent_id)}/business-details",
        body={**_present(details, *BUSINESS_DETAIL_KEYS), "customerRef": customer_ref},
    )


async def _own_purchase(call: _Call, purchase_ref: str) -> None:
    """``requireOwnPurchase``: renewal acts on a purchase by reference, so it must be the
    verified user's."""
    customer_ref = await call.customer_ref()
    try:
        purchase = await call.api.purchase(purchase_ref)
    except SolvaPayError as error:
        # As TypeScript's cancel and reactivate answer a failed read: by its message.
        if error.status == 404:
            raise _Refusal("Purchase not found", 404, error.message) from error
        raise _Refusal(error.message, 500, error.message) from error
    if purchase.customer_ref != customer_ref:
        raise _Refusal("Forbidden", 403, "This purchase belongs to another customer")


def _renewal_refusal(error: SolvaPayError, refused: str) -> _Refusal:
    # Told apart by status, not message text (Known divergences: set_renewal).
    if error.status == 404:
        return _Refusal("Purchase not found", 404, error.message)
    if error.status == 400:
        return _Refusal(refused, 400, error.message)
    return _Refusal(error.message, 500, error.message)


def _purchase_of(response: Any, endpoint: str) -> Json:
    """The purchase in a cancel or reactivate answer: ``{ purchase }`` or the purchase."""
    if not isinstance(response, dict):
        raise _invalid(endpoint, response)
    purchase = response.get("purchase")
    return purchase if isinstance(purchase, dict) else response


async def cancel_renewal(call: _Call) -> Json:
    body = await call.body()
    purchase_ref = _text(body.get("purchaseRef"))
    if not purchase_ref:
        raise _Refusal("Missing required parameter: purchaseRef is required", 400)
    await _own_purchase(call, purchase_ref)
    reason = _text(body.get("reason"))
    try:
        response = await call.api.cancel(purchase_ref, reason)
    except SolvaPayError as error:
        raise _renewal_refusal(
            error, "Purchase cannot be cancelled or does not belong to provider"
        ) from error
    purchase = _purchase_of(response, "cancel purchase")
    if not purchase.get("reference"):
        raise _Refusal("Cancel purchase response missing required fields", 500)
    if purchase.get("status") != "cancelled" and not purchase.get("cancelledAt"):
        raise _Refusal(
            "Purchase cancellation failed: backend returned status "
            f"'{purchase.get('status')}' without cancelledAt timestamp",
            500,
        )
    await asyncio.sleep(SETTLE_SECONDS)
    return purchase


async def reactivate_renewal(call: _Call) -> Json:
    body = await call.body()
    purchase_ref = _text(body.get("purchaseRef"))
    if not purchase_ref:
        raise _Refusal("Missing required parameter: purchaseRef is required", 400)
    await _own_purchase(call, purchase_ref)
    try:
        response = await call.api.call(
            "Reactivate purchase",
            "POST",
            f"/v1/sdk/purchases/{path_segment(purchase_ref)}/reactivate",
        )
    except SolvaPayError as error:
        raise _renewal_refusal(error, "Purchase cannot be reactivated") from error
    purchase = _purchase_of(response, "reactivate purchase")
    if not purchase.get("reference"):
        raise _Refusal("Reactivate purchase response missing required fields", 500)
    if purchase.get("cancelledAt"):
        raise _Refusal("Purchase reactivation failed: cancelledAt is still set", 500)
    await asyncio.sleep(SETTLE_SECONDS)
    return purchase


async def activate_plan(call: _Call) -> Any:
    body = await call.body()
    product_ref, plan_ref = _text(body.get("productRef")), _text(body.get("planRef"))
    if not product_ref or not plan_ref:
        raise _Refusal("Missing required parameters: productRef and planRef are required", 400)
    customer_ref = await call.customer_ref()
    return await call.api.call(
        "Activate plan",
        "POST",
        "/v1/sdk/activate",
        body={"customerRef": customer_ref, "productRef": product_ref, "planRef": plan_ref},
    )


async def create_checkout_session(call: _Call) -> Json:
    body = await call.body()
    product_ref = _text(body.get("productRef"))
    if not product_ref:
        raise _Refusal("Missing required parameter: productRef is required", 400)
    customer_ref = await call.customer_ref()
    request: Json = {"customerRef": customer_ref, "productRef": product_ref}
    if _text(body.get("planRef")):
        request["planRef"] = body["planRef"]
    # ``returnUrl: null`` asks for none; otherwise the one given, else this request's origin.
    if "returnUrl" not in body or body["returnUrl"] is not None:
        url = call.request.url
        request["returnUrl"] = _text(body.get("returnUrl")) or f"{url.scheme}://{url.netloc}"
    if _text(body.get("purpose")):
        request["purpose"] = body["purpose"]
    session = await call.api.call(
        "Create checkout session", "POST", "/v1/sdk/checkout-sessions", body=request
    )
    if not isinstance(session, dict):
        raise _invalid("a checkout session", session)
    return _present(session, "sessionId", "checkoutUrl")


async def create_customer_session(call: _Call) -> Any:
    customer_ref = await call.customer_ref()
    return await call.api.call(
        "Create customer session",
        "POST",
        "/v1/sdk/customers/customer-sessions",
        body={"customerRef": customer_ref},
    )


async def get_merchant(call: _Call) -> Any:
    return await call.api.call("Get merchant", "GET", "/v1/sdk/merchant")


def _product_ref(call: _Call) -> str:
    product_ref = call.query.get("productRef")
    if not product_ref:
        raise _Refusal("Missing required parameter: productRef", 400)
    return product_ref


async def get_product(call: _Call) -> Json:
    product_ref = _product_ref(call)
    return _dump(
        await call.api.typed("Get product", call.api.client.get_product(product_ref=product_ref))
    )


async def list_plans(call: _Call) -> Json:
    product_ref = _product_ref(call)
    listed = await call.api.typed("List plans", call.api.client.list_plans(product_ref=product_ref))
    if listed.plans is None:
        raise _invalid("a plan list", _dump(listed))
    return {"plans": [_dump(plan) for plan in listed.plans], "productRef": product_ref}


async def get_payment_method(call: _Call) -> Any:
    customer_ref = await call.customer_ref()
    return await call.api.call(
        "Get payment method",
        "GET",
        "/v1/sdk/payment-method",
        query={"customerRef": customer_ref},
    )


async def get_auto_recharge(call: _Call) -> Any:
    customer_ref = await call.customer_ref()
    return await call.api.call(
        "Get auto-recharge", "GET", "/v1/sdk/auto-recharge", query={"customerRef": customer_ref}
    )


async def save_auto_recharge(call: _Call) -> Any:
    body = await call.body()
    customer_ref = await call.customer_ref()
    # The customer is always the user's: TypeScript spreads the body over customerRef,
    # so a customerRef sent by the client would win there.
    return await call.api.call(
        "Save auto-recharge",
        "PUT",
        "/v1/sdk/auto-recharge",
        body={**body, "customerRef": customer_ref},
    )


async def disable_auto_recharge(call: _Call) -> Any:
    customer_ref = await call.customer_ref()
    return await call.api.call(
        "Disable auto-recharge",
        "DELETE",
        "/v1/sdk/auto-recharge",
        query={"customerRef": customer_ref},
    )


def derive_usage_snapshot(
    *,
    limits: Mapping[str, Any] | None,
    period_start: Any = None,
    period_end: Any = None,
    purchase_ref: Any = None,
) -> Json:
    """TypeScript's ``deriveUsageSnapshot``: the usage meter React shows."""
    extra: Json = {}
    if period_start:
        extra["periodStart"] = period_start
    if period_end:
        extra["periodEnd"] = period_end
    if purchase_ref:
        extra["purchaseRef"] = purchase_ref
    if limits is None:
        return {
            "meterRef": None,
            "total": None,
            "used": None,
            "remaining": None,
            "percentUsed": None,
            **extra,
        }
    # ``remaining: -1`` is the API's "no finite cap"; the cap itself is ``limit``.
    raw_remaining = limits.get("remaining")
    remaining = raw_remaining if _number(raw_remaining) and raw_remaining >= 0 else None
    raw_limit = limits.get("limit")
    total = raw_limit if _number(raw_limit) and raw_limit > 0 else None
    raw_used = limits.get("used")
    if _number(raw_used):
        used = raw_used
    elif total is not None and remaining is not None:
        used = max(0, total - remaining)
    else:
        used = None
    percent = (
        _js_number(min(100, js_round((used / total) * 10000) / 100))
        if total is not None and total > 0 and used is not None
        else None
    )
    meter = limits.get("meterName")
    return {
        "meterRef": meter,
        "total": total,
        "used": used,
        "remaining": remaining,
        "percentUsed": percent,
        **extra,
    }


async def get_usage(call: _Call) -> Json:
    """``getUsageCore``: the user's usage on their active purchase."""
    checked = await check_purchase(call)
    active = next(iter(checked["purchases"]), None)
    if active is None:
        return derive_usage_snapshot(limits=None)
    usage = active.get("usage") if isinstance(active.get("usage"), dict) else {}
    period = {
        "period_start": usage.get("periodStart"),
        "period_end": usage.get("periodEnd"),
        "purchase_ref": active.get("reference"),
    }
    plan = active.get("planSnapshot")
    counted = counts_usage(plan) or (isinstance(plan, dict) and plan.get("isMetered") is True)
    if not counted or not active.get("productRef"):
        return derive_usage_snapshot(limits=None, **period)
    limits = await call.api.call(
        "Check limits",
        "POST",
        "/v1/sdk/limits",
        body={"customerRef": checked["customerRef"], "productRef": active["productRef"]},
    )
    if not isinstance(limits, dict):
        raise _invalid("limits", limits)
    return derive_usage_snapshot(limits=limits, **period)


async def check_limits(call: _Call) -> Any:
    product_ref = _product_ref(call)
    meter_name = call.query.get("meterName") or "requests"
    customer_ref = await call.customer_ref()
    return await call.api.call(
        "Check limits",
        "POST",
        "/v1/sdk/limits",
        body={"customerRef": customer_ref, "productRef": product_ref, "meterName": meter_name},
    )


def _positive_integer(raw: str) -> int:
    """``Number(limit)`` that must be an integer of at least 1."""
    try:
        value = float(raw)
    except ValueError:
        value = float("nan")
    if not value.is_integer() or value < 1:
        raise _Refusal("limit must be a positive integer", 400)
    return int(value)


async def get_history(call: _Call) -> Json:
    """``getHistoryCore``: the product's charges and the account's credit activity."""
    product_ref = call.query.get("productRef") or ""
    limit_raw = call.query.get("limit")
    limit = _positive_integer(limit_raw) if limit_raw else None
    if not product_ref:
        raise _Refusal("getHistory requires productRef", 400)
    customer_ref = await call.customer_ref()
    purchases, activity = await asyncio.gather(
        call.api.call(
            "List purchases",
            "GET",
            "/v1/sdk/purchases",
            query={"customerRef": customer_ref, "productRef": product_ref},
        ),
        call.api.call(
            "Get credit activity",
            "GET",
            "/v1/sdk/credits/activity",
            query={"customerRef": customer_ref, "limit": limit},
        ),
    )
    charges = purchases.get("purchases") if isinstance(purchases, dict) else None
    if not isinstance(charges, list):
        raise _invalid("a purchase list", purchases)
    return {"charges": charges, "creditActivity": activity}


TRACK_USAGE_KEYS = (
    "actionType",
    "units",
    "productRef",
    "description",
    "metadata",
    "idempotencyKey",
)


async def track_usage(call: _Call) -> Any:
    body = await call.body()
    customer_ref = await call.customer_ref()
    return await call.api.call(
        "Track usage",
        "POST",
        "/v1/sdk/usages",
        body={"customerRef": customer_ref, **_present(body, *TRACK_USAGE_KEYS)},
    )


SOLVAPAY_ROUTES: Mapping[str, Mapping[str, Handler]] = {
    "check-purchase": {"GET": check_purchase},
    "create-payment-intent": {"POST": create_payment_intent},
    "process-payment": {"POST": process_payment},
    "create-topup-payment-intent": {"POST": create_topup_payment_intent},
    "process-topup-payment": {"POST": process_topup_payment},
    "attach-business-details": {"POST": attach_business_details},
    "customer-balance": {"GET": customer_balance},
    "cancel-renewal": {"POST": cancel_renewal},
    "reactivate-renewal": {"POST": reactivate_renewal},
    "activate-plan": {"POST": activate_plan},
    "create-checkout-session": {"POST": create_checkout_session},
    "create-customer-session": {"POST": create_customer_session},
    "merchant": {"GET": get_merchant},
    "get-product": {"GET": get_product},
    "list-plans": {"GET": list_plans},
    "payment-method": {"GET": get_payment_method},
    "auto-recharge": {
        "GET": get_auto_recharge,
        "PUT": save_auto_recharge,
        "DELETE": disable_auto_recharge,
    },
    "usage": {"GET": get_usage},
    "limits": {"GET": check_limits},
    "history": {"GET": get_history},
    "sync-customer": {"POST": sync_customer},
    "track-usage": {"POST": track_usage},
}
"""Route name (React's default path without ``/api/``) → method → handler, in
TypeScript's order (``Allow`` lists the methods in this order)."""


def _route_path(scope: Scope) -> str:
    """The path below where the app is mounted (Starlette's ``get_route_path``)."""
    path: str = scope["path"]
    root: str = scope.get("root_path", "")
    if not root or not path.startswith(root):
        return path
    if path == root:
        return ""
    return path[len(root) :] if path[len(root)] == "/" else path


class SolvaPayRoutes:
    """The ASGI app ``routes()`` builds."""

    def __init__(self, solvapay: SolvaPay, *, get_user: GetUser, base_path: str = "/api") -> None:
        if not isinstance(solvapay, SolvaPay):
            raise SolvaPayError(
                "routes() needs the SolvaPay from create_solvapay()", code="invalid_argument"
            )
        if not callable(get_user):
            raise SolvaPayError(
                "routes() needs get_user: verify the request with your own auth there",
                code="invalid_argument",
            )
        self.solvapay = solvapay
        self.api = _Api(solvapay.api)
        self.get_user = get_user
        self.base_path = base_path.rstrip("/")
        self._customers: dict[str, str] = {}
        self._customer_lookups: dict[str, asyncio.Future[str]] = {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        if scope["type"] != "http":
            raise RuntimeError(f"solvapay.web routes serve HTTP, not {scope['type']}")
        response = await self.handle(Request(scope, receive))
        await response(scope, receive, send)

    async def handle(self, request: Request) -> Response:
        path = _route_path(request.scope)
        prefix = f"{self.base_path}/"
        name = path[len(prefix) :] if path.startswith(prefix) else None
        methods = SOLVAPAY_ROUTES.get(name) if name is not None else None
        if methods is None:
            return _error_response("Not found", 404)
        handler = methods.get(request.method.upper())
        if handler is None:
            response = _error_response("Method not allowed", 405)
            response.headers["Allow"] = ", ".join(methods)
            return response
        try:
            return _json(await handler(_Call(self, request)))
        except _Refusal as refusal:
            return _error_response(refusal.error, refusal.status, refusal.details)
        except SolvaPayError as error:
            # TypeScript's handleRouteError: the error's own message, at its status.
            status = error.status if error.status is not None else 500
            return _error_response(error.message, status, error.message)

    # Customers ---------------------------------------------------------------

    async def ensure_customer(self, user: User) -> str:
        """The SolvaPay customer for ``user``: found by ``externalRef``, else created.

        Unlike TypeScript's ``ensureCustomer``, a user id that looks like a customer
        reference (``cus_…``) is still looked up by ``externalRef``: the id comes from
        the merchant's auth and never names a SolvaPay customer.
        """
        cached = self._customers.get(user.id)
        if cached is not None:
            return cached
        pending = self._customer_lookups.get(user.id)
        if pending is None:
            pending = asyncio.ensure_future(self._resolve_customer(user))
            self._customer_lookups[user.id] = pending
            pending.add_done_callback(lambda _: self._customer_lookups.pop(user.id, None))
        ref = await asyncio.shield(pending)
        self._customers[user.id] = ref
        return ref

    async def _find_customer(self, external_ref: str) -> str | None:
        try:
            customer = await self.api.typed(
                "Get customer", self.api.client.get_customer_by_query(external_ref=external_ref)
            )
        except SolvaPayError as error:
            if error.status == 404:
                return None
            raise
        return customer.reference

    async def _resolve_customer(self, user: User) -> str:
        found = await self._find_customer(user.id)
        if found is not None:
            return found
        body: Json = {
            # The API requires an email; as TypeScript, a user without one gets a
            # placeholder unique to them.
            "email": user.email or f"{user.id}-{int(time.time() * 1000)}@auto-created.local",
            "metadata": {},
        }
        if user.name:
            body["name"] = user.name
        body["externalRef"] = user.id
        try:
            created = await self.api.call("Create customer", "POST", "/v1/sdk/customers", body=body)
        except SolvaPayError as error:
            if error.status != 409:
                raise
            # Created meanwhile, by another request: the lookup finds it. Otherwise the
            # email belongs to another customer (Known divergences).
            again = await self._find_customer(user.id)
            if again is not None:
                return again
            raise SolvaPayError(
                f"A customer for {user.id} already exists and is not linked to it: "
                f"{error.message}. Link the existing customer to this externalRef.",
                code="customer_conflict",
                status=409,
                body=error.body,
            ) from error
        # Read as sent, not as a CustomerResponse: the create answers the new reference,
        # not always with the rest of the customer.
        ref = created.get("reference") if isinstance(created, dict) else None
        if not isinstance(ref, str) or not ref:
            raise _invalid("a created customer", created)
        return ref


def routes(solvapay: SolvaPay, *, get_user: GetUser, base_path: str = "/api") -> SolvaPayRoutes:
    """Every route ``@solvapay/react`` calls, as an ASGI app.

    ``get_user(request)`` is required: verify the request with your own auth and
    answer the signed-in ``User`` (your user id, email and name), or None for no
    user, which the routes refuse with 401. Nothing the client sends is identity.

    ``base_path`` is where the routes are, below where the app is mounted:
    ``/api`` serves ``/api/check-purchase`` and the rest, React's defaults. Mounted
    at ``/api`` (``Mount("/api", app=routes(..., base_path=""))``), pass ``""``.
    Other paths answer 404, and a known path with the wrong method 405 with ``Allow``.
    """
    return SolvaPayRoutes(solvapay, get_user=get_user, base_path=base_path)
