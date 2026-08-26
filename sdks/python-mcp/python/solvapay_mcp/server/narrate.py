from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone

from solvapay_mcp.server.helpers import _format_money
from solvapay_mcp.server.native import native_call

NarratorOutput = dict[str, object]


def _as_mapping(value: object) -> dict[str, object] | None:
    if isinstance(value, Mapping):
        return {str(k): v for k, v in value.items()}
    return None


def _as_list(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


def _product_name(data: Mapping[str, object]) -> str:
    product = _as_mapping(data.get("product"))
    name = product.get("name") if product else None
    return name if isinstance(name, str) and name else "SolvaPay"


def _format_date(iso: object) -> str | None:
    if not isinstance(iso, str) or not iso:
        return None
    try:
        parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return f"{parsed.strftime('%b')} {parsed.day}, {parsed.year}"
    except ValueError:
        return None


def _format_money_minor(amount_minor: object, currency: object) -> str | None:
    if not isinstance(amount_minor, int | float) or not isinstance(currency, str):
        return None
    zero = bool(native_call("is_zero_decimal_currency", {"currency": currency}))
    major = float(amount_minor) if zero else float(amount_minor) / 100
    try:
        return _format_money(major, currency, 0 if zero else 2)
    except ValueError:
        grouped = f"{major:.{0 if zero else 2}f}"
        return f"{currency.upper()} {grouped}"


def _is_plan_purchase(purchase: Mapping[str, object]) -> bool:
    metadata = _as_mapping(purchase.get("metadata")) or {}
    return bool(purchase.get("planSnapshot")) and metadata.get("purpose") != "credit_topup"


def _active_purchase(customer: Mapping[str, object] | None) -> dict[str, object] | None:
    if not customer:
        return None
    purchase = customer.get("purchase")
    purchases = purchase.get("purchases") if isinstance(purchase, Mapping) else None
    if not isinstance(purchases, list):
        return None
    for item in purchases:
        if isinstance(item, Mapping) and _is_plan_purchase(item):
            return dict(item)
    return None


def _balance_row(customer: Mapping[str, object] | None) -> str | None:
    if not customer:
        return None
    balance = customer.get("balance")
    if not isinstance(balance, Mapping):
        return None
    credits = balance.get("credits")
    if not isinstance(credits, int | float):
        credits = 0
    currency = balance.get("displayCurrency")
    credits_per_minor = balance.get("creditsPerMinorUnit")
    display_minor = None
    if (
        isinstance(currency, str)
        and isinstance(credits_per_minor, int | float)
        and credits_per_minor > 0
    ):
        display_minor = native_call(
            "credits_to_display_minor_units",
            {
                "credits": credits,
                "creditsPerMinorUnit": credits_per_minor,
                "displayExchangeRate": balance.get("displayExchangeRate") or 1,
                "displayCurrency": currency,
            },
        )
    money = _format_money_minor(display_minor, currency if isinstance(currency, str) else None)
    fmt = f"{int(credits):,}" if float(credits).is_integer() else f"{credits:,}"
    return f"Balance: {fmt} credits (~{money})" if money else f"Balance: {fmt} credits"


def balance_summary(customer: Mapping[str, object] | None) -> str | None:
    row = _balance_row(customer)
    if not row:
        return None
    return row.removeprefix("Balance: ")


def _is_free_plan(plan: Mapping[str, object]) -> bool:
    return plan.get("requiresPayment") is False


def _plan_type_label(plan: Mapping[str, object]) -> str:
    if _is_free_plan(plan):
        return "no payment required"
    kind = plan.get("type")
    if kind == "usage-based":
        return "pay as you go"
    if kind == "hybrid":
        return "subscription + usage"
    if kind == "one-time":
        return "one-time"
    return "recurring"


def _format_cycle(plan: Mapping[str, object]) -> str:
    cycle = native_call("billing_cycle", {"plan": dict(plan)})
    if not isinstance(cycle, dict):
        return ""
    interval = cycle.get("interval")
    count = cycle.get("count")
    if not interval:
        return ""
    if isinstance(count, int) and count > 1:
        return f"/{count} {interval}s"
    return f"/{interval}"


def _format_plan_prices(plan: Mapping[str, object]) -> str:
    charges = native_call("headline_charges", {"plan": dict(plan)})
    priced: list[str] = []
    if isinstance(charges, list) and charges:
        for charge in charges:
            if isinstance(charge, Mapping):
                formatted = _format_money_minor(charge.get("amountMinor"), charge.get("currency"))
                if formatted:
                    priced.append(formatted)
    else:
        formatted = _format_money_minor(plan.get("price"), plan.get("currency"))
        if formatted:
            priced.append(formatted)
    return " · ".join(priced)


def _plans_list_lines(plans: Sequence[Mapping[str, object]]) -> list[str]:
    lines: list[str] = []
    for plan in plans:
        raw_name = plan.get("name")
        name = raw_name if isinstance(raw_name, str) else "Plan"
        parts: list[str] = [name, _plan_type_label(plan)]
        price = _format_plan_prices(plan)
        if price and not _is_free_plan(plan):
            parts.append(f"{price}{_format_cycle(plan)}")
        trial = native_call("trial_days", {"plan": dict(plan)})
        if isinstance(trial, int | float) and trial:
            parts.append(f"{int(trial)}-day trial")
        lines.append(" · ".join(parts))
    return lines


def _commands_line(commands: list[str]) -> str:
    return "Commands: " + " ".join(f"`/{name}`" for name in commands)


def _hosted_portal_link(data: Mapping[str, object]) -> dict[str, str] | None:
    url = data.get("portalUrl")
    if isinstance(url, str) and url.startswith(("http://", "https://")):
        return {"uri": url, "name": "Open hosted portal"}
    return None


def narrate_manage_account(data: Mapping[str, object]) -> NarratorOutput:
    lines: list[str] = []
    customer = _as_mapping(data.get("customer"))
    active = _active_purchase(customer)
    name = _product_name(data)
    if not active:
        lines.append(f"**Welcome to {name}**")
        lines.append("")
        bal = _balance_row(customer)
        if bal:
            lines.append(bal)
        plans = _as_list(data.get("plans"))
        mapped = [_as_mapping(item) for item in plans]
        plan_maps = [item for item in mapped if item is not None]
        if plan_maps:
            lines.append("No active plan. Plans available:")
            lines.extend(_plans_list_lines(plan_maps))
        else:
            lines.append("No active plan.")
        lines.append("")
        lines.append(_commands_line(["activate_plan", "upgrade"]))
    else:
        lines.append(f"**{name} — your account**")
        lines.append("")
        plan = _as_mapping(active.get("planSnapshot"))
        if plan:
            raw_plan_name = plan.get("name")
            plan_name = raw_plan_name if isinstance(raw_plan_name, str) else "Plan"
            price = _format_money_minor(plan.get("price"), plan.get("currency"))
            raw_cycle = active.get("billingCycle")
            cycle = f"/{raw_cycle}" if isinstance(raw_cycle, str) else ""
            end = _format_date(active.get("endDate"))
            parts: list[str] = [plan_name]
            if price:
                parts.append(f"{price}{cycle}")
            if end:
                parts.append(f"renews {end}")
            lines.append(f"Plan: {' · '.join(parts)}")
        bal = _balance_row(customer)
        if bal:
            lines.append(bal)
        credits_per_call = None
        if plan and plan.get("isMetered") is True:
            credits_per_call = native_call(
                "credits_per_unit_from_balance",
                {"plan": dict(plan), "balance": customer.get("balance") if customer else None},
            )
        if isinstance(credits_per_call, int | float):
            if float(credits_per_call).is_integer():
                fmt = f"{int(credits_per_call):,}"
            else:
                fmt = f"{credits_per_call:,}"
            lines.append(f"Cost per call: {fmt} credits")
        lines.append("")
        lines.append(_commands_line(["topup", "upgrade"]))
    links: list[dict[str, str]] = []
    portal = _hosted_portal_link(data)
    if portal:
        links.append(portal)
    return {"text": "\n".join(lines), "links": links}


def narrate_upgrade(data: Mapping[str, object]) -> NarratorOutput:
    lines = [f"**Upgrade — {_product_name(data)}**", ""]
    plans = _as_list(data.get("plans"))
    mapped = [_as_mapping(item) for item in plans]
    paid = [item for item in mapped if item is not None and not _is_free_plan(item)]
    if paid:
        lines.append("Plans available:")
        lines.extend(_plans_list_lines(paid))
    else:
        lines.append("No paid plans are configured on this product yet.")
    lines.append("")
    lines.append(_commands_line(["manage_account", "topup"]))
    return {"text": "\n".join(lines)}


def narrate_topup(data: Mapping[str, object]) -> NarratorOutput:
    lines = [f"**Top up — {_product_name(data)}**", ""]
    customer = _as_mapping(data.get("customer"))
    bal = _balance_row(customer)
    if bal:
        lines.append(bal)
    currency = "USD"
    balance = _as_mapping(customer.get("balance")) if customer else None
    if balance:
        display = balance.get("displayCurrency")
        if isinstance(display, str) and display:
            currency = display
    presets = [
        item
        for item in (_format_money_minor(m, currency) for m in (1000, 2500, 5000, 10_000))
        if item
    ]
    if presets:
        lines.append("Top-up presets: " + " · ".join(presets))
    lines.append("")
    lines.append(_commands_line(["manage_account"]))
    return {"text": "\n".join(lines)}


def narrate_activate_plan(data: Mapping[str, object]) -> NarratorOutput:
    lines = [f"**Activate a plan — {_product_name(data)}**", ""]
    plans = _as_list(data.get("plans"))
    mapped = [_as_mapping(item) for item in plans]
    plan_maps = [item for item in mapped if item is not None]
    if plan_maps:
        lines.append("Plans available:")
        lines.extend(_plans_list_lines(plan_maps))
    else:
        lines.append("No plans are configured on this product yet.")
    lines.append("")
    lines.append(_commands_line(["manage_account", "topup"]))
    return {"text": "\n".join(lines)}


NARRATORS: dict[str, Callable[[Mapping[str, object]], NarratorOutput]] = {
    "upgrade": narrate_upgrade,
    "manage_account": narrate_manage_account,
    "topup": narrate_topup,
    "activate_plan": narrate_activate_plan,
}

_UI_OPENED: dict[str, Callable[[str], str]] = {
    "topup": lambda p: f"Opened {p} top-up.",
    "upgrade": lambda p: f"Opened {p} upgrade.",
    "manage_account": lambda p: f"Opened your {p} account.",
    "activate_plan": lambda p: f"Opened {p} plan picker.",
}
_UI_PANEL: dict[str, str] = {
    "topup": "Top-up options are shown in the panel.",
    "upgrade": "Plans and checkout are shown in the panel.",
    "manage_account": "Account details are shown in the panel.",
    "activate_plan": "Plan options are shown in the panel.",
}


def _default_ui_opened(product: str) -> str:
    return f"Opened {product}."


def ui_placeholder(tool: str, data: Mapping[str, object]) -> str:
    name = _product_name(data)
    opened = _UI_OPENED.get(tool, _default_ui_opened)(name)
    customer = _as_mapping(data.get("customer"))
    balance = balance_summary(customer)
    parts = [opened]
    if balance:
        parts.append(f"Balance: {balance}.")
    parts.append(_UI_PANEL.get(tool, ""))
    return " ".join(part for part in parts if part)
