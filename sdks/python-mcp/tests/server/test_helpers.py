from __future__ import annotations

import json
from pathlib import Path

from solvapay_mcp.server.native import native_call

REPO = Path(__file__).resolve().parents[4]
FIXTURES = REPO / "contract" / "fixtures"


def test_checkout_validation_replays_missing_product_fixture() -> None:
    fixture = json.loads(
        (FIXTURES / "helper-checkout" / "checkout-product-missing.json").read_text()
    )
    result = native_call("validate_checkout_session_params", fixture["input"]["args"])
    assert result == fixture["expect"]["result"]
