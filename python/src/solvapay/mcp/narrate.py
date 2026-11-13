"""Narration for the built-in ``account`` and ``activate_plan`` tools, ported from
``@solvapay/mcp-core``'s ``narrate.ts``.

Each narrator renders the bootstrap payload as sparse markdown a text-only
host can show as is: a bold title, ``Label: value`` rows, and the recovery as
a named tool call. The copy matches the TypeScript SDK byte for byte; the
conformance suite (``conformance/cases/narration``) checks it.

A row whose value is missing is left out, never written as ``Balance: —``.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from .._js import UNDEFINED, coalesce, get, num_str, number, to_locale_string, truthy
from ..errors import SolvaPayError
from ..money import credits_to_display_minor_units, format_minor
from ..paywall import credit_signals
from ..pricing import (
    billing_cycle,
    charges,
    counts_usage,
    credits_per_unit_from_balance,
    headline_charges,
    included_units,
    meter_name,
    plan_pricing_shape,
    tier_bands,
    tier_meters,
    trial_days,
    usage_rate,
)
from .bootstrap import parse_date, select_active_plan_purchase

Json = dict[str, Any]
ViewKind = Literal["checkout", "account", "topup", "auto-recharge"]

VIEWER_TOOL_NAME = "account"
ACTIVATE_PLAN_TOOL_NAME = "activate_plan"
CHECKOUT_TTL = "expires in 15 minutes"
MS_PER_DAY = 24 * 60 * 60 * 1000


@dataclass(frozen=True)
class NarratorOutput:
    text: str
    links: list[Json] = field(default_factory=list)
    """``{"uri", "name"}`` for each ``resource_link`` block that follows the text."""


# ---- formatting -------------------------------------------------------------


def _str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def format_money(amount_minor: Any, currency: Any) -> str | None:
    if amount_minor is None or amount_minor is UNDEFINED or not truthy(currency):
        return None
    return format_minor(number(amount_minor), str(currency))


def format_compact_money(amount_minor: Any, currency: Any) -> str | None:
    money = format_money(amount_minor, currency)
    return re.sub(r"\.00(?!\d)", "", money, count=1) if money else None


def format_count(value: Any) -> str:
    return to_locale_string(number(value))


_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def format_short_date(iso: Any) -> str | None:
    """``toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })``."""
    date = parse_date(iso)
    if date is None:
        return None
    utc = date.astimezone(timezone.utc)
    return f"{_MONTHS[utc.month - 1]} {utc.day}"


def _epoch_ms(date: datetime) -> int:
    """``date.getTime()``: whole milliseconds, so the arithmetic below is exact."""
    return (date - datetime(1970, 1, 1, tzinfo=timezone.utc)) // timedelta(milliseconds=1)


def days_until(iso: str, now: datetime) -> int | None:
    end = parse_date(iso)
    if end is None:
        return None
    millis = _epoch_ms(end) - _epoch_ms(now)
    return max(0, -(-millis // MS_PER_DAY))


def meter_unit(meter: Any, count: Any) -> str:
    if truthy(meter) and meter != "requests":
        text = str(meter)
        return _singular(text) if count == 1 else text
    return "call" if count == 1 else "calls"


def _singular(word: str) -> str:
    """One unit of a plural meter name: ``searches`` → ``search``, ``queries`` → ``query``."""
    if re.search(r"[^aeiou]ies$", word, re.IGNORECASE):
        return f"{word[:-3]}y"
    if re.search(r"(ch|sh|ss|x|z)es$", word, re.IGNORECASE):
        return word[:-2]
    if re.search(r"[^s]s$", word, re.IGNORECASE):
        return word[:-1]
    return word


def _positive(value: Any) -> bool:
    return truthy(value) and number(value) > 0


# ---- payload readers --------------------------------------------------------


def _customer(data: Json) -> Any:
    return coalesce(get(data, "customer"), None)


def _plans(data: Json) -> list[Json]:
    plans = coalesce(get(data, "plans"), [])
    return [dict(plan) for plan in plans if isinstance(plan, Mapping)]


def _active_purchase(data: Json) -> Json | None:
    purchases = get(get(_customer(data), "purchase"), "purchases")
    return select_active_plan_purchase(
        purchases if isinstance(purchases, list) else None, _str(get(data, "productRef"))
    )


def _credits_unused(customer: Any) -> bool:
    limits = get(customer, "limits")
    return not credit_signals(dict(limits) if isinstance(limits, Mapping) else None)[
        "isCreditBased"
    ]


def _prefer_limits_plan(purchase: Json | None, limits: Any) -> bool:
    limits_ref = get(limits, "planRef")
    if not truthy(limits_ref):
        return False
    return bool(
        limits_ref
        != coalesce(get(purchase, "planRef"), get(get(purchase, "planSnapshot"), "reference"))
    )


def product_name(data: Json) -> str:
    name = get(get(data, "product"), "name")
    return name if isinstance(name, str) and name else "SolvaPay"


def balance_summary(customer: Any) -> str | None:
    row = _balance_row(customer)
    return re.sub(r"^Balance:\s*", "", row) if row else None


def _identity_row(customer: Any) -> str | None:
    ref = get(customer, "ref")
    ref = ref.strip() if isinstance(ref, str) else ""
    if not ref:
        return None
    email = get(customer, "email")
    email = email.strip() if isinstance(email, str) else ""
    return f"Signed in as: {email} · {ref}" if email else f"Signed in as: {ref}"


def _balance_row(customer: Any) -> str | None:
    balance = get(customer, "balance")
    if not truthy(balance):
        return None
    credits = coalesce(get(balance, "credits"), 0)
    currency = get(balance, "displayCurrency")
    per_minor = get(balance, "creditsPerMinorUnit")
    display_minor = None
    if (
        truthy(currency)
        and isinstance(per_minor, (int, float))
        and not isinstance(per_minor, bool)
        and per_minor > 0
    ):
        display_minor = credits_to_display_minor_units(
            credits=number(credits),
            credits_per_minor_unit=per_minor,
            display_exchange_rate=number(coalesce(get(balance, "displayExchangeRate"), 1)),
            display_currency=str(currency),
        )
    money = format_money(display_minor, coalesce(currency, None))
    fmt = format_count(credits)
    return f"Balance: {fmt} credits (~{money})" if money else f"Balance: {fmt} credits"


def _recovery_line(views: list[str]) -> str:
    calls = " or ".join(f'`{VIEWER_TOOL_NAME}` with view: "{view}"' for view in views)
    return f"To continue, call {calls}."


# ---- plans ------------------------------------------------------------------


def _format_plan_prices(plan: Any) -> str:
    shape = plan_pricing_shape(plan)
    headline = headline_charges(plan)
    if headline:
        prices = [format_money(c["amountMinor"], c["currency"]) for c in headline]
        return " · ".join(p for p in prices if p is not None)
    rate = shape["rate"] or usage_rate(plan)
    if rate and rate["amountMinor"] > 0:
        money = format_money(rate["amountMinor"], rate["currency"])
        if money is not None:
            unit = coalesce(rate.get("meter", UNDEFINED), meter_name(plan), "unit")
            return f"{'from ' if rate['tiered'] else ''}{money} / {unit}"
    money = format_money(get(plan, "price"), get(plan, "currency"))
    return money if money is not None else ""


def _is_free_plan(plan: Any) -> bool:
    return get(plan, "requiresPayment") is False


def _plan_type_label(plan: Any) -> str:
    if _is_free_plan(plan):
        return "no payment required"
    shape = plan_pricing_shape(plan)["shape"]
    return {
        "usage": "pay as you go",
        "hybrid": "subscription + usage",
        "oneTime": "one-time",
    }.get(shape, "recurring")


def _format_cycle(plan: Any) -> str:
    cycle = plan_pricing_shape(plan)["cycle"] or billing_cycle(plan)
    if not cycle:
        return ""
    count = cycle.get("count")
    return f"/{num_str(count)} {cycle['interval']}s" if count else f"/{cycle['interval']}"


def _plans_list_lines(plans: list[Json]) -> list[str]:
    lines = []
    for plan in plans:
        parts = [str(coalesce(get(plan, "name"), "Plan")), _plan_type_label(plan)]
        price = _format_plan_prices(plan)
        if price and not _is_free_plan(plan):
            parts.append(f"{price}{_format_cycle(plan)}")
        trial = trial_days(plan)
        if truthy(trial):
            parts.append(f"{num_str(trial)}-day trial")
        if truthy(get(plan, "reference")):
            parts.append(f"planRef: {plan['reference']}")
        lines.append(" · ".join(parts))
    return lines


# ---- links ------------------------------------------------------------------


def _https_url(value: Any) -> str | None:
    if isinstance(value, str) and re.match(r"^https?://", value, re.IGNORECASE):
        return value
    return None


def _checkout_url(data: Json) -> str | None:
    return _https_url(get(data, "checkoutUrl"))


def _checkout_link_label(url: str) -> str:
    return "Add credits" if "/checkout/topup" in url else "Open checkout"


def _named_checkout_markdown(url: str) -> str:
    return f"[{_checkout_link_label(url)}]({url})"


def _checkout_row(data: Json) -> str | None:
    url = _checkout_url(data)
    return f"Checkout: {_named_checkout_markdown(url)} ({CHECKOUT_TTL})" if url else None


def _named_manage_markdown(url: str) -> str:
    return f"[Manage account]({url})"


def _manage_row(data: Json) -> str | None:
    url = _https_url(get(data, "portalUrl"))
    return f"Manage: {_named_manage_markdown(url)} ({CHECKOUT_TTL})" if url else None


def _checkout_link(data: Json) -> Json | None:
    url = _checkout_url(data)
    return {"uri": url, "name": _checkout_link_label(url)} if url else None


def _hosted_portal_link(data: Json) -> Json | None:
    url = _https_url(get(data, "portalUrl"))
    return {"uri": url, "name": "Manage account"} if url else None


# ---- account state ----------------------------------------------------------


def _is_paid_plan(plan: Any) -> bool:
    if get(plan, "requiresPayment") is False:
        return False
    if any(charge["amountMinor"] > 0 for charge in charges(plan)):
        return True
    # A plan priced only in tier bands has no flat or per-unit charge.
    if any(
        tier["charge"]["amountMinor"] > 0
        for meter in tier_meters(plan)
        for tier in tier_bands(plan, meter)
    ):
        return True
    return number(coalesce(get(plan, "price"), 0)) > 0


def _has_readable_options(plan: Any) -> bool:
    options = get(plan, "options")
    return isinstance(options, list) and len(options) > 0


def _plan_shape(plan: Any) -> str | None:
    """free, trial, usage-based, recurring-unlimited, recurring-metered or paid-unknown."""
    if not truthy(plan):
        return None
    if number(coalesce(trial_days(plan), 0)) > 0:
        return "trial"
    if not _is_paid_plan(plan):
        return "free"
    metered = counts_usage(plan)
    unlimited_cap = included_units(plan) == 0
    readable = _has_readable_options(plan)
    if billing_cycle(plan):
        if metered and not unlimited_cap:
            return "recurring-metered"
        if unlimited_cap or (readable and not metered):
            return "recurring-unlimited"
        return "paid-unknown"
    if metered and not unlimited_cap:
        return "usage-based"
    if unlimited_cap or (readable and not metered):
        return "recurring-unlimited"
    return "paid-unknown"


def _merge_plan(snapshot: Any, catalog: Any) -> Json | None:
    if not truthy(snapshot) and not truthy(catalog):
        return None
    if not truthy(catalog):
        return dict(snapshot) if truthy(snapshot) else None
    if not truthy(snapshot):
        return dict(catalog)
    snapshot_options = get(snapshot, "options")
    has_options = isinstance(snapshot_options, list) and len(snapshot_options) > 0
    merged: Json = {**catalog, **snapshot}
    merged["options"] = snapshot_options if has_options else get(catalog, "options")
    merged["requiresPayment"] = coalesce(
        get(snapshot, "requiresPayment"), get(catalog, "requiresPayment")
    )
    merged["isMetered"] = get(snapshot, "isMetered")
    return {key: value for key, value in merged.items() if value is not UNDEFINED}


def _find_catalog_plan(plans: list[Json], snapshot: Any, plan_ref: Any) -> Json | None:
    ref = coalesce(get(snapshot, "reference"), plan_ref)
    if not truthy(ref):
        return None
    return next((plan for plan in plans if get(plan, "reference") == ref), None)


def _is_at_finite_cap(limits: Any) -> bool:
    if not truthy(limits) or get(limits, "withinLimits") is not False:
        return False
    remaining = get(limits, "remaining")
    if remaining is None or remaining is UNDEFINED or remaining == -1:
        return False
    return number(remaining) <= 0


def _is_cancelled_not_expired(purchase: Any, now: datetime) -> bool:
    if not truthy(get(purchase, "cancelledAt")) or not truthy(get(purchase, "endDate")):
        return False
    end = parse_date(purchase["endDate"])
    return end is not None and end > now


def _account_state(purchase: Json | None, limits: Any, plan: Any, now: datetime) -> str:
    if truthy(get(limits, "activationRequired")):
        return "H"
    if _is_cancelled_not_expired(purchase, now):
        return "J"
    if truthy(get(limits, "overage")):
        return "I"
    if truthy(get(limits, "needsTopUp")):
        return "D"
    shape = _plan_shape(plan)
    if purchase is None and shape is None:
        return "A"
    at_cap = _is_at_finite_cap(limits)
    if shape == "usage-based":
        return "D" if at_cap or get(limits, "withinLimits") is False else "B"
    if at_cap:
        return "F"
    if shape in ("free", "trial"):
        return "E"
    if shape in ("recurring-metered", "recurring-unlimited"):
        return "C"
    return "C" if purchase is not None else "A"


def _cadence_phrase(plan: Any) -> str | None:
    """How often a plan bills, for a sentence with no price: ``every year``, ``every 3 months``."""
    cycle = billing_cycle(plan)
    if not cycle:
        return None
    count = cycle.get("count", 1)
    return f"every {cycle['interval']}" if count == 1 else f"every {count} {cycle['interval']}s"


def _interval_phrase(plan: Any) -> str | None:
    cycle = billing_cycle(plan)
    if not cycle:
        return None
    count = cycle.get("count", 1)
    if count == 1:
        return f"a {cycle['interval']}"
    return f"every {num_str(count)} {cycle['interval']}s"


def _plan_price_phrase(plan: Any) -> str | None:
    headline = headline_charges(plan)
    if headline:
        prices = [format_compact_money(c["amountMinor"], c["currency"]) for c in headline]
        present = [p for p in prices if p is not None]
        if present:
            return " · ".join(present)
    return format_compact_money(get(plan, "price"), get(plan, "currency"))


def _plan_price_bit(plan: Any) -> str:
    price = _plan_price_phrase(plan)
    cycle = _interval_phrase(plan)
    if not billing_cycle(plan):
        return f", {price} once" if price else ""
    if price and cycle:
        return f", {price} {cycle}"
    return f", {price}" if price else ""


def _credits_rate_phrase(plan: Any, customer: Any) -> str | None:
    rate = usage_rate(plan)
    if not rate or rate["amountMinor"] <= 0:
        return None
    floor = "from " if rate["tiered"] else ""
    credits = credits_per_unit_from_balance(plan, get(customer, "balance"))
    if credits is None:
        money = format_compact_money(rate["amountMinor"], rate["currency"])
        if not money:
            return None
        unit = meter_unit(coalesce(rate.get("meter", UNDEFINED), meter_name(plan)), 1)
        return f"{floor}{money} per {unit}"
    return f"{floor}{format_count(credits)} credits per call"


def _catalog_fragment(plan: Json, customer: Any) -> str:
    name = coalesce(get(plan, "name"), "Plan")
    cap = included_units(plan)
    cycle = _interval_phrase(plan)
    price = _plan_price_phrase(plan)
    rate = _credits_rate_phrase(plan, customer)
    shape = _plan_shape(plan)
    trial = trial_days(plan)
    cycle_bit = f" {cycle}" if cycle else ""

    if shape == "free" or (not _is_paid_plan(plan) and shape != "trial"):
        core = (
            f"{name} gives {format_count(cap)} {meter_unit(meter_name(plan), cap)}{cycle_bit}"
            if _positive(cap)
            else f"{name} requires no payment"
        )
    elif shape == "usage-based":
        core = f"{name} is {rate}" if rate else f"{name} is pay as you go"
    elif not billing_cycle(plan):
        allowance = (
            " for unlimited"
            if cap == 0 or cap is None
            else f" for {format_count(cap)} {meter_unit(meter_name(plan), cap)}"
        )
        core = f"{name} is {price} once{allowance}" if price else f"{name} is one-time"
    else:
        if cap == 0:
            allowance = " for unlimited"
        elif _positive(cap):
            allowance = f" for {format_count(cap)} {meter_unit(meter_name(plan), cap)}"
        else:
            allowance = ""
        if price:
            core = f"{name} is {price}{cycle_bit}{allowance}"
        else:
            core = (
                f"{name} is billed {_cadence_phrase(plan) or cycle}{allowance}"
                if cycle
                else str(name)
            )

    if truthy(trial):
        core += f" · {num_str(trial)}-day trial"
    if truthy(get(plan, "reference")):
        core += f" · planRef: {plan['reference']}"
    return core


def _carry_on_fragment(plan: Json, customer: Any) -> str:
    name = coalesce(get(plan, "name"), "Plan")
    if _plan_shape(plan) == "usage-based":
        credits = get(get(customer, "balance"), "credits")
        core = (
            f"{name} starts now using your existing {format_count(credits)} credits"
            if _positive(credits)
            else f"{name} starts now"
        )
    else:
        price = _plan_price_phrase(plan)
        cycle = _interval_phrase(plan)
        if not billing_cycle(plan):
            core = f"{name} is {price} once" if price else str(name)
        else:
            core = f"{name} is {price} {cycle}" if price and cycle else str(name)
    return f"{core} · planRef: {plan['reference']}" if truthy(get(plan, "reference")) else core


def _join_or(parts: list[str]) -> str:
    if len(parts) <= 1:
        return parts[0] if parts else ""
    if len(parts) == 2:
        return f"{parts[0]}, or {parts[1]}"
    return f"{', '.join(parts[:-1])}, or {parts[-1]}"


def _remaining_of_total(usage: Any) -> str | None:
    remaining, total = get(usage, "remaining"), get(usage, "total")
    if remaining is None or remaining is UNDEFINED or total is None or total is UNDEFINED:
        return None
    if number(remaining) < 0:
        return None
    noun = meter_unit(get(usage, "meterRef"), total)
    return f"{format_count(remaining)} of {format_count(total)} {noun}"


def _used_of_total(usage: Any) -> str | None:
    used, total = get(usage, "used"), get(usage, "total")
    if used is None or used is UNDEFINED or total is None or total is UNDEFINED:
        return None
    noun = meter_unit(get(usage, "meterRef"), total)
    return f"{format_count(used)} of {format_count(total)} {noun}"


def _claimable_free_plan(plans: list[Json]) -> Json | None:
    for plan in plans:
        if get(plan, "requiresPayment") is not False:
            continue
        cap = included_units(plan)
        if cap is not None and cap > 0:
            return plan
    return None


def _activate_recovery(plan_ref: Any) -> str:
    return f'To continue, call `{ACTIVATE_PLAN_TOOL_NAME}` with planRef: "{plan_ref}".'


def _recovery_for_state(state: str, free_plan_ref: Any) -> str:
    if state == "B":
        return _recovery_line(["topup"])
    if state == "D":
        return _recovery_line(["topup", "checkout"])
    if state == "H":
        return (
            _activate_recovery(free_plan_ref)
            if truthy(free_plan_ref)
            else _recovery_line(["checkout"])
        )
    if state == "J":
        return _recovery_line(["account"])
    return _recovery_line(["checkout"])


def _account_body(
    state: str,
    product: str,
    plan: Any,
    plan_shape: str | None,
    purchase: Json | None,
    customer: Any,
    plans: list[Json],
    now: datetime,
) -> str:
    plan_name = coalesce(get(plan, "name"), "plan")
    usage = coalesce(get(customer, "usage"), None)
    credits = coalesce(get(get(customer, "balance"), "credits"), 0)
    view = f"Call `{VIEWER_TOOL_NAME}` with view:"

    if state == "A":
        fragments = [_catalog_fragment(item, customer) for item in plans]
        catalog = f" {', '.join(fragments)}." if fragments else ""
        return f"{product} has no plan yet.{catalog} Reply with a plan name to activate it."

    if state == "H":
        free = _claimable_free_plan(plans)
        cap = included_units(free) if free else None
        cycle = _interval_phrase(free)
        unit = meter_unit(meter_name(free), cap if _positive(cap) else 2)
        ready = (
            f"{format_count(cap)} {unit}{f' {cycle}' if cycle else ''}, no card"
            if _positive(cap)
            else "no card"
        )
        return (
            f"{product} has a free plan ready: {ready}. "
            f"Call `{ACTIVATE_PLAN_TOOL_NAME}` with a `planRef` to activate it."
        )

    if state == "B":
        rate = _credits_rate_phrase(plan, customer)
        per_call = credits_per_unit_from_balance(plan, get(customer, "balance")) if plan else None
        runway = (
            f", about {format_count(math.floor(number(credits) / number(per_call)))} calls"
            if _positive(per_call)
            else ""
        )
        rate_bit = f", {rate}" if rate else ""
        return (
            f"{product} is on {plan_name}{rate_bit}. "
            f"Balance {format_count(credits)} credits{runway}. "
            f"{view} 'topup' to add credits."
        )

    if state == "D":
        per_call = credits_per_unit_from_balance(plan, get(customer, "balance")) if plan else None
        if _positive(per_call):
            shortfall = max(0, number(per_call) - number(credits))
            cost_bit = (
                f"; this call costs {format_count(per_call)} credits"
                f" — {format_count(shortfall)} short"
            )
        else:
            cost_bit = f" and {plan_name} needs credits"
        return (
            f"{product} is on {plan_name}. Balance {format_count(credits)} credits{cost_bit}. "
            f"{view} 'topup' to add credits, or with view: 'checkout' to switch to a plan "
            "that does not use credits."
        )

    if state == "C":
        price_bit = _plan_price_bit(plan)
        one_time = not billing_cycle(plan)
        left = _remaining_of_total(usage)
        date = format_short_date(coalesce(get(usage, "periodEnd"), get(purchase, "endDate")))
        renewing = f", renewing {date}" if date else ""
        unlimited = (
            get(usage, "remaining") == -1
            or included_units(plan) == 0
            or plan_shape == "recurring-unlimited"
        )
        if left:
            position = f"{left} left" if one_time else f"{left} left this period{renewing}"
        elif unlimited:
            position = "Unlimited calls" if one_time else f"Unlimited calls{renewing}"
        elif date and not one_time:
            position = f"Renews {date}"
        else:
            position = "After your first call"
        tail = (
            f"Credits are not used on this plan. {view} 'checkout' to switch."
            if _credits_unused(customer)
            else f"{view} 'checkout' to switch."
        )
        return f"{product} is on {plan_name}{price_bit}. {position}. {tail}"

    if state == "E":
        left = _remaining_of_total(usage)
        date = format_short_date(get(usage, "periodEnd"))
        period = billing_cycle(plan)
        interval = period["interval"] if period else "period"
        if left:
            left_bit = f"{left} left this {interval}{f', resetting {date}' if date else ''}"
        else:
            left_bit = f"resets {date}" if date else "After your first call"
        return (
            f"{product} is on the free plan: {left_bit}. "
            f"Credits are not used on {plan_name}. {view} 'checkout' for more calls."
        )

    if state == "F":
        cap = coalesce(get(usage, "total"), included_units(plan))
        unit = meter_unit(
            coalesce(get(usage, "meterRef"), meter_name(plan)), cap if _positive(cap) else 2
        )
        date = format_short_date(get(usage, "periodEnd"))
        cap_bit = (
            f"{format_count(cap)} {unit} are used up" if _positive(cap) else "allowance is used up"
        )
        consequence = (
            f" Further calls fail until {date}"
            if date
            else " Further calls fail until the allowance resets"
        )
        current = coalesce(get(plan, "reference"), get(purchase, "planRef"))
        others = [
            item
            for item in plans
            if not (truthy(get(item, "reference")) and get(item, "reference") == current)
            and _plan_shape(item) not in ("free", "trial")
        ]
        carry_on = (
            f" {_join_or([_carry_on_fragment(item, customer) for item in others])}."
            if others
            else ""
        )
        anti_trap = (
            f" Adding credits will not help, because {plan_name} does not spend them."
            if _credits_unused(customer)
            else ""
        )
        price_bit = _plan_price_bit(plan)
        return (
            f"{product} is on {plan_name}{price_bit}. {cap_bit}.{consequence}.{anti_trap}"
            f"{carry_on} {view} 'checkout' to switch plan."
        )

    if state == "I":
        used = _used_of_total(usage)
        used_bit = f": {used} used" if used else ""
        return (
            f"{product} is over its {plan_name} allowance{used_bit}. "
            "Calls still work, paid from your credits. "
            f"{view} 'checkout' for a higher limit."
        )

    end_date = get(purchase, "endDate")
    date = format_short_date(end_date)
    days = days_until(end_date, now) if truthy(end_date) else None
    left = _remaining_of_total(usage)
    until = f"runs until {date}" if date else "is cancelled"
    days_bit = f", {days} days away" if days is not None else ""
    left_bit = f", with {left} left" if left else ""
    return (
        f"{product}'s {plan_name} plan is cancelled and {until}{days_bit}{left_bit}. "
        f"Calls stop after that. {view} 'account' to reactivate it."
    )


# ---- narrators --------------------------------------------------------------


ActivateStatus = Literal[
    "activated",
    "already_active",
    "already_purchased",
    "topup_required",
    "payment_required",
    "invalid",
]


def narrate_activate_plan(result: Mapping[str, Any]) -> str:
    """The text ``activate_plan`` answers with, for one activation result."""
    plan_name = get(result, "planName")
    named = str(plan_name) if truthy(plan_name) else "This plan"
    url = get(result, "checkoutUrl")
    checkout = (
        f" [{'Add credits' if '/checkout/topup' in url else 'Open checkout'}]({url})"
        f" ({CHECKOUT_TTL}), or"
        if isinstance(url, str) and url
        else ""
    )
    status = get(result, "status")
    view = f"`{VIEWER_TOOL_NAME}` with view:"
    if status == "activated":
        return (
            f"Activated {plan_name}. Paid tools are available now."
            if truthy(plan_name)
            else "Plan activated. Paid tools are available now."
        )
    if status == "already_purchased":
        return f"{named} is already purchased. Call {view} 'account' to manage it."
    if status == "payment_required":
        return f"{named} requires payment.{checkout} Call {view} 'checkout' to pay."
    if status == "topup_required":
        return (
            f"{named} needs credits before it can activate.{checkout} "
            f"Call {view} 'topup' to add credits."
        )
    if status == "invalid":
        message = get(result, "message")
        if message is not None and message is not UNDEFINED:
            return str(message)
        return f"That planRef is not valid for this product. Call {view} 'checkout' to see plans."
    if status == "already_active":
        balance, cost = get(result, "creditBalance"), get(result, "creditsPerUnit")
        if balance is not UNDEFINED and cost is not UNDEFINED:
            shortfall = max(0, number(cost) - number(balance))
            if shortfall > 0:
                return (
                    f"{named} is already active. Balance {format_count(balance)} credits; "
                    f"this call costs {format_count(cost)} credits — "
                    f"{format_count(shortfall)} short. "
                    f"Call the `{VIEWER_TOOL_NAME}` tool with view: 'topup' to add credits."
                )
        return f"{named} is already active."
    raise SolvaPayError(f"Unknown activation status: {status!r}", code="invalid_argument")


def narrate_manage_account(data: Json, now: datetime | None = None) -> NarratorOutput:
    """The ``account`` view: where the customer stands and what to do next."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    customer = _customer(data)
    plans = _plans(data)
    active = _active_purchase(data)
    limits = get(customer, "limits")
    use_limits = _prefer_limits_plan(active, limits)
    if use_limits:
        catalog = _find_catalog_plan(
            plans, {"reference": get(limits, "planRef")}, get(limits, "planRef")
        )
        plan: Any = catalog or {
            key: value
            for key, value in (
                ("name", get(limits, "planName")),
                ("reference", get(limits, "planRef")),
            )
            if value is not None and value is not UNDEFINED
        }
    else:
        catalog = _find_catalog_plan(plans, get(active, "planSnapshot"), get(active, "planRef"))
        plan = _merge_plan(get(active, "planSnapshot"), catalog)
    plan_shape = _plan_shape(plan)
    state = _account_state(active, limits, plan, now)
    name = product_name(data)
    free = _claimable_free_plan(plans)

    lines = [
        f"**Welcome to {name}**" if state in ("A", "H") else f"**{name} — your account**",
        "",
        _account_body(state, name, plan, plan_shape, active, customer, plans, now),
    ]
    identity = _identity_row(customer)
    if identity:
        lines.append(identity)
    if state in ("A", "H"):
        balance = _balance_row(customer)
        if balance:
            lines.append(balance)
    manage = _manage_row(data)
    if manage:
        lines.append(manage)
    checkout = _checkout_row(data)
    if checkout:
        lines.append(checkout)
    lines.append("")
    lines.append(_recovery_for_state(state, get(free, "reference")))

    links = [link for link in (_hosted_portal_link(data), _checkout_link(data)) if link]
    return NarratorOutput(text="\n".join(lines), links=links)


def _with_checkout(data: Json, lines: list[str]) -> NarratorOutput:
    checkout = _checkout_row(data)
    if checkout:
        lines.append(checkout)
    link = _checkout_link(data)
    return NarratorOutput(text="\n".join(lines), links=[link] if link else [])


def narrate_upgrade(data: Json, now: datetime | None = None) -> NarratorOutput:
    """The ``checkout`` view: the plans on offer."""
    lines = [f"**Upgrade — {product_name(data)}**", ""]
    has_active = _active_purchase(data) is not None
    plans = [plan for plan in _plans(data) if not has_active or not _is_free_plan(plan)]
    if plans:
        lines.append("Plans available:")
        lines.extend(_plans_list_lines(plans))
    else:
        lines.append("No paid plans are configured on this product yet.")
    lines.append("")
    lines.append(_recovery_line(["account"]))
    return _with_checkout(data, lines)


def narrate_topup(data: Json, now: datetime | None = None) -> NarratorOutput:
    """The ``topup`` view: the balance and where to add credits."""
    lines = [f"**Top up — {product_name(data)}**", ""]
    balance = _balance_row(_customer(data))
    if balance:
        lines.append(balance)
    lines.append("")
    lines.append(_recovery_line(["account"]))
    return _with_checkout(data, lines)


def narrate_auto_recharge(data: Json, now: datetime | None = None) -> NarratorOutput:
    """The ``auto-recharge`` view: whether it is on, and the portal link to change it."""
    lines = [f"**Auto-recharge — {product_name(data)}**", ""]
    customer = _customer(data)
    balance = _balance_row(customer)
    if balance:
        lines.append(balance)
    auto = get(customer, "autoRecharge")
    enabled = get(auto, "enabled") is True
    if get(auto, "status") == "failed":
        lines.append("Auto-recharge failed — update your card to resume")
    else:
        lines.append(
            "Auto-recharge is on. It tops your balance up automatically so calls do not fail."
            if enabled
            else "Auto-recharge is off. Turn it on from the link below — it stores a card "
            "and tops your balance up automatically so calls do not fail."
        )
    manage_url = _https_url(get(data, "autoRechargeUrl")) or _https_url(get(data, "portalUrl"))
    if manage_url:
        lines.append(f"Manage: {_named_manage_markdown(manage_url)} ({CHECKOUT_TTL})")
    lines.append("")
    lines.append(_recovery_line(["account"]))
    links = []
    if manage_url:
        links.append(
            {
                "uri": manage_url,
                "name": "Manage auto-recharge" if enabled else "Turn on auto-recharge",
            }
        )
    return NarratorOutput(text="\n".join(lines), links=links)


NARRATORS: dict[str, Callable[[Json, datetime | None], NarratorOutput]] = {
    "checkout": narrate_upgrade,
    "account": narrate_manage_account,
    "topup": narrate_topup,
    "auto-recharge": narrate_auto_recharge,
}

_UI_OPENED: dict[str, Callable[[str], str]] = {
    "topup": lambda p: f"Opened {p} top-up.",
    "checkout": lambda p: f"Opened {p} upgrade.",
    "account": lambda p: f"Opened your {p} account.",
    "auto-recharge": lambda p: f"Opened {p} auto-recharge.",
}


def _placeholder_plan(view: str, data: Json) -> Any:
    if view == "account":
        snapshot = get(_active_purchase(data), "planSnapshot")
        if not truthy(snapshot):
            return None
        return {
            key: get(snapshot, key)
            for key in ("name", "price", "currency", "options", "reference")
            if get(snapshot, key) is not UNDEFINED
        }
    plans = _plans(data)
    return next((plan for plan in plans if not _is_free_plan(plan)), plans[0] if plans else None)


def ui_placeholder(view: str, data: Json) -> str:
    """The one line ``mode: 'ui'`` leads with: still self-sufficient on a text-only host."""
    name = product_name(data)
    parts = [_UI_OPENED[view](name)]
    plan = _placeholder_plan(view, data)
    if plan is not None:
        price = _format_plan_prices(plan)
        label_parts = [
            str(coalesce(get(plan, "name"), "Plan")),
            price if price and not _is_free_plan(plan) else None,
        ]
        label = " · ".join(part for part in label_parts if part)
        if label:
            parts.append(f"{label}.")
    balance = balance_summary(_customer(data))
    if balance:
        parts.append(f"Balance: {balance}.")
    url = _checkout_url(data)
    if url:
        parts.append(f"Checkout: {_named_checkout_markdown(url)} ({CHECKOUT_TTL}).")
    return " ".join(parts)


__all__ = [
    "NARRATORS",
    "VIEWER_TOOL_NAME",
    "NarratorOutput",
    "ViewKind",
    "balance_summary",
    "format_money",
    "narrate_activate_plan",
    "narrate_auto_recharge",
    "narrate_manage_account",
    "narrate_topup",
    "narrate_upgrade",
    "product_name",
    "ui_placeholder",
]
