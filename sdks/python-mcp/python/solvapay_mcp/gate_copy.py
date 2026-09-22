"""Paywall narration taken from the core gate, with the manifest fallback."""

from __future__ import annotations

from collections.abc import Mapping

from solvapay.defaults import _PAYMENT_REQUIRED


def gate_message(content: Mapping[str, object]) -> str:
    """Return the core gate message, or the frozen payment-required copy when empty."""
    message = content.get("message")
    if isinstance(message, str) and message != "":
        return message
    return _PAYMENT_REQUIRED
