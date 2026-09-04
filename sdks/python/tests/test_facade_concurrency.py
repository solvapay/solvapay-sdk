"""Host-side customer-dedup concurrency (Phase 4b / bug 5)."""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import patch

import pytest

from solvapay.defaults import _CUSTOMER_DEDUP_MAX_CACHE_SIZE
from solvapay.facade import (
    _CustomerDeduplicator,
    _shared_customer_dedup,
    create_solvapay,
)


def _fake_ensure_customer_next(name: str, args: dict[str, Any]) -> Any:
    if name != "ensure_customer_next":
        raise AssertionError(f"unexpected decision {name}")
    event = args.get("event") if isinstance(args.get("event"), dict) else {}
    state = args.get("state") if isinstance(args.get("state"), dict) else {}
    kind = event.get("kind")
    if kind == "start":
        ref = str(event.get("customerRef") or "")
        return {
            "state": {"customerRef": ref},
            "action": {"kind": "readCustomerCache", "key": ref},
        }
    if kind == "customerCacheEntry":
        if event.get("found"):
            return {
                "state": state,
                "action": {"kind": "resolved", "backendRef": event.get("backendRef")},
            }
        return {
            "state": state,
            "action": {"kind": "getCustomer", "byExternalRef": state.get("customerRef")},
        }
    if kind == "customerLookupResult":
        if event.get("found"):
            customer = event.get("customer") if isinstance(event.get("customer"), dict) else {}
            ref = customer.get("customerRef")
            return {
                "state": state,
                "action": {
                    "kind": "resolved",
                    "backendRef": ref,
                    "cache": {
                        "key": state.get("customerRef"),
                        "backendRef": ref,
                        "timestampMs": event.get("nowMs"),
                    },
                },
            }
        return {
            "state": state,
            "action": {
                "kind": "createCustomer",
                "params": {"externalRef": state.get("customerRef")},
            },
        }
    if kind == "customerCreateResult":
        customer = event.get("customer") if isinstance(event.get("customer"), dict) else {}
        ref = customer.get("customerRef")
        return {
            "state": state,
            "action": {
                "kind": "resolved",
                "backendRef": ref,
                "cache": {
                    "key": state.get("customerRef"),
                    "backendRef": ref,
                    "timestampMs": event.get("nowMs"),
                },
            },
        }
    raise AssertionError(f"unexpected ensure_customer_next event {kind}")


class CountingCreateClient:
    """404 on lookup, then a delayed create so concurrent callers overlap."""

    def __init__(self) -> None:
        self.creates = 0
        self.gets = 0
        self._entered = asyncio.Event()
        self._release = asyncio.Event()
        self._lock = asyncio.Lock()

    async def get_customer(self, args_json: str) -> str:
        _ = json.loads(args_json)
        async with self._lock:
            self.gets += 1
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

    def get_customer_blocking(self, args_json: str) -> str:
        raise AssertionError("blocking get_customer should not run")

    async def create_customer(self, args_json: str) -> str:
        _ = json.loads(args_json)
        async with self._lock:
            self.creates += 1
        self._entered.set()
        await self._release.wait()
        return json.dumps({"ok": True, "value": {"customerRef": "cus_created"}})

    def create_customer_blocking(self, args_json: str) -> str:
        raise AssertionError("blocking create_customer should not run")


@pytest.fixture(autouse=True)
def _reset_customer_dedup() -> None:
    _shared_customer_dedup.clear()
    yield
    _shared_customer_dedup.clear()


@pytest.mark.asyncio
async def test_ensure_customer_create_is_single_flight() -> None:
    client = CountingCreateClient()
    sp = create_solvapay(api_client=client)
    with patch("solvapay.facade._call_sync_decision", side_effect=_fake_ensure_customer_next):
        gathered = asyncio.gather(
            *[sp._ensure_customer("user_new", blocking=False) for _ in range(8)]
        )
        await asyncio.wait_for(client._entered.wait(), timeout=2)
        await asyncio.sleep(0.05)
        assert client.creates == 1
        client._release.set()
        refs = await gathered
    assert list(refs) == ["cus_created"] * 8
    assert client.creates == 1
    assert client.gets == 1


def test_customer_cache_evicts_past_max() -> None:
    dedup = _CustomerDeduplicator()
    assert _CUSTOMER_DEDUP_MAX_CACHE_SIZE == 1000
    for index in range(_CUSTOMER_DEDUP_MAX_CACHE_SIZE + 1):
        dedup.put(f"k{index}", f"cus_{index}", index)
    assert dedup.get_entry("k0") is None
    assert dedup.get_entry(f"k{_CUSTOMER_DEDUP_MAX_CACHE_SIZE}") == (
        f"cus_{_CUSTOMER_DEDUP_MAX_CACHE_SIZE}",
        _CUSTOMER_DEDUP_MAX_CACHE_SIZE,
    )
    assert dedup.size() == _CUSTOMER_DEDUP_MAX_CACHE_SIZE
