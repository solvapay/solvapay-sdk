"""Testable get-merchant example logic (Examples deliverable)."""

from __future__ import annotations

import json
from typing import Any


def run(client: Any) -> dict[str, Any]:
    """Fetch the merchant profile via the low-level client, unwrapping the JSON envelope."""
    envelope = json.loads(client.get_merchant_blocking("{}"))
    if not envelope.get("ok"):
        raise RuntimeError(f"get_merchant failed: {envelope.get('error')}")
    value = envelope.get("value")
    if not isinstance(value, dict):
        raise RuntimeError("get_merchant returned a non-object value")
    return value
