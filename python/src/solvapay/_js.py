"""JavaScript value semantics, for code ported from the TypeScript SDK.

The paywall code builds its output from JSON with JavaScript's rules: a key
that is missing (``undefined``) is not the same as a key set to ``null``,
``??`` falls through both, and ``0`` and ``""`` are falsy. Porting it with
these helpers keeps every branch identical, which the conformance suite then
checks.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Final


class _Undefined:
    """JavaScript ``undefined``: a key that is not there. Falsy."""

    _instance: _Undefined | None = None

    def __new__(cls) -> _Undefined:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __bool__(self) -> bool:
        return False

    def __repr__(self) -> str:
        return "undefined"


UNDEFINED: Final = _Undefined()


def get(obj: Any, key: str) -> Any:
    """``obj?.key``: UNDEFINED when obj is null/undefined or the key is missing."""
    if isinstance(obj, Mapping) and key in obj:
        return obj[key]
    return UNDEFINED


def nullish(value: Any) -> bool:
    return value is None or value is UNDEFINED


def coalesce(*values: Any) -> Any:
    """``a ?? b ?? c``: the first value that is neither null nor undefined, else the last."""
    for value in values[:-1]:
        if not nullish(value):
            return value
    return values[-1]


def truthy(value: Any) -> bool:
    if value is UNDEFINED or value is None or value is False:
        return False
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return value != 0 and not math.isnan(value)
    if isinstance(value, str):
        return value != ""
    return True


def number(value: Any) -> float:
    """A value as a JavaScript relational operator sees it: null is 0, undefined is NaN."""
    if value is None:
        return 0.0
    if value is UNDEFINED:
        return math.nan
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    return math.nan


def num_str(value: Any) -> str:
    """``String(n)`` for a number: 3.0 prints as "3", as JavaScript does."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return repr(value)
    if value is None:
        return "null"
    if value is UNDEFINED:
        return "undefined"
    return str(value)


def js_round(value: float) -> int:
    """``Math.round``: halves round toward +infinity."""
    return math.floor(value + 0.5)


def to_locale_string(value: float) -> str:
    """``n.toLocaleString('en-US')``: grouped, at most 3 fraction digits, half away from zero."""
    quantized = Decimal(repr(float(value))).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    sign = "-" if quantized < 0 else ""
    whole, _, fraction = f"{abs(quantized):f}".partition(".")
    fraction = fraction.rstrip("0")
    grouped = f"{int(whole):,}"
    return f"{sign}{grouped}.{fraction}" if fraction else f"{sign}{grouped}"


def compact(items: Mapping[str, Any]) -> dict[str, Any]:
    """An object literal as JSON.stringify writes it: undefined values drop out."""
    return {key: value for key, value in items.items() if value is not UNDEFINED}
