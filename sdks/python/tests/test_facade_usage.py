"""RED tests for facade ``track_usage`` contract shape (MA-Py-b)."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from solvapay.facade import create_solvapay
from solvapay.results import PayableAllowResult, PayablePaywallResult
from tests.test_facade import StubClient, _fake_decision


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
