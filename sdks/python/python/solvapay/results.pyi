"""Strict stubs for gate result types (Step 42T)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, Protocol


class _TrackSuccess(Protocol):
    def __call__(
        self,
        *,
        duration: float | None = None,
        metadata: Mapping[str, object] | None = None,
    ) -> None: ...


class _TrackFail(Protocol):
    def __call__(
        self,
        err: object,
        *,
        duration: float | None = None,
        metadata: Mapping[str, object] | None = None,
    ) -> None: ...


class PayablePaywallResult:
    kind: Literal["paywall"]
    content: Mapping[str, object]
    def __init__(self, kind: Literal["paywall"], content: Mapping[str, object]) -> None: ...


class PayableAllowResult:
    kind: Literal["allow"]
    customer_ref: str
    decision: Mapping[str, object]
    track_success: _TrackSuccess
    track_fail: _TrackFail
    def __init__(
        self,
        kind: Literal["allow"],
        customer_ref: str,
        decision: Mapping[str, object],
        track_success: _TrackSuccess,
        track_fail: _TrackFail,
    ) -> None: ...


PayableGateResult = PayablePaywallResult | PayableAllowResult
