from __future__ import annotations

from solvapay_mcp.server.narrate import (
    narrate_activate_plan,
    narrate_manage_account,
    narrate_topup,
    narrate_upgrade,
    ui_placeholder,
)

cycle = {"kind": "billingCycle", "interval": "month"}


def _flat(amount_minor: int, currency: str = "usd") -> dict[str, object]:
    return {"kind": "charge", "per": "flat", "amountMinor": amount_minor, "currency": currency}


def _per_unit(amount_minor: int, currency: str = "usd") -> dict[str, object]:
    return {
        "kind": "charge",
        "per": "unit",
        "amountMinor": amount_minor,
        "currency": currency,
        "meter": "requests",
    }


def base_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "view": "account",
        "productRef": "prd_x",
        "stripePublishableKey": None,
        "returnUrl": "https://example.test/r",
        "merchant": {"displayName": "Acme", "legalName": "Acme Inc."},
        "product": {"reference": "prd_x", "name": "Acme Knowledge Base"},
        "plans": [],
        "customer": None,
    }
    payload.update(overrides)
    return payload


def test_narrate_manage_account_cold_start() -> None:
    text = narrate_manage_account(
        base_payload(
            plans=[
                {
                    "type": "recurring",
                    "name": "Free",
                    "requiresPayment": False,
                    "options": [cycle, _flat(0)],
                },
                {
                    "type": "usage-based",
                    "name": "Starter",
                    "requiresPayment": True,
                    "options": [_per_unit(1)],
                },
                {
                    "type": "recurring",
                    "name": "Unlimited",
                    "price": 50000,
                    "currency": "USD",
                    "requiresPayment": True,
                    "options": [cycle, _flat(50000)],
                },
            ]
        )
    )["text"]
    assert str(text).startswith("**Welcome to Acme Knowledge Base**")
    assert "Free · no payment required" in str(text)
    assert "Starter · pay as you go" in str(text)
    assert "Unlimited · recurring · $500.00" in str(text)
    assert "Docs: docs://solvapay/overview.md" in str(text)


def test_narrate_upgrade_lists_paid_plans() -> None:
    text = narrate_upgrade(
        base_payload(
            plans=[
                {
                    "type": "recurring",
                    "name": "Unlimited",
                    "price": 50000,
                    "currency": "USD",
                    "requiresPayment": True,
                    "options": [cycle, _flat(50000)],
                }
            ]
        )
    )["text"]
    assert str(text).startswith("**Upgrade — Acme Knowledge Base**")
    assert "Unlimited · recurring · $500.00" in str(text)


def test_narrate_topup_includes_presets() -> None:
    text = narrate_topup(
        base_payload(
            customer={
                "ref": "cus_1",
                "purchase": None,
                "paymentMethod": None,
                "balance": {
                    "credits": 5000,
                    "displayCurrency": "USD",
                    "displayExchangeRate": 1,
                    "creditsPerMinorUnit": 100,
                },
                "usage": None,
            }
        )
    )["text"]
    assert "Top up — Acme Knowledge Base" in str(text)
    assert "Balance: 5,000 credits" in str(text)
    assert "Top-up presets:" in str(text)


def test_narrate_activate_plan_lists_plans() -> None:
    text = narrate_activate_plan(
        base_payload(
            plans=[
                {
                    "type": "recurring",
                    "name": "Free",
                    "requiresPayment": False,
                    "options": [cycle, _flat(0)],
                }
            ]
        )
    )["text"]
    assert str(text).startswith("**Activate a plan — Acme Knowledge Base**")
    assert "Free · no payment required" in str(text)


def test_ui_placeholder_includes_balance() -> None:
    placeholder = ui_placeholder(
        "manage_account",
        base_payload(
            customer={
                "ref": "cus_1",
                "purchase": None,
                "paymentMethod": None,
                "balance": {
                    "credits": 100,
                    "displayCurrency": "USD",
                    "displayExchangeRate": 1,
                    "creditsPerMinorUnit": 100,
                },
                "usage": None,
            }
        ),
    )
    assert placeholder.startswith("Opened your Acme Knowledge Base account.")
    assert "Balance:" in placeholder
    assert "in the panel" not in placeholder
