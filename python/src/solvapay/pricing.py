"""Readers for a plan's ``options[]`` pricing, ported from ``@solvapay/core``'s
``pricing-options.ts``.

Every plan-shaped payload (a catalog plan, the frozen ``planSnapshot`` on a
purchase) describes its pricing as an ordered list of ``options``, each with a
``kind``. These helpers read that list structurally, as the TypeScript SDK
does: an option kind this version does not know is skipped, never an error.
Inputs are JSON objects with the API's camelCase keys.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, TypeGuard

from ._js import UNDEFINED, coalesce, get, js_round

Json = dict[str, Any]


def _is_number(value: Any) -> TypeGuard[float]:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _options(priced: Any) -> list[Mapping[str, Any]]:
    options = get(priced, "options")
    if not isinstance(options, Sequence) or isinstance(options, str):
        return []
    return [option for option in options if isinstance(option, Mapping)]


def _as_charge(option: Mapping[str, Any]) -> Json | None:
    if option.get("kind") != "charge":
        return None
    per, amount, currency = option.get("per"), option.get("amountMinor"), option.get("currency")
    if per not in ("flat", "unit", "seat"):
        return None
    if not _is_number(amount) or not isinstance(currency, str):
        return None
    charge: Json = {"per": per, "amountMinor": amount, "currency": currency}
    if isinstance(option.get("meter"), str):
        charge["meter"] = option["meter"]
    if option.get("oneTime") is True:
        charge["oneTime"] = True
    return charge


def charges(priced: Any) -> list[Json]:
    """Every charge option on the plan, in wire order."""
    return [c for c in (_as_charge(option) for option in _options(priced)) if c is not None]


def headline_charges(priced: Any) -> list[Json]:
    """The base flat charge in each currency, first seen first; setup fees excluded."""
    flat = [charge for charge in charges(priced) if charge["per"] == "flat"]
    base = [charge for charge in flat if not charge.get("oneTime")]
    seen: set[str] = set()
    out = []
    for charge in base or flat:
        key = charge["currency"].upper()
        if key not in seen:
            seen.add(key)
            out.append(charge)
    return out


def per_unit_charge(priced: Any, meter: str | None = None) -> Json | None:
    """The first ``per: 'unit'`` charge, optionally for one meter."""
    unit = [charge for charge in charges(priced) if charge["per"] == "unit"]
    if meter:
        return next((charge for charge in unit if charge.get("meter") == meter), None)
    return unit[0] if unit else None


def billing_cycle(priced: Any) -> Json | None:
    """``{"interval", "count"?}``, or None for a one-time or pure usage plan."""
    for option in _options(priced):
        if option.get("kind") != "billingCycle":
            continue
        interval, count = option.get("interval"), option.get("count")
        if interval not in ("week", "month", "year"):
            continue
        cycle: Json = {"interval": interval}
        if _is_number(count) and count > 1:
            cycle["count"] = count
        return cycle
    return None


def _as_tier(option: Mapping[str, Any]) -> Json | None:
    if option.get("kind") != "tier":
        return None
    start, end, mode = option.get("from"), get(option, "to"), option.get("mode")
    if not _is_number(start):
        return None
    if end is not None and not _is_number(end):
        return None
    if mode not in ("graduated", "volume"):
        return None
    embedded = option.get("charge")
    if not isinstance(embedded, Mapping):
        return None
    charge = _as_charge({**embedded, "kind": "charge"})
    if charge is None:
        return None
    return {"from": start, "to": end, "mode": mode, "charge": charge}


def tier_bands(priced: Any, meter: str | None = None) -> list[Json]:
    """The bands ``meter`` (else the first tiered meter) is priced in, by floor."""
    tiers = [t for t in (_as_tier(option) for option in _options(priced)) if t is not None]
    if not tiers:
        return []
    target = meter if meter is not None else tiers[0]["charge"].get("meter")
    bands = [t for t in tiers if target is None or t["charge"].get("meter") == target]
    return sorted(bands, key=lambda tier: tier["from"])


def tier_meters(priced: Any) -> list[str]:
    seen: list[str] = []
    for option in _options(priced):
        tier = _as_tier(option)
        meter = tier["charge"].get("meter") if tier else None
        if meter and meter not in seen:
            seen.append(meter)
    return seen


def usage_rate(priced: Any, meter: str | None = None) -> Json | None:
    """What one metered unit costs: the per-unit charge, else the first paying band.
    ``tiered`` is True when later bands may cost differently (present it as a floor)."""
    charge = per_unit_charge(priced, meter)
    if charge and charge["amountMinor"] > 0:
        return {**charge, "tiered": False}
    paying = [band for band in tier_bands(priced, meter) if band["charge"]["amountMinor"] > 0]
    if paying:
        return {**paying[0]["charge"], "tiered": len(paying) > 1}
    return {**charge, "tiered": False} if charge else None


def trial_days(priced: Any) -> Any:
    """Free trial length in days, or None."""
    for option in _options(priced):
        if option.get("kind") != "trial":
            continue
        days = option.get("days")
        if _is_number(days) and days > 0:
            return days
    return None


def _first_limit(priced: Any, meter: str | None = None) -> Json | None:
    for option in _options(priced):
        if option.get("kind") != "limit":
            continue
        if meter and option.get("meter") != meter:
            continue
        if not _is_number(option.get("cap")):
            continue
        name = option.get("meter")
        return {"cap": option["cap"], "meter": name if isinstance(name, str) and name else None}
    return None


def included_units(priced: Any, meter: str | None = None) -> Any:
    """Included units from the limit option. ``0`` means unlimited. None without a limit."""
    limit = _first_limit(priced, meter)
    return limit["cap"] if limit else None


def meter_name(priced: Any) -> str | None:
    """The meter the plan counts against: per-unit charge, else tier, else limit."""
    charge = per_unit_charge(priced)
    if charge and charge.get("meter"):
        return str(charge["meter"])
    meters = tier_meters(priced)
    if meters:
        return meters[0]
    limit = _first_limit(priced)
    return limit["meter"] if limit else None


def counts_usage(priced: Any) -> bool:
    """True when the plan counts usage: a per-unit charge, a limit or a tier."""
    if per_unit_charge(priced) is not None:
        return True
    if included_units(priced) is not None:
        return True
    return len(tier_bands(priced)) > 0


def pegged_credits_per_unit(
    charge_minor: float, credits_per_minor_unit: float, usd_to_charge_rate: float = 1
) -> int:
    """Credits per metered unit, as the platform's debit engine computes them."""
    if not charge_minor > 0 or not credits_per_minor_unit > 0:
        return 0
    rate = usd_to_charge_rate if usd_to_charge_rate > 0 else 1
    return js_round((charge_minor / rate) * credits_per_minor_unit)


def _is_metered(priced: Any) -> bool:
    return per_unit_charge(priced) is not None or len(tier_bands(priced)) > 0


def _is_billable_metered(priced: Any) -> bool:
    rate = usage_rate(priced)
    if rate is not None and rate["amountMinor"] > 0:
        return True
    return any(band["charge"]["amountMinor"] > 0 for band in tier_bands(priced))


def _headline_price_minor(priced: Any) -> Any:
    if billing_cycle(priced):
        flat = next(
            (c for c in charges(priced) if c["per"] == "flat" and not c.get("oneTime")), None
        )
    else:
        flat = next((c for c in charges(priced) if c["per"] == "flat"), None)
    return flat["amountMinor"] if flat else 0


def plan_pricing_shape(priced: Any) -> Json:
    """``{"shape", "headlineMinor", "currency", "cycle", "rate"}``; ``shape`` is one of
    free, usage, recurring, hybrid, oneTime."""
    fallback = str(coalesce(get(priced, "currency"), "USD")).upper()
    if not isinstance(priced, Mapping):
        return {
            "shape": "oneTime",
            "headlineMinor": 0,
            "currency": fallback,
            "cycle": None,
            "rate": None,
        }
    if priced.get("requiresPayment") is False:
        return {
            "shape": "free",
            "headlineMinor": 0,
            "currency": fallback,
            "cycle": billing_cycle(priced),
            "rate": usage_rate(priced),
        }
    recurring = billing_cycle(priced) is not None
    metered = _is_metered(priced)
    if recurring and _is_billable_metered(priced):
        shape = "hybrid"
    elif recurring:
        shape = "recurring"
    elif metered:
        shape = "usage"
    else:
        shape = "oneTime"
    headline = headline_charges(priced)
    currency = coalesce(
        headline[0]["currency"] if headline else UNDEFINED, get(priced, "currency"), "USD"
    )
    return {
        "shape": shape,
        "headlineMinor": _headline_price_minor(priced),
        "currency": str(currency).upper(),
        "cycle": billing_cycle(priced) if recurring else None,
        "rate": usage_rate(priced) if metered else None,
    }


def credits_per_unit_from_balance(priced: Any, balance: Any, meter: str | None = None) -> Any:
    """Credits per metered call against the customer's balance peg; None when the charge is
    not in the balance's display currency (the SDK does not hold that FX rate)."""
    charge = usage_rate(priced, meter)
    if not charge or not charge["amountMinor"] > 0:
        return None
    display_currency = get(balance, "displayCurrency")
    per_minor = get(balance, "creditsPerMinorUnit")
    if not isinstance(display_currency, str) or not _is_number(per_minor):
        return None
    if charge["currency"].upper() != display_currency.upper():
        return None
    credits = pegged_credits_per_unit(
        charge["amountMinor"], per_minor, coalesce(get(balance, "displayExchangeRate"), 1)
    )
    return credits if credits > 0 else None
