"""``build_paywall_gate``, ported from ``@solvapay/server``'s ``paywall-gate.ts``.

Turns a limits response into the paywall a customer sees: its kind, the
machine-readable recovery fields, and the message. JSON in, JSON out, with the
API's camelCase keys, so it can go straight into an MCP tool result's
``structuredContent``.
"""

from __future__ import annotations

from typing import Any

from .._js import UNDEFINED, coalesce, compact, get, number, truthy
from .state import (
    PaywallStateKind,
    build_gate_message,
    classify_paywall_state,
    credit_signals,
    next_action_for,
)

Json = dict[str, Any]


def _all_paid_plans_are_payg(plans: Any) -> bool:
    """True when every plan that takes payment is pay-as-you-go."""
    if not plans:
        return False
    paid = [p for p in plans if get(p, "requiresPayment") is not False]
    if not paid:
        return False
    return all(get(p, "type") in ("usage-based", "hybrid") for p in paid)


def _active_plan_ref(limits: Json) -> Any:
    ref = coalesce(get(limits, "planRef"), get(limits, "plan"))
    return ref if truthy(ref) and len(ref) > 0 else UNDEFINED


def _active_plan(limits: Json) -> Any:
    ref = _active_plan_ref(limits)
    if ref is UNDEFINED:
        return UNDEFINED
    for plan in coalesce(get(limits, "plans"), []):
        if get(plan, "reference") == ref:
            return plan
    return UNDEFINED


def _included(limits: Json) -> Json | None:
    used, limit = get(limits, "used"), get(limits, "limit")
    remaining = get(limits, "remaining")
    if used is not UNDEFINED and limit is not UNDEFINED:
        return compact({"total": limit, "used": used, "remaining": remaining})
    total = get(_active_plan(limits), "freeUnits")
    if total is None or total is UNDEFINED or total == 0:
        return None
    used_count = max(0, number(total) - number(remaining))
    if isinstance(total, int) and isinstance(remaining, int):
        used_count = int(used_count)
    return compact({"total": total, "used": used_count, "remaining": remaining})


def _links(limits: Json) -> Json | None:
    links: Json = {}
    checkout_url = get(limits, "checkoutUrl")
    if truthy(checkout_url):
        if get(limits, "paywallReason") == "topup_required":
            links["topup"] = checkout_url
        else:
            links["checkout"] = checkout_url
    if truthy(get(limits, "confirmationUrl")):
        links["manage"] = limits["confirmationUrl"]
    return links or None


def _recovery_fields(limits: Json, kind: PaywallStateKind) -> Json:
    plan = _active_plan(limits)
    included = _included(limits)
    signals = credit_signals(limits)
    plan_ref = _active_plan_ref(limits)
    links = _links(limits)
    balance = get(limits, "balance")

    price: Json = {}
    unit_price = get(plan, "perUnitChargeMinor")
    if unit_price is not None and unit_price is not UNDEFINED:
        price = compact({"unitPriceMinor": unit_price, "currency": get(plan, "currency")})
    elif truthy(get(limits, "currency")):
        price = {"currency": limits["currency"]}

    fields: Json = {}
    if truthy(plan_ref):
        fields["planRef"] = plan_ref
    fields.update(
        compact(
            {
                "planName": get(limits, "planName"),
                "plans": get(limits, "plans"),
                "meterName": get(limits, "meterName"),
            }
        )
    )
    fields.update(price)
    if included:
        fields["included"] = included
    fields.update(compact({"creditBalance": signals["creditBalance"]}))
    fields["reason"] = kind
    fields["nextAction"] = next_action_for(kind)
    fields.update(
        compact(
            {
                "creditsPerCall": signals["creditsPerCall"],
                "shortfallCredits": signals["shortfallCredits"],
                "remainingCalls": signals["remainingCalls"],
                "creditsPerMinorUnit": get(balance, "creditsPerMinorUnit"),
                "displayExchangeRate": get(balance, "displayExchangeRate"),
                "purchaseRef": get(limits, "purchaseRef"),
                "autoRecharge": get(limits, "autoRecharge"),
            }
        )
    )
    if links:
        fields["links"] = links
    return fields


def build_paywall_gate(product_ref: str, limits: Json) -> Json:
    """The paywall for a limits response: ``activation_required`` or ``payment_required``.

    When the customer is out of credits and every paid plan is pay-as-you-go,
    the gate is ``activation_required`` with the plans attached, so clients
    show top-up copy; the message still names the top-up.
    """
    checkout_url = get(limits, "checkoutUrl")
    kind = classify_paywall_state(limits)
    use_activation_for_topup = (
        not truthy(get(limits, "activationRequired"))
        and kind == "topup_required"
        and _all_paid_plans_are_payg(get(limits, "plans"))
    )
    recovery = _recovery_fields(limits, kind)
    common = compact(
        {
            "balance": get(limits, "balance"),
            "productDetails": get(limits, "product"),
        }
    )
    if truthy(get(limits, "activationRequired")) or use_activation_for_topup:
        confirmation_url = get(limits, "confirmationUrl")
        gate: Json = {
            "kind": "activation_required",
            "product": product_ref,
            "message": "",
            "checkoutUrl": (
                confirmation_url
                if truthy(confirmation_url)
                else checkout_url
                if truthy(checkout_url)
                else ""
            ),
            **compact({"confirmationUrl": confirmation_url}),
            **common,
            **recovery,
        }
    else:
        gate = {
            "kind": "payment_required",
            "product": product_ref,
            "checkoutUrl": checkout_url if truthy(checkout_url) else "",
            "message": "",
            **common,
            **recovery,
        }
    gate["message"] = build_gate_message(kind, gate)
    return gate
