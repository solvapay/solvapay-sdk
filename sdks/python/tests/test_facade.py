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
    if name == "gate_next":
        event = args.get("event") if isinstance(args.get("event"), dict) else {}
        state = args.get("state") if isinstance(args.get("state"), dict) else {}
        kind = event.get("kind")
        if kind == "start":
            ref = str(event.get("customerRef") or "")
            product = event.get("product")
            usage = event.get("usageType") or "requests"
            started = event.get("startedMs")
            if ref.startswith("cus_") or ref == "anonymous":
                key = f"{ref}:{product}:{usage}"
                return {
                    "state": {
                        "product": product,
                        "meterName": usage,
                        "originalCustomerRef": ref,
                        "backendRef": ref,
                        "startedMs": started,
                        "limitsKey": key,
                    },
                    "action": {"kind": "lookupCache", "key": key},
                }
            return {
                "state": {
                    "product": product,
                    "meterName": usage,
                    "originalCustomerRef": ref,
                    "startedMs": started,
                },
                "action": {"kind": "ensureCustomer", "customerRef": ref},
            }
        if kind == "customerResolved":
            backend = event.get("backendRef")
            product = state.get("product")
            meter = state.get("meterName")
            key = f"{backend}:{product}:{meter}"
            new_state = {**state, "backendRef": backend, "limitsKey": key}
            return {"state": new_state, "action": {"kind": "lookupCache", "key": key}}
        if kind == "cacheMiss":
            return {
                "state": state,
                "action": {
                    "kind": "checkLimits",
                    "customerRef": state.get("backendRef"),
                    "productRef": state.get("product"),
                    "meterName": state.get("meterName"),
                    "includeCheckoutSession": True,
                    "cacheDeleteKey": state.get("limitsKey"),
                },
            }
        if kind == "cacheHit":
            remaining = event.get("remaining") or 0
            limits = event.get("limits") or {}
            within = remaining > 0
            backend = state.get("backendRef")
            if within:
                return {
                    "state": state,
                    "action": {
                        "kind": "done",
                        "outcome": "allow",
                        "customerRef": backend,
                        "product": state.get("product"),
                        "meterName": state.get("meterName"),
                        "limits": limits,
                        "cache": {
                            "op": "updateRemaining",
                            "key": state.get("limitsKey"),
                            "remaining": max(0, remaining - 1),
                        },
                    },
                }
            return {
                "state": state,
                "action": {
                    "kind": "done",
                    "outcome": "gate",
                    "customerRef": backend,
                    "product": state.get("product"),
                    "meterName": state.get("meterName"),
                    "limits": limits,
                    "gate": {
                        "kind": "payment_required",
                        "product": state.get("product"),
                        "checkoutUrl": "https://pay.example/x",
                        "message": "Payment required",
                    },
                },
            }
        if kind == "limitsResult":
            limits = event.get("limits") if isinstance(event.get("limits"), dict) else {}
            within = bool(limits.get("withinLimits"))
            backend = state.get("backendRef")
            if within:
                remaining = limits.get("remaining") or 0
                return {
                    "state": state,
                    "action": {
                        "kind": "done",
                        "outcome": "allow",
                        "customerRef": backend,
                        "product": state.get("product"),
                        "meterName": state.get("meterName"),
                        "limits": limits,
                        "cache": {
                            "op": "set",
                            "key": state.get("limitsKey"),
                            "remaining": max(0, remaining - 1) if remaining else 0,
                            "limits": limits,
                            "timestamp": event.get("nowMs"),
                        },
                    },
                }
            return {
                "state": state,
                "action": {
                    "kind": "done",
                    "outcome": "gate",
                    "customerRef": backend,
                    "product": state.get("product"),
                    "meterName": state.get("meterName"),
                    "limits": limits,
                    "gate": {
                        "kind": "payment_required",
                        "product": state.get("product"),
                        "checkoutUrl": limits.get("checkoutUrl") or "https://pay.example/x",
                        "message": "Payment required",
                    },
                    "track": {
                        "customerRef": backend,
                        "productRef": state.get("product"),
                        "action": state.get("meterName"),
                        "outcome": "paywall",
                        "durationMs": 0,
                    },
                },
            }
        raise AssertionError(f"unexpected gate_next event {kind}")
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
    if name == "resolve_check_limits_params":
        usage = args.get("usageType") or args.get("meterName") or "requests"
        return {"productRef": args.get("productRef"), "meterName": usage}
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


def test_create_solvapay_defers_native_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOLVAPAY_SECRET_KEY", "sk_test_env")
    sp = create_solvapay(api_key="sk_test_env", api_base_url="https://api.example.test")
    assert sp.get_api_client is not None
    assert getattr(sp, "_bound_client") is None


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
async def test_gate_missing_backend_customer_ref_is_actionable() -> None:
    class MissingCustomerClient(StubClient):
        def get_customer_blocking(self, args_json: str) -> str:
            _ = json.loads(args_json)
            return json.dumps(
                {
                    "ok": False,
                    "error": {
                        "kind": "Api",
                        "status": 404,
                        "code": "not_found",
                        "message": "Customer not found",
                    },
                }
            )

        def check_limits_blocking(self, args_json: str) -> str:
            _ = json.loads(args_json)
            return json.dumps(
                {
                    "ok": False,
                    "error": {
                        "kind": "Api",
                        "status": 404,
                        "code": "not_found",
                        "message": "Customer not found",
                    },
                }
            )

    missing_ref = "cus_RG8I0GVR"
    api_base = "https://jack-local.ngrok.app"
    client = MissingCustomerClient()
    sp = create_solvapay(api_client=client, api_base_url=api_base)
    with pytest.raises(SolvaPayError) as exc_info:
        await sp.gate(missing_ref, product="prd_demo")
    message = str(exc_info.value)
    assert missing_ref in message or "not found" in message.lower()
    assert getattr(exc_info.value, "status", None) == 404


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
