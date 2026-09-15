"""RED tests for facade ``track_usage`` contract shape (MA-Py-b)."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from solvapay.errors import PaywallError, SolvaPayError
from solvapay.facade import create_solvapay
from solvapay.results import PayableAllowResult, PayablePaywallResult
from test_facade import StubClient, _fake_decision


def _assert_volatile_fields(payload: dict[str, Any]) -> None:
    assert "duration" in payload
    assert "timestamp" in payload
    metadata = payload.get("metadata")
    assert isinstance(metadata, dict)
    assert "requestId" in metadata


@pytest.fixture(autouse=True)
def _patch_decisions() -> Any:
    with patch("solvapay.facade._call_sync_decision", side_effect=_fake_decision):
        yield


@pytest.mark.asyncio
async def test_allow_track_usage_matches_contract() -> None:
    client = StubClient(within_limits=True, remaining=3)
    sp = create_solvapay(api_client=client)
    result = await sp.gate("cus_abc", product="prd_demo")
    assert isinstance(result, PayableAllowResult)
    result.track_success(duration=12)
    assert len(client.tracked) == 1
    payload = client.tracked[0]
    assert payload["customerRef"] == "cus_abc"
    assert payload["actionType"] == "api_call"
    assert payload["units"] == 1
    assert payload["outcome"] == "success"
    assert payload["productRef"] == "prd_demo"
    assert payload["metadata"]["action"] == "requests"
    _assert_volatile_fields(payload)


@pytest.mark.asyncio
async def test_handler_failure_track_usage_outcome_fail() -> None:
    client = StubClient(within_limits=True, remaining=3)
    sp = create_solvapay(api_client=client)
    result = await sp.gate("cus_abc", product="prd_demo")
    assert isinstance(result, PayableAllowResult)
    result.track_fail(RuntimeError("boom"), duration=8)
    assert len(client.tracked) == 1
    payload = client.tracked[0]
    assert payload["outcome"] == "fail"
    assert payload["actionType"] == "api_call"
    assert payload["units"] == 1
    assert payload["metadata"]["action"] == "requests"
    _assert_volatile_fields(payload)


@pytest.mark.asyncio
async def test_handler_paywall_error_skips_usage() -> None:
    client = StubClient(within_limits=True, remaining=3)
    sp = create_solvapay(api_client=client)
    result = await sp.gate("cus_abc", product="prd_demo")
    assert isinstance(result, PayableAllowResult)
    result.track_fail(PaywallError("Payment required"), duration=8)
    assert client.tracked == []


@pytest.mark.asyncio
async def test_pre_check_gate_tracks_paywall_outcome() -> None:
    client = StubClient(within_limits=False, remaining=0)
    sp = create_solvapay(api_client=client)
    result = await sp.gate("cus_abc", product="prd_demo")
    assert isinstance(result, PayablePaywallResult)
    assert len(client.tracked) == 1
    payload = client.tracked[0]
    assert payload["outcome"] == "paywall"
    assert payload["actionType"] == "api_call"
    assert payload["units"] == 1
    assert payload["productRef"] == "prd_demo"
    assert payload["customerRef"] == "cus_abc"
    assert payload["metadata"]["action"] == "requests"
    _assert_volatile_fields(payload)


@pytest.mark.asyncio
async def test_track_usage_retries_customer_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    client = StubClient(within_limits=True, remaining=3)
    attempts = {"n": 0}
    original = client.track_usage_blocking

    def flaky(args_json: str) -> str:
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise SolvaPayError("404 - Customer not found")
        return original(args_json)

    client.track_usage_blocking = flaky  # type: ignore[method-assign]
    monkeypatch.setattr("solvapay.retry.time.sleep", lambda _seconds: None)
    monkeypatch.setattr(
        "solvapay.retry._next_delay_ms",
        lambda attempt, **_kwargs: 0 if attempt < 2 else None,
    )
    sp = create_solvapay(api_client=client)
    result = await sp.gate("cus_abc", product="prd_demo")
    assert isinstance(result, PayableAllowResult)
    result.track_success(duration=12)
    assert attempts["n"] == 2
    assert len(client.tracked) == 1
