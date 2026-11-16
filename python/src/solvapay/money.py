"""Money and credit display, matching ``@solvapay/core``'s credit-display helpers."""

from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal

from ._currencies import PREFIXES
from ._js import js_round

ZERO_DECIMAL = frozenset(
    {
        "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
        "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
    }
)  # fmt: skip

_NBSP = "\u00a0"


def minor_units_per_major(currency: str) -> int:
    return 1 if currency.lower() in ZERO_DECIMAL else 100


def is_zero_decimal_currency(currency: str) -> bool:
    return currency.lower() in ZERO_DECIMAL


def credits_to_display_minor_units(
    *,
    credits: float,
    credits_per_minor_unit: float,
    display_exchange_rate: float,
    display_currency: str,
) -> int | None:
    """Fiat value of a credit balance, in minor units of ``display_currency``."""
    if not credits_per_minor_unit or credits_per_minor_unit <= 0:
        return None
    usd_major = credits / credits_per_minor_unit / 100
    return js_round(
        usd_major * (display_exchange_rate or 1) * minor_units_per_major(display_currency)
    )


def format_minor(amount_minor: float, currency: str) -> str:
    """An amount in minor units, as ``Intl.NumberFormat('en-US', { style: 'currency' })``
    writes it with 0 decimals for zero-decimal currencies and 2 otherwise."""
    divisor = minor_units_per_major(currency)
    digits = 0 if divisor == 1 else 2
    code = currency.upper()
    major = Decimal(repr(float(amount_minor))) / divisor
    if not re.fullmatch(r"[A-Z]{3}", code):
        # Intl throws on a malformed code; the TypeScript SDK then falls back to this.
        fallback = str(js_round(float(major))) if divisor == 1 else f"{float(major):.2f}"
        return f"{code} {fallback}"
    quantized = major.quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    sign = "-" if quantized < 0 else ""
    whole, _, fraction = f"{abs(quantized):f}".partition(".")
    amount = f"{int(whole):,}" + (f".{fraction}" if digits else "")
    prefix = PREFIXES.get(code, code + _NBSP)
    return f"{sign}{prefix}{amount}"
