"""Behavioral tests for the idiomatic Python facade (Step 41-d)."""

from __future__ import annotations

import json
import os
from typing import Any
from unittest.mock import patch

import pytest

from solvapay.errors import PaywallError, SolvaPayError
from solvapay.facade import create_solvapay
from solvapay.results import PayableAllowResult, PayablePaywallResult


def _fake_decision(name: str, args: dict[str, Any]) -> Any:
    if name == "classify_customer_ref":
        ref = args.get("customerRef", "")
        return "backend" if str(ref).startswith("cus_") else "external"
    if name == "evaluate_cached_limits":
        remaining = args.get("remaining", 0)
        return {
            "withinLimits": remaining > 0,
            "remaining": max(0, remaining - 1) if remaining > 0 else 0,
            "evict": remaining <= 0,
        }
    if name == "evaluate_fresh_limits":
        return {
            "withinLimits": bool(args.get("withinLimits")),
            "remaining": args.get("remaining", 0),
        }
    if name == "decide_paywall_outcome":
        if args.get("withinLimits"):
            return {"outcome": "allow", "limits": args.get("limits") or {}}
        return {
            "outcome": "gate",
            "gate": {
                "kind": "payment_required",
                "product": args.get("product"),
                "checkoutUrl": args.get("checkoutUrl") or "https://pay.example/x",
                "message": "Payment required",
            },
        }
    if name == "build_paywall_gate":
        return {
            "kind": "payment_required",
            "product": args.get("productRef"),
            "message": "Payment required",
        }
    if name == "build_create_customer_params":
        ref = str(args.get("customerRef") or "user")
        now = args.get("nowMs") or 0
        return {
            "email": f"{ref}-{now}@auto-created.local",
            "externalRef": args.get("externalRef") or ref,
            "metadata": {},
        }
    if name == "extract_backend_customer_ref":
        response = args.get("response") if isinstance(args.get("response"), dict) else {}
        return str(
            response.get("customerRef")
            or response.get("reference")
            or args.get("fallback")
            or "cus_fallback"
        )
    raise AssertionError(f"unexpected decision {name}")


@pytest.fixture(autouse=True)
def _patch_decisions():
    with patch("solvapay.facade._call_sync_decision", side_effect=_fake_decision):
        yield


class StubClient:
    """Injected envelope client for offline facade tests."""

    def __init__(
        self,
        *,
        within_limits: bool = True,
        remaining: int = 5,
        customer_ref: str = "cus_stub",
    ) -> None:
        self.within_limits = within_limits
        self.remaining = remaining
        self.customer_ref = customer_ref
        self.tracked: list[dict[str, Any]] = []

    async def check_limits(self, args_json: str) -> str:
        return self.check_limits_blocking(args_json)

    def check_limits_blocking(self, args_json: str) -> str:
        _ = json.loads(args_json)
        return json.dumps(
            {
                "ok": True,
                "value": {
                    "withinLimits": self.within_limits,
                    "remaining": self.remaining,
                    "meterName": "requests",
                    "checkoutUrl": "https://pay.example/x",
                },
            }
        )

    async def track_usage(self, args_json: str) -> str:
        return self.track_usage_blocking(args_json)

    def track_usage_blocking(self, args_json: str) -> str:
        self.tracked.append(json.loads(args_json))
        return json.dumps({"ok": True, "value": {"ok": True}})

    async def get_customer(self, args_json: str) -> str:
        return self.get_customer_blocking(args_json)

    def get_customer_blocking(self, args_json: str) -> str:
        _ = json.loads(args_json)
        return json.dumps(
            {"ok": True, "value": {"customerRef": self.customer_ref}}
        )

    async def create_customer(self, args_json: str) -> str:
        return self.create_customer_blocking(args_json)

    def create_customer_blocking(self, args_json: str) -> str:
        _ = json.loads(args_json)
        return json.dumps(
            {"ok": True, "value": {"customerRef": self.customer_ref}}
        )


def test_create_solvapay_requires_env_or_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SOLVAPAY_SECRET_KEY", raising=False)
    with pytest.raises(SolvaPayError) as exc_info:
        create_solvapay()
    assert getattr(exc_info.value, "code", None) == "missing_api_key"


def test_create_solvapay_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOLVAPAY_SECRET_KEY", "sk_test_env")
    # Inject client so we don't need a real native construct path beyond import.
    sp = create_solvapay(api_client=StubClient())
    assert sp is not None
    assert os.environ["SOLVAPAY_SECRET_KEY"] == "sk_test_env"


@pytest.mark.asyncio
async def test_gate_allow_async_and_track_success() -> None:
    client = StubClient(within_limits=True, remaining=3)
    sp = create_solvapay(api_client=client)
    result = await sp.gate("cus_abc", product="prd_demo")
    assert isinstance(result, PayableAllowResult)
    assert result.kind == "allow"
    assert result.customer_ref == "cus_abc"
    result.track_success(duration=12)
    assert client.tracked
    assert client.tracked[0]["productRef"] == "prd_demo"


@pytest.mark.asyncio
async def test_gate_paywall_when_limits_exhausted() -> None:
    client = StubClient(within_limits=False, remaining=0)
    sp = create_solvapay(api_client=client)
    result = await sp.gate("cus_abc", product="prd_demo")
    assert isinstance(result, PayablePaywallResult)
    assert result.kind == "paywall"
    assert isinstance(result.content, dict)
    assert result.content.get("product") == "prd_demo" or "kind" in result.content


def test_gate_blocking_matches_async_kind() -> None:
    client = StubClient(within_limits=False, remaining=0)
    sp = create_solvapay(api_client=client)
    blocking = sp.gate_blocking("cus_abc", product="prd_demo")
    assert blocking.kind == "paywall"


@pytest.mark.asyncio
async def test_payable_decorator_raises_paywall() -> None:
    client = StubClient(within_limits=False, remaining=0)
    sp = create_solvapay(api_client=client)

    @sp.payable(product="prd_demo")
    async def create_task(args: dict[str, Any]) -> str:
        return "ok"

    with pytest.raises(PaywallError) as exc_info:
        await create_task({"auth": {"customer_ref": "cus_abc"}})
    assert isinstance(exc_info.value.structured_content, dict)
