from __future__ import annotations

import pytest

from solvapay_mcp.gate_copy import gate_message
from solvapay_mcp.register import DispatchChallengeError


def test_gate_message_uses_the_core_message() -> None:
    assert gate_message({"message": "Upgrade to continue"}) == "Upgrade to continue"


def test_gate_message_uses_the_manifest_copy_when_core_omits_it() -> None:
    assert gate_message({}) == "Payment required"
    assert gate_message({"message": ""}) == "Payment required"


def test_dispatch_challenge_keeps_the_401_envelope() -> None:
    envelope = {
        "kind": "challenge",
        "status": 401,
        "headers": {"WWW-Authenticate": 'Bearer realm="solvapay"'},
        "body": {
            "jsonrpc": "2.0",
            "id": 1,
            "error": {"code": -32001, "message": "Unauthorized"},
        },
    }
    with pytest.raises(DispatchChallengeError) as exc:
        raise DispatchChallengeError(envelope)
    assert exc.value.status == 401
    assert exc.value.jsonrpc_code == -32001
    assert exc.value.headers["WWW-Authenticate"] == 'Bearer realm="solvapay"'
    assert exc.value.body == envelope["body"]
    assert str(exc.value) == "Unauthorized"
