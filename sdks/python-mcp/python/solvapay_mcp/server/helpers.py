from __future__ import annotations

import asyncio
import inspect
import json
from collections.abc import Awaitable, Callable

from solvapay.errors import SolvaPayError
from solvapay.facade import SolvaPay

from solvapay_mcp.server.native import (
    handle_route_error,
    is_error_result,
    native_call,
    unwrap_client_envelope,
)

ErrorResult = dict[str, object]
RENEWAL_SETTLE_SECONDS = 0.5


def facade_api_client(solvapay: SolvaPay) -> object:
    getter = getattr(solvapay, "get_api_client", None)
    if callable(getter):
        return getter()
    return object.__getattribute__(solvapay, "_bound_client")


class DeferredApiClient:
    def __init__(self, solvapay: SolvaPay) -> None:
        self._solvapay = solvapay

    def __getattr__(self, name: str) -> object:
        return getattr(facade_api_client(self._solvapay), name)


async def _invoke(client: object, method: str, payload: dict[str, object]) -> object:
    encoded = json.dumps(payload)
    blocking = getattr(client, f"{method}_blocking", None)
    if callable(blocking) and not inspect.iscoroutinefunction(blocking):
        raw = await asyncio.to_thread(blocking, encoded)
    else:
        fn = getattr(client, method, None)
        if not callable(fn):
            raise SolvaPayError(f"{method} method not available")
        raw = fn(encoded)
        if asyncio.iscoroutine(raw):
            raw = await raw
    if not isinstance(raw, str):
        raise SolvaPayError(f"{method} returned unexpected envelope")
    return unwrap_client_envelope(raw)


def _validation_error(result: object) -> ErrorResult | None:
    if result is None:
        return None
    if is_error_result(result) and isinstance(result, dict):
        return {str(k): v for k, v in result.items()}
    return None


async def _guarded(
    operation: str,
    default_message: str,
    work: Callable[[], Awaitable[object]],
) -> object:
    try:
        return await work()
    except SolvaPayError as err:
        return handle_route_error(err, operation, default_message)
    except Exception as err:
        return handle_route_error(err, operation, default_message)


async def get_merchant_core(client: object) -> object:
    async def work() -> object:
        return await _invoke(client, "get_merchant", {})

    return await _guarded("Get merchant", "Failed to fetch merchant", work)


async def get_product_core(client: object, product_ref: str) -> object:
    validation = _validation_error(
        native_call("validate_get_product_params", {"productRef": product_ref})
    )
    if validation is not None:
        return validation

    async def work() -> object:
        return await _invoke(client, "get_product", {"productRef": product_ref})

    return await _guarded("Get product", "Failed to fetch product", work)


async def list_plans_core(client: object, product_ref: str) -> object:
    validation = _validation_error(
        native_call("validate_list_plans_params", {"productRef": product_ref})
    )
    if validation is not None:
        return validation

    async def work() -> object:
        plans = await _invoke(client, "list_plans", {"productRef": product_ref})
        return {"plans": plans or [], "productRef": product_ref}

    return await _guarded("List plans", "Failed to fetch plans", work)


async def get_payment_method_core(client: object, customer_ref: str) -> object:
    async def work() -> object:
        return await _invoke(client, "get_payment_method", {"customerRef": customer_ref})

    return await _guarded("Get payment method", "Failed to fetch payment method", work)


async def get_customer_balance_core(client: object, customer_ref: str) -> object:
    async def work() -> object:
        return await _invoke(client, "get_customer_balance", {"customerRef": customer_ref})

    return await _guarded("Get customer balance", "Failed to fetch balance", work)


async def get_usage_core(client: object, customer_ref: str, product_ref: str) -> object:
    async def work() -> object:
        raw = await _invoke(
            client,
            "check_limits",
            {"customerRef": customer_ref, "productRef": product_ref, "meterName": "requests"},
        )
        return native_call("project_usage_snapshot", {"limits": raw, "customerRef": customer_ref})

    return await _guarded("Get usage", "Failed to fetch usage", work)


async def check_purchase_core(client: object, customer_ref: str) -> object:
    async def work() -> object:
        customer = await _invoke(client, "get_customer", {"customerRef": customer_ref})
        if not isinstance(customer, dict):
            return {"customerRef": customer_ref, "purchases": []}
        purchases = customer.get("purchases") if isinstance(customer.get("purchases"), list) else []
        selected = native_call("select_active_purchases", {"purchases": purchases})
        resolved = native_call(
            "resolve_purchase_customer_ref",
            {"customerRef": customer.get("customerRef"), "fallback": customer_ref},
        )
        return {
            "customerRef": resolved,
            "email": customer.get("email"),
            "name": customer.get("name"),
            "purchases": selected if isinstance(selected, list) else [],
        }

    try:
        return await work()
    except Exception:
        return {"customerRef": customer_ref, "purchases": []}


async def get_platform_config_core(client: object) -> object | None:
    fn = getattr(client, "get_platform_config", None)
    if not callable(fn):
        return None
    try:
        return await _invoke(client, "get_platform_config", {})
    except Exception:
        return None


async def create_checkout_session_core(
    client: object,
    *,
    customer_ref: str,
    product_ref: str,
    plan_ref: str | None,
    return_url: str | None,
) -> object:
    validation = _validation_error(
        native_call("validate_checkout_session_params", {"productRef": product_ref})
    )
    if validation is not None:
        return validation
    resolved_return = native_call(
        "resolve_return_url",
        {"bodyReturnUrl": return_url, "optionsReturnUrl": None, "origin": None},
    )

    async def work() -> object:
        session = await _invoke(
            client,
            "create_checkout_session",
            {
                "productRef": product_ref,
                "customerRef": customer_ref,
                "planRef": plan_ref,
                "returnUrl": resolved_return,
            },
        )
        if not isinstance(session, dict):
            raise SolvaPayError("create_checkout_session returned unexpected value")
        return {"sessionId": session.get("sessionId"), "checkoutUrl": session.get("checkoutUrl")}

    return await _guarded("Create checkout session", "Checkout session creation failed", work)


async def create_customer_session_core(client: object, *, customer_ref: str) -> object:
    async def work() -> object:
        return await _invoke(client, "create_customer_session", {"customerRef": customer_ref})

    return await _guarded("Create customer session", "Customer session creation failed", work)


async def create_payment_intent_core(
    client: object,
    *,
    customer_ref: str,
    plan_ref: str,
    product_ref: str,
    currency: str | None = None,
) -> object:
    validation = _validation_error(
        native_call(
            "validate_create_payment_intent_params",
            {"planRef": plan_ref, "productRef": product_ref},
        )
    )
    if validation is not None:
        return validation

    async def work() -> object:
        payload: dict[str, object] = {
            "planRef": plan_ref,
            "productRef": product_ref,
            "customerRef": customer_ref,
        }
        if currency:
            payload["currency"] = currency
        created = await _invoke(client, "create_payment_intent", payload)
        if not isinstance(created, dict):
            raise SolvaPayError("create_payment_intent returned unexpected value")
        return native_call(
            "project_payment_intent_result",
            {
                "processorPaymentId": created.get("processorPaymentId") or created.get("id"),
                "clientSecret": created.get("clientSecret"),
                "publishableKey": created.get("publishableKey"),
                "customerRef": customer_ref,
                **(
                    {"accountId": created["accountId"]}
                    if isinstance(created.get("accountId"), str)
                    else {}
                ),
            },
        )

    return await _guarded("Create payment intent", "Payment intent creation failed", work)


async def create_topup_payment_intent_core(
    client: object,
    *,
    customer_ref: str,
    amount: int,
    currency: str,
    description: str | None = None,
) -> object:
    validation = _validation_error(
        native_call(
            "validate_topup_payment_intent_params",
            {"amount": amount, "currency": currency},
        )
    )
    if validation is not None:
        return validation

    async def work() -> object:
        payload: dict[str, object] = {
            "amount": amount,
            "currency": currency,
            "customerRef": customer_ref,
        }
        if description:
            payload["description"] = description
        return await _invoke(client, "create_topup_payment_intent", payload)

    return await _guarded(
        "Create topup payment intent", "Top-up payment intent creation failed", work
    )


async def process_payment_intent_core(
    client: object,
    *,
    customer_ref: str,
    payment_intent_id: str,
    product_ref: str,
    plan_ref: str | None = None,
) -> object:
    validation = _validation_error(
        native_call(
            "validate_process_payment_intent_params",
            {"paymentIntentId": payment_intent_id, "productRef": product_ref},
        )
    )
    if validation is not None:
        return validation

    async def work() -> object:
        payload: dict[str, object] = {
            "paymentIntentId": payment_intent_id,
            "productRef": product_ref,
            "customerRef": customer_ref,
        }
        if plan_ref:
            payload["planRef"] = plan_ref
        processed = await _invoke(client, "process_payment_intent", payload)
        if not isinstance(processed, dict):
            raise SolvaPayError("process_payment_intent returned unexpected value")
        return native_call(
            "project_topup_process_outcome",
            {
                "status": processed.get("status"),
                "message": processed.get("message"),
            },
        )

    return await _guarded("Process payment intent", "Payment processing failed", work)


async def attach_business_details_core(
    client: object,
    *,
    customer_ref: str,
    payment_intent_id: str,
    is_business: bool,
    business_name: str | None = None,
    country: str | None = None,
    tax_id: str | None = None,
    tax_id_type: str | None = None,
) -> object:
    body: dict[str, object] = {
        "paymentIntentId": payment_intent_id,
        "customerRef": customer_ref,
        "isBusiness": is_business,
    }
    if business_name is not None:
        body["businessName"] = business_name
    if country is not None:
        body["country"] = country
    if tax_id is not None:
        body["taxId"] = tax_id
    if tax_id_type is not None:
        body["taxIdType"] = tax_id_type
    validation = _validation_error(native_call("validate_attach_business_details_params", body))
    if validation is not None:
        return validation

    async def work() -> object:
        return await _invoke(client, "attach_business_details", body)

    return await _guarded("Attach business details", "Failed to attach business details", work)


async def activate_plan_core(
    client: object,
    *,
    customer_ref: str,
    product_ref: str,
    plan_ref: str,
) -> object:
    validation = _validation_error(
        native_call(
            "validate_activate_plan_params",
            {"productRef": product_ref, "planRef": plan_ref},
        )
    )
    if validation is not None:
        return validation

    async def work() -> object:
        return await _invoke(
            client,
            "activate_plan",
            {"productRef": product_ref, "planRef": plan_ref, "customerRef": customer_ref},
        )

    return await _guarded("Activate plan", "Failed to activate plan", work)


async def cancel_purchase_core(
    client: object,
    *,
    purchase_ref: str,
    reason: str | None = None,
    settle_seconds: float = RENEWAL_SETTLE_SECONDS,
) -> object:
    validation = _validation_error(
        native_call("validate_purchase_ref", {"purchaseRef": purchase_ref})
    )
    if validation is not None:
        return validation

    async def work() -> object:
        payload: dict[str, object] = {"purchaseRef": purchase_ref}
        if reason:
            payload["reason"] = reason
        cancelled = await _invoke(client, "cancel_purchase", payload)
        normalized = native_call("normalize_cancel_response", {"response": cancelled})
        if is_error_result(normalized):
            return normalized
        await asyncio.sleep(settle_seconds)
        return normalized

    try:
        return await work()
    except SolvaPayError as err:
        classified = native_call("classify_cancel_error", {"message": str(err)})
        if isinstance(classified, dict):
            return classified
        return handle_route_error(err, "Cancel purchase", "Failed to cancel purchase")
    except Exception as err:
        return handle_route_error(err, "Cancel purchase", "Failed to cancel purchase")


async def reactivate_purchase_core(
    client: object,
    *,
    purchase_ref: str,
    settle_seconds: float = RENEWAL_SETTLE_SECONDS,
) -> object:
    validation = _validation_error(
        native_call("validate_purchase_ref", {"purchaseRef": purchase_ref})
    )
    if validation is not None:
        return validation

    async def work() -> object:
        reactivated = await _invoke(client, "reactivate_purchase", {"purchaseRef": purchase_ref})
        normalized = native_call("normalize_reactivate_response", {"response": reactivated})
        if is_error_result(normalized):
            return normalized
        await asyncio.sleep(settle_seconds)
        return normalized

    try:
        return await work()
    except SolvaPayError as err:
        classified = native_call("classify_reactivate_error", {"message": str(err)})
        if isinstance(classified, dict):
            return classified
        return handle_route_error(err, "Reactivate purchase", "Failed to reactivate purchase")
    except Exception as err:
        return handle_route_error(err, "Reactivate purchase", "Failed to reactivate purchase")


def enrich_purchase(purchase: dict[str, object]) -> dict[str, object]:
    raw_amount = purchase.get("amount")
    amount: float | int | None = raw_amount if isinstance(raw_amount, int | float) else None
    raw_original = purchase.get("originalAmount")
    original: float | int | None = (
        raw_original if isinstance(raw_original, int | float) else None
    )
    raw_currency = purchase.get("currency")
    currency: str | None = raw_currency if isinstance(raw_currency, str) else None
    price_display = _format_minor(original, currency) or _format_minor(amount, "USD")
    price_usd = None
    if currency and currency.upper() != "USD":
        price_usd = _format_minor(amount if isinstance(amount, int | float) else None, "USD")
    enriched = dict(purchase)
    if price_display:
        enriched["priceDisplay"] = price_display
    if price_usd:
        enriched["priceUsdDisplay"] = price_usd
    snapshot = purchase.get("planSnapshot")
    if isinstance(snapshot, dict):
        snap = dict(snapshot)
        snap_price = snap.get("price") if isinstance(snap.get("price"), int | float) else None
        snap_currency = snap.get("currency") if isinstance(snap.get("currency"), str) else None
        snap_display = _format_minor(snap_price, snap_currency)
        if snap_display:
            snap["priceDisplay"] = snap_display
        enriched["planSnapshot"] = snap
    return enriched


def _format_minor(amount_minor: float | int | None, currency: str | None) -> str | None:
    if amount_minor is None or not currency:
        return None
    zero = bool(native_call("is_zero_decimal_currency", {"currency": currency}))
    major = float(amount_minor) if zero else float(amount_minor) / 100
    try:
        return _format_money(major, currency, 0 if zero else 2)
    except ValueError:
        return None


def _format_money(major: float, currency: str, fraction: int) -> str:
    symbols = {"USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥", "SEK": "SEK"}
    symbol = symbols.get(currency.upper())
    grouped = f"{major:,.{fraction}f}"
    if symbol and len(symbol) == 1:
        return f"{symbol}{grouped}"
    return f"{currency.upper()} {grouped}"
