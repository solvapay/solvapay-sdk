"""Paywall state and copy, ported from ``@solvapay/server``'s ``paywall-state.ts``.

Classifies a limits response into the recovery the customer needs, and writes
the gate and nudge messages. Inputs and outputs are JSON objects with the
API's camelCase keys. The conformance suite checks the result against the
TypeScript SDK, message text included.
"""

from __future__ import annotations

import math
import re
from typing import Any, Literal

from .._js import UNDEFINED, coalesce, get, num_str, number, to_locale_string, truthy
from ..money import credits_to_display_minor_units, format_minor

CHECKOUT_SESSION_TTL_MINUTES = 15

PaywallStateKind = Literal[
    "activation_required",
    "topup_required",
    "upgrade_required",
    "limit_reached",
    "reactivation_required",
]
PaywallNextAction = Literal["activate", "topup", "checkout", "account"]

Json = dict[str, Any]


def credit_signals(limits: Json | None) -> Json:
    """Coalesces the two credit-balance channels; nested ``balance`` wins."""
    if not limits:
        return {"isCreditBased": False}
    balance = get(limits, "balance")
    credit_balance = coalesce(get(balance, "creditBalance"), get(limits, "creditBalance"))
    credits_per_call = coalesce(get(balance, "creditsPerUnit"), get(limits, "creditsPerUnit"))
    is_credit_based = credit_balance is not UNDEFINED or credits_per_call is not UNDEFINED
    shortfall: Any = UNDEFINED
    if credit_balance is not UNDEFINED and credits_per_call is not UNDEFINED:
        shortfall = max(0, number(credits_per_call) - number(credit_balance))
        shortfall = _same_kind(shortfall, credits_per_call, credit_balance)
    remaining_calls: Any = UNDEFINED
    if get(balance, "remainingUnits") is not UNDEFINED:
        remaining_calls = balance["remainingUnits"]
    elif (
        credit_balance is not UNDEFINED
        and credits_per_call is not UNDEFINED
        and number(credits_per_call) > 0
    ):
        remaining_calls = math.floor(number(credit_balance) / number(credits_per_call))
    elif number(get(limits, "remaining")) >= 0:
        remaining_calls = get(limits, "remaining")
    return {
        "creditBalance": credit_balance,
        "creditsPerCall": credits_per_call,
        "shortfallCredits": shortfall,
        "remainingCalls": remaining_calls,
        "isCreditBased": is_credit_based,
    }


def _same_kind(value: float, *sources: Any) -> float | int:
    """Arithmetic on JSON ints stays an int, as it prints in JavaScript."""
    if all(isinstance(s, int) and not isinstance(s, bool) for s in sources if s is not None):
        return int(value)
    return value


def next_action_for(kind: PaywallStateKind) -> PaywallNextAction:
    return {
        "activation_required": "activate",
        "topup_required": "topup",
        "upgrade_required": "checkout",
        "limit_reached": "checkout",
        "reactivation_required": "account",
    }[kind]  # type: ignore[return-value]


def _active_plan_ref(limits: Json) -> Any:
    ref = coalesce(get(limits, "planRef"), get(limits, "plan"))
    return ref if truthy(ref) and len(ref) > 0 else UNDEFINED


def classify_paywall_state(limits: Json | None) -> PaywallStateKind:
    """Which recovery the customer needs. Same precedence as the TypeScript SDK."""
    if not limits:
        return "upgrade_required"
    reason = get(limits, "paywallReason")
    if get(limits, "activationRequired") is True or reason == "activation_required":
        return "activation_required"
    if reason == "limit_reached":
        return "limit_reached"
    if reason == "topup_required":
        return "topup_required"
    if get(limits, "needsTopUp") is True:
        return "topup_required"

    signals = credit_signals(limits)
    balance, cost = signals["creditBalance"], signals["creditsPerCall"]
    if signals["isCreditBased"]:
        if balance is not UNDEFINED and cost is not UNDEFINED and number(balance) < number(cost):
            return "topup_required"
        if balance == 0 and not isinstance(balance, bool):
            return "topup_required"
        if cost is UNDEFINED and get(limits, "remaining") == 0:
            return "topup_required"

    if (truthy(get(limits, "purchaseRef")) or truthy(_active_plan_ref(limits))) and number(
        get(limits, "remaining")
    ) <= 0:
        return "limit_reached"
    if signals["isCreditBased"]:
        return "topup_required"
    if truthy(get(limits, "purchaseRef")):
        return "limit_reached"
    return "upgrade_required"


def _format_credits(value: Any) -> str:
    return to_locale_string(number(value))


def _format_credits_with_money(credits: Any, gate: Json) -> str:
    amount = _format_credits(credits)
    peg = get(gate, "creditsPerMinorUnit")
    currency = get(gate, "currency")
    rate = get(gate, "displayExchangeRate")
    # `rate != null` in the TypeScript: neither null nor undefined.
    has_rate = rate is not None and rate is not UNDEFINED and number(rate) > 0
    if truthy(peg) and number(peg) > 0 and truthy(currency) and has_rate:
        minor = credits_to_display_minor_units(
            credits=number(credits),
            credits_per_minor_unit=number(peg),
            display_exchange_rate=number(rate),
            display_currency=currency,
        )
        if minor is not None:
            return f"{amount} credits (~{format_minor(minor, currency)})"
    return f"{amount} credits"


def _is_free_meter(name: Any) -> bool:
    return isinstance(name, str) and name.startswith("free-")


def _meter_label(gate: Json) -> str:
    name = get(gate, "meterName")
    if not truthy(name):
        return "units"
    return re.sub(r"[_-]", " ", name)


def _named_checkout_markdown(url: str, label: str = "Open checkout") -> str:
    return f"[{label}]({url})"


def link_label(name: str) -> str:
    """Escapes markdown link-label delimiters: plan names are merchant-authored."""
    return re.sub(r"([\[\]])", r"\\\1", name)


def plan_ladder(gate: Json) -> str | None:
    plans = coalesce(get(gate, "plans"), [])
    plan_ref = get(gate, "planRef")
    linkable = [
        p
        for p in plans
        if isinstance(get(p, "checkoutUrl"), str)
        and len(p["checkoutUrl"]) > 0
        and get(p, "reference") != plan_ref
    ]
    linkable = sorted(linkable, key=lambda p: number(get(p, "price")))[:4]
    if not linkable:
        return None
    links = " · ".join(
        f"[{link_label(coalesce(get(p, 'name'), get(p, 'reference')))}]({p['checkoutUrl']})"
        for p in linkable
    )
    return (
        f"{links} (first link used closes the rest; "
        f"links expire in {CHECKOUT_SESSION_TTL_MINUTES} minutes)"
    )


_VIEWER_TOOL = "account"


def _call_viewer(view: str | None = None) -> str:
    if view:
        return f"call the `{_VIEWER_TOOL}` tool with view: '{view}'"
    return f"call the `{_VIEWER_TOOL}` tool"


def _capital(text: str) -> str:
    return "C" + text[1:] if text.startswith("c") else text


def _recover_clause(
    url: str | None, verb: str, view: str | None = None, label: str = "Open checkout"
) -> str:
    if url:
        return (
            f" {_named_checkout_markdown(url, label)} to {verb} "
            f"(expires in {CHECKOUT_SESSION_TTL_MINUTES} minutes), or {_call_viewer(view)}."
        )
    return f" {_capital(_call_viewer(view))}."


def _has_active_plan(gate: Json) -> bool:
    plan_ref = get(gate, "planRef")
    return truthy(get(gate, "purchaseRef")) or (truthy(plan_ref) and len(plan_ref) > 0)


def _auto_recharge_disabled(gate: Json) -> bool:
    return get(get(gate, "autoRecharge"), "enabled") is False


def build_gate_message(kind: PaywallStateKind, gate: Json) -> str:
    """The gate message: names one recovery tool and inlines the checkout link."""
    checkout_url = get(gate, "checkoutUrl")
    url = checkout_url if truthy(checkout_url) and len(checkout_url) > 0 else None
    ladder = plan_ladder(gate)

    if kind == "limit_reached":
        included = get(gate, "included")
        if _is_free_meter(get(gate, "meterName")):
            total = get(included, "total")
            used_line = (
                f"You've used all {num_str(total)} {_meter_label(gate)} for this period."
                if total is not UNDEFINED
                else f"You've used all {_meter_label(gate)} for this period."
            )
            switch_line = (
                f" Pick a plan to keep going: {ladder}. "
                f"{_capital(_call_viewer('account'))} for usage and recovery."
                if ladder
                else _recover_clause(url, "keep going", "checkout")
            )
            return f"{used_line}{switch_line}"
        unit_price = get(gate, "unitPriceMinor")
        currency = get(gate, "currency")
        price = (
            format_minor(number(unit_price), currency)
            if unit_price is not None and unit_price is not UNDEFINED and truthy(currency)
            else None
        )
        used_line = (
            f"You've used {num_str(get(included, 'used'))} of "
            f"{num_str(get(included, 'total'))} included {_meter_label(gate)} this period."
            if truthy(included)
            else "You've reached the included usage for this period."
        )
        next_line = f" The next call is {price}." if price else ""
        plan_name = coalesce(get(gate, "planName"), "This plan")
        credit_balance = get(gate, "creditBalance")
        credits_per_call = get(gate, "creditsPerCall")
        anti_trap = (
            f" Adding credits will not help, because {plan_name} does not spend them."
            if credit_balance is not UNDEFINED
            and number(credit_balance) > 0
            and (credits_per_call is UNDEFINED or credits_per_call == 0)
            else ""
        )
        switch_line = (
            f" Or switch plan: {ladder}. "
            f"{_capital(_call_viewer('account'))} for usage and recovery."
            if ladder
            else _recover_clause(url, "continue", "checkout")
        )
        return f"{used_line}{next_line}{anti_trap}{switch_line}"

    if kind == "activation_required":
        return (
            f"Your plan needs activation.{_recover_clause(url, 'activate', 'checkout')} "
            "Or call `activate_plan` with a `planRef`."
        )

    if kind == "topup_required":
        balance = get(gate, "creditBalance")
        cost = get(gate, "creditsPerCall")
        shortfall = get(gate, "shortfallCredits")
        if UNDEFINED not in (balance, cost, shortfall):
            have = _format_credits_with_money(balance, gate)
            need = _format_credits_with_money(cost, gate)
            lead = (
                f"Out of credits for this call. Balance {have}; this call costs {need} — "
                f"{_format_credits(shortfall)} short."
            )
        else:
            lead = "Included usage is exhausted."
        topup = _recover_clause(url, "add credits", "topup", "Add credits")
        auto = (
            f" Auto-recharge is off — {_call_viewer('account')} to turn it on "
            "and avoid this next time."
            if _auto_recharge_disabled(gate)
            else ""
        )
        if ladder:
            switch_line = f" Or switch plan: {ladder}."
        elif _has_active_plan(gate):
            switch_line = ""
        else:
            switch_line = f" Or {_call_viewer('checkout')} to pick a plan."
        return f"{lead}{topup}{auto}{switch_line}"

    if kind == "upgrade_required":
        if ladder:
            return (
                f"You don't have an active plan for this tool. Pick a plan to use this tool: "
                f"{ladder}, or {_call_viewer('checkout')}. "
                f"{_capital(_call_viewer('account'))} for usage and recovery."
            )
        return (
            "You don't have an active plan for this tool."
            f"{_recover_clause(url, 'pick a plan', 'checkout')}"
        )

    return (
        f"Your previous plan is no longer active. {_capital(_call_viewer('account'))} "
        f"to reactivate it, or {_call_viewer('checkout')} to pick a new plan."
    )


def build_nudge_message(kind: PaywallStateKind, limits: Json | None) -> str:
    """The softer message appended to a successful call that is near a limit."""
    checkout_url = get(limits, "checkoutUrl")
    url = checkout_url if truthy(checkout_url) and len(checkout_url) > 0 else None
    visit = f", or {_named_checkout_markdown(url)}" if url else ""
    signals = credit_signals(limits)
    remaining = signals["remainingCalls"]
    if kind == "topup_required" and limits and not signals["isCreditBased"]:
        kind = "limit_reached"

    if kind == "topup_required":
        if remaining == 0:
            return (
                "Heads up — 0 calls left — the next call needs a top-up. "
                f"{_capital(_call_viewer('topup'))} to add more{visit}."
            )
        return (
            "Heads up — running low on credits. "
            f"{_capital(_call_viewer('topup'))} to add more{visit}."
        )
    if kind in ("upgrade_required", "limit_reached"):
        if remaining == 0:
            return (
                "Heads up — 0 calls left — the next call needs a top-up. "
                f"{_capital(_call_viewer('checkout'))} for more headroom{visit}."
            )
        return (
            "Heads up — approaching your plan's limit this period. "
            f"{_capital(_call_viewer('checkout'))} for more headroom{visit}."
        )
    if kind == "activation_required":
        return (
            "Heads up — this plan still needs activation. "
            f"Call the `activate_plan` tool with a `planRef`{visit}."
        )
    return (
        "Heads up — your plan is no longer active. "
        f"{_capital(_call_viewer('account'))} to reactivate it{visit}."
    )
