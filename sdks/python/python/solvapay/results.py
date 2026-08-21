"""Gate result types for the idiomatic Python facade (Step 41-d / §2.4)."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class PayablePaywallResult:
    """Customer is gated — callers format a 402 from ``content``."""

    kind: Literal["paywall"]
    content: Mapping[str, object]


@dataclass
class PayableAllowResult:
    """Customer is allowed — record usage via ``track_success`` / ``track_fail``."""

    kind: Literal["allow"]
    customer_ref: str
    decision: Mapping[str, object]
    track_success: Callable[..., None]
    track_fail: Callable[..., None]


PayableGateResult = PayablePaywallResult | PayableAllowResult

__all__ = [
    "PayableAllowResult",
    "PayableGateResult",
    "PayablePaywallResult",
]
