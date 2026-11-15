"""The snapshot behind the ``account`` tool, ported from ``@solvapay/mcp-core``.

``build_bootstrap_payload`` reads the merchant, product, plans and the
signed-in customer's purchases, card, balance, limits and portal link in
parallel, and shapes them as the TypeScript SDK does (``BootstrapPayload``).
It calls the generated API client directly where TypeScript goes through its
``*Core`` request helpers. The merchant and the product must load; a failed
customer read leaves its field ``null`` and is logged.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable, Iterable, Mapping
from datetime import datetime, timezone
from typing import Any, Literal, TypeVar

from pydantic import BaseModel

from .._js import UNDEFINED, coalesce, get, js_round, number
from ..errors import SolvaPayError
from ..money import format_minor
from ..paywall import classify_paywall_state, credit_signals, next_action_for
from ..solvapay import SolvaPay

logger = logging.getLogger("solvapay.mcp")

Json = dict[str, Any]
ViewKind = Literal["checkout", "account", "topup", "auto-recharge"]
ADVERTISED_VIEWS: tuple[ViewKind, ...] = ("checkout", "account", "topup")
_VIEW_PRIORITY: tuple[ViewKind, ...] = ("checkout", "topup", "account")

PORTAL_AUTO_RECHARGE_QUERY = "tab=credits&intent=autorecharge"

T = TypeVar("T")


def parse_date(iso: Any) -> datetime | None:
    """``new Date(iso)`` for the ISO 8601 strings the API sends; None when it is not one.
    A time without an offset is read as UTC."""
    if not isinstance(iso, str) or not iso:
        return None
    try:
        parsed = datetime.fromisoformat(re.sub(r"Z$", "+00:00", iso))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ---- active purchase --------------------------------------------------------


def is_plan_purchase(purchase: Mapping[str, Any]) -> bool:
    """A plan purchase, not a credit top-up."""
    if get(purchase, "origin") == "credit_topup":
        return False
    if get(get(purchase, "metadata"), "purpose") == "credit_topup":
        return False
    snapshot = get(purchase, "planSnapshot")
    return snapshot is not UNDEFINED and snapshot is not None


def _start_time(purchase: Mapping[str, Any]) -> float:
    start = get(purchase, "startDate")
    if not isinstance(start, str) or not start:
        return 0
    parsed = parse_date(start)
    return parsed.timestamp() if parsed else 0


def select_active_plan_purchase(
    purchases: Iterable[Any] | None, product_ref: str | None = None
) -> Json | None:
    """The customer's current plan purchase: active, on ``product_ref``, not a top-up.
    The newest start wins; paid beats free only on the same start."""
    candidates = []
    for purchase in purchases or []:
        if not isinstance(purchase, Mapping):
            continue
        status = get(purchase, "status")
        if isinstance(status, str) and status and status != "active":
            continue
        if not is_plan_purchase(purchase):
            continue
        if product_ref and get(purchase, "productRef") != product_ref:
            continue
        candidates.append(dict(purchase))
    if not candidates:
        return None
    # A stable sort, as Array.prototype.sort is: equal keys keep their order.
    ranked = sorted(
        candidates,
        key=lambda p: (-_start_time(p), -int((coalesce(get(p, "amount"), 0) or 0) > 0)),
    )
    return ranked[0]


def derive_default_view(data: Mapping[str, Any], enabled: Iterable[ViewKind]) -> ViewKind:
    """The view to land on when ``view`` is omitted: no plan → checkout, a top-up gate →
    topup, else account; the first enabled view in that order when it is turned off."""
    enabled_views = set(enabled)
    customer = get(data, "customer")
    purchases = get(get(customer, "purchase"), "purchases")
    product_ref = get(data, "productRef")
    has_plan = (
        select_active_plan_purchase(
            purchases if isinstance(purchases, list) else None,
            product_ref if isinstance(product_ref, str) else None,
        )
        is not None
    )
    preferred: ViewKind
    if not has_plan:
        preferred = "checkout"
    elif get(customer, "nextAction") == "topup":
        preferred = "topup"
    else:
        preferred = "account"
    if preferred in enabled_views:
        return preferred
    for view in _VIEW_PRIORITY:
        if view in enabled_views:
            return view
    raise SolvaPayError(
        "derive_default_view: no enabled views, so the account tool should not be registered",
        code="invalid_argument",
    )


# ---- shaping ----------------------------------------------------------------


def _minor_units(amount: Any, currency: Any) -> str | None:
    """``Intl`` currency format with fixed digits; None where ``Intl`` would throw."""
    if amount is None or amount is UNDEFINED or not isinstance(currency, str) or not currency:
        return None
    if not re.fullmatch(r"[A-Za-z]{3}", currency):
        return None
    return format_minor(amount, currency)


def _number(value: Any) -> Any:
    ok = isinstance(value, (int, float)) and not isinstance(value, bool)
    return value if ok else UNDEFINED


def enrich_purchase(purchase: Mapping[str, Any]) -> Json:
    """A purchase plus ``priceDisplay`` / ``priceUsdDisplay`` strings, and the snapshot's
    ``priceDisplay``, so a model reading the JSON need not reason about minor units."""
    amount = _number(get(purchase, "amount"))
    original = _number(get(purchase, "originalAmount"))
    currency = get(purchase, "currency")
    currency = currency if isinstance(currency, str) else None
    price_display = _minor_units(original, currency) or _minor_units(amount, "USD")
    usd_display = _minor_units(amount, "USD") if currency and currency.upper() != "USD" else None
    out: Json = dict(purchase)
    if price_display:
        out["priceDisplay"] = price_display
    if usd_display:
        out["priceUsdDisplay"] = usd_display
    snapshot = get(purchase, "planSnapshot")
    if isinstance(snapshot, Mapping):
        snap_currency = get(snapshot, "currency")
        snap_display = _minor_units(
            _number(get(snapshot, "price")),
            snap_currency if isinstance(snap_currency, str) else None,
        )
        out["planSnapshot"] = (
            {**snapshot, "priceDisplay": snap_display} if snap_display else snapshot
        )
    return out


def auto_recharge_url_from(customer_url: Any) -> str | None:
    """The portal URL opened on the auto-recharge form; None without an http(s) URL."""
    if not isinstance(customer_url, str) or not re.match(r"^https?://", customer_url, re.I):
        return None
    separator = "&" if "?" in customer_url else "?"
    return f"{customer_url}{separator}{PORTAL_AUTO_RECHARGE_QUERY}"


def derive_usage_snapshot(
    *,
    period_start: Any = UNDEFINED,
    period_end: Any = UNDEFINED,
    purchase_ref: Any = UNDEFINED,
    limits: Mapping[str, Any] | None,
) -> Json:
    """``deriveUsageSnapshot``: consumption and cap from a limits response.
    ``limits=None`` means the cap is unknown, not unlimited."""
    extra: Json = {}
    if isinstance(period_start, str) and period_start:
        extra["periodStart"] = period_start
    if isinstance(period_end, str) and period_end:
        extra["periodEnd"] = period_end
    if isinstance(purchase_ref, str) and purchase_ref:
        extra["purchaseRef"] = purchase_ref
    if not limits:
        return {
            "meterRef": None,
            "total": None,
            "used": None,
            "remaining": None,
            "percentUsed": None,
            **extra,
        }
    remaining = limits["remaining"] if number(get(limits, "remaining")) >= 0 else None
    limit = _number(get(limits, "limit"))
    total = limit if limit is not UNDEFINED and limit > 0 else None
    used_value = _number(get(limits, "used"))
    if used_value is not UNDEFINED:
        used: Any = used_value
    elif total is not None and remaining is not None:
        used = max(0, total - remaining)
    else:
        used = None
    percent = (
        min(100, js_round(used / total * 10000) / 100)
        if total is not None and total > 0 and used is not None
        else None
    )
    if isinstance(percent, float) and percent.is_integer():
        percent = int(percent)
    return {
        "meterRef": coalesce(get(limits, "meterName"), None),
        "total": total,
        "used": used,
        "remaining": remaining,
        "percentUsed": percent,
        **extra,
    }


def _dump(model: Any) -> Any:
    if isinstance(model, BaseModel):
        return model.model_dump(mode="json", by_alias=True, exclude_unset=True)
    return model


def _unwrap_plan(plan: Mapping[str, Any]) -> Json:
    """``listPlans`` spreads a plan's ``data`` under it, as the TypeScript client does."""
    data = plan.get("data")
    data = data if isinstance(data, Mapping) else {}
    price = coalesce(get(plan, "price"), get(data, "price"))
    out: Json = {**data, **plan}
    if price is not UNDEFINED:
        out["price"] = price
    out.pop("data", None)
    return out


def signed_in_customer_ref(ref: Any) -> str | None:
    """A signed-in customer, or None. ``anonymous`` is no customer."""
    if not isinstance(ref, str):
        return None
    trimmed = ref.strip()
    return trimmed if trimmed and trimmed != "anonymous" else None


_PROVIDER_NOT_FOUND = "\n".join(
    [
        "Provider account not found on this SolvaPay deployment.",
        "",
        "The Worker secret key authenticates against SolvaPay, but no merchant",
        "record exists for it. This usually means the secret key was created",
        "manually (without running `solvapay init`) or the merchant was deleted.",
        "",
        "To recover:",
        "  1. Run `npx solvapay init` in the project root. It will create the",
        "     merchant on the backend and write a valid secret key to `.env`.",
        "  2. Redeploy with `npm run deploy` to push the corrected secret to",
        "     the Worker.",
        "",
        "No tool calls will succeed until the merchant exists.",
    ]
)


async def _optional(name: str, call: Awaitable[T]) -> T | None:
    """A customer read that may fail: logged, and left out of the payload."""
    try:
        return await call
    except SolvaPayError as error:
        logger.warning(
            "bootstrap: %s failed; omitted from the payload (%s, status %s)",
            name,
            error.message,
            error.status,
        )
        return None


async def _none() -> None:
    return None


async def build_bootstrap_payload(
    solvapay: SolvaPay,
    *,
    view: ViewKind,
    product_ref: str,
    public_base_url: str,
    customer_ref: str | None,
) -> Json:
    """The ``BootstrapPayload`` for ``view``. Raises ``SolvaPayError`` (with the API's
    status) when the merchant or the product cannot load."""
    api = solvapay.api
    customer_ref = signed_in_customer_ref(customer_ref)
    signed_in = customer_ref is not None
    ref = customer_ref or ""

    async def merchant() -> Json:
        try:
            return _dump(await api.get_merchant())  # type: ignore[no-any-return]
        except SolvaPayError as error:
            details = (
                _PROVIDER_NOT_FOUND
                if error.status == 404
                else f"bootstrap: merchant lookup failed: {error.message}"
            )
            raise SolvaPayError(details, code=error.code, status=error.status) from error

    async def product() -> Json:
        try:
            return _dump(await api.get_product(product_ref=product_ref))  # type: ignore[no-any-return]
        except SolvaPayError as error:
            raise SolvaPayError(
                f"bootstrap: product lookup failed: {error.message}",
                code=error.code,
                status=error.status,
            ) from error

    async def publishable_key() -> Any:
        config = await _optional("getPlatformConfig", api.get_platform_config())
        return coalesce(get(_dump(config), "stripePublishableKey"), None)

    async def plans() -> list[Json]:
        response = await _optional("listPlans", api.list_plans(product_ref=product_ref))
        listed = coalesce(get(_dump(response), "plans"), [])
        return [_unwrap_plan(plan) for plan in listed if isinstance(plan, Mapping)]

    async def customer() -> Json | None:
        if not signed_in:
            return None
        return _dump(await _optional("getCustomer", api.get_customer(reference=ref)))  # type: ignore[no-any-return]

    async def limits() -> Json | None:
        if not signed_in:
            return None
        body = {"customerRef": ref, "productRef": product_ref, "meterName": "requests"}
        return _dump(await _optional("checkLimits", api.check_limits(body=body)))  # type: ignore[no-any-return]

    def customer_read(name: str, call: Awaitable[Any]) -> Awaitable[Any]:
        return _optional(name, call) if signed_in else _none()

    results = await asyncio.gather(
        publishable_key(),
        merchant(),
        product(),
        plans(),
        customer(),
        customer_read("getPaymentMethod", api.get_payment_method(customer_ref=ref))
        if signed_in
        else _none(),
        customer_read("getCustomerBalance", api.get_customer_balance(reference=ref))
        if signed_in
        else _none(),
        limits(),
        customer_read(
            "createCustomerSession", api.create_customer_session(body={"customerRef": ref})
        )
        if signed_in
        else _none(),
        return_exceptions=True,
    )
    for result in results:
        if isinstance(result, BaseException):
            raise result
    values: list[Any] = list(results)
    (
        stripe_key,
        merchant_data,
        product_data,
        plan_list,
        customer_data,
        payment_method,
        balance,
        limits_data,
        portal,
    ) = values

    # checkLimits creates the free default purchase, so the parallel customer read
    # can predate it. Read again once when limits names a purchase it lacks.
    needed = get(limits_data, "purchaseRef")
    if signed_in and isinstance(needed, str) and needed:
        listed = coalesce(get(customer_data, "purchases"), [])
        if not any(get(p, "reference") == needed for p in listed):
            customer_data = await customer()

    purpose = view == "topup" or (
        view not in ("checkout", "auto-recharge")
        and get(limits_data, "paywallReason") == "topup_required"
    )
    checkout = None
    if signed_in:
        session_body: Json = {"productRef": product_ref, "customerRef": ref}
        if purpose:
            session_body["purpose"] = "credit_topup"
        checkout = _dump(
            await _optional("createCheckoutSession", api.create_checkout_session(body=session_body))
        )

    purchase: Json | None = None
    if customer_data is not None:
        purchases = [
            enrich_purchase(p)
            for p in coalesce(get(customer_data, "purchases"), [])
            if get(p, "status") == "active"
        ]
        purchase = {"customerRef": coalesce(get(customer_data, "reference"), ref)}
        for key in ("email", "name"):
            if get(customer_data, key) is not UNDEFINED:
                purchase[key] = customer_data[key]
        purchase["purchases"] = purchases

    payload_customer: Json | None = None
    if signed_in:
        active = select_active_plan_purchase(
            purchase["purchases"] if purchase else None, product_ref
        )
        usage = active and get(active, "usage")
        signals = credit_signals(limits_data) if limits_data else None
        email, name = get(purchase, "email"), get(purchase, "name")
        payload_customer = {
            "ref": ref,
            "email": email.strip() if isinstance(email, str) and email.strip() else None,
            "name": name.strip() if isinstance(name, str) and name.strip() else None,
            "purchase": purchase,
            "paymentMethod": _dump(payment_method),
            "balance": _dump(balance),
            "usage": derive_usage_snapshot(
                period_start=get(usage, "periodStart"),
                period_end=get(usage, "periodEnd"),
                purchase_ref=get(active, "reference"),
                limits=limits_data,
            ),
            "limits": limits_data,
        }
        if limits_data:
            payload_customer["canCall"] = get(limits_data, "withinLimits") is True
        if signals:
            for key, source in (
                ("remainingCalls", "remainingCalls"),
                ("creditsPerCall", "creditsPerCall"),
                ("shortfallCredits", "shortfallCredits"),
            ):
                if signals.get(source, UNDEFINED) is not UNDEFINED:
                    payload_customer[key] = signals[source]
            payload_customer["isCreditBased"] = signals["isCreditBased"]
        if get(limits_data, "autoRecharge") is not UNDEFINED:
            payload_customer["autoRecharge"] = limits_data["autoRecharge"]
        if get(limits_data, "withinLimits") is False:
            payload_customer["nextAction"] = next_action_for(classify_paywall_state(limits_data))

    portal_url = coalesce(get(_dump(portal), "customerUrl"), None)
    return {
        "view": view,
        "productRef": product_ref,
        "stripePublishableKey": stripe_key,
        "returnUrl": public_base_url,
        "merchant": merchant_data,
        "product": product_data,
        "plans": plan_list,
        "customer": payload_customer,
        "checkoutUrl": coalesce(get(checkout, "checkoutUrl"), None),
        "portalUrl": portal_url,
        "autoRechargeUrl": auto_recharge_url_from(portal_url),
    }


__all__ = [
    "ADVERTISED_VIEWS",
    "ViewKind",
    "auto_recharge_url_from",
    "build_bootstrap_payload",
    "derive_default_view",
    "derive_usage_snapshot",
    "enrich_purchase",
    "is_plan_purchase",
    "select_active_plan_purchase",
    "signed_in_customer_ref",
]
