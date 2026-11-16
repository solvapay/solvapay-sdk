"""The paywall: classify a limits response, build the gate and its message."""

from .gate import build_paywall_gate
from .state import (
    CHECKOUT_SESSION_TTL_MINUTES,
    PaywallNextAction,
    PaywallStateKind,
    build_gate_message,
    build_nudge_message,
    classify_paywall_state,
    credit_signals,
    next_action_for,
)

__all__ = [
    "CHECKOUT_SESSION_TTL_MINUTES",
    "PaywallNextAction",
    "PaywallStateKind",
    "build_gate_message",
    "build_nudge_message",
    "build_paywall_gate",
    "classify_paywall_state",
    "credit_signals",
    "next_action_for",
]
