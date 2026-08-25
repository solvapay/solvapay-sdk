from __future__ import annotations

import asyncio

from main import run_echo


def test_allow_round_trip() -> None:
    result = asyncio.run(run_echo(within_limits=True, message="hello"))
    assert result["content"][0]["text"] == '{"echo":"hello"}'
    assert result["structuredContent"] == {"echo": "hello"}


def test_gate_round_trip() -> None:
    result = asyncio.run(run_echo(within_limits=False, message="hello"))
    assert result["isError"] is False
    assert result["structuredContent"]["kind"] == "payment_required"
    assert "upgrade" in result["content"][0]["text"]
