"""Outcome normalization and expectation comparison for the Python contract suite."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from solvapay.errors import PaywallError, SolvaPayError

from .fixture_loader import Fixture, FixtureErrorExpect


@dataclass(frozen=True)
class Outcome:
    ok: bool
    value: Any | None = None
    error_name: str | None = None
    error_message: str | None = None
    error_status: int | None = None
    error_kind: str | None = None
    error_code: str | None = None


def outcome_from_value(value: Any) -> Outcome:
    return Outcome(ok=True, value=value)


def outcome_from_exception(exc: BaseException) -> Outcome:
    if isinstance(exc, PaywallError):
        return Outcome(
            ok=False,
            error_name="PaywallError",
            error_message=str(exc),
            error_kind="Paywall",
        )
    if isinstance(exc, SolvaPayError):
        status = getattr(exc, "status", None)
        code = getattr(exc, "code", None)
        name = type(exc).__name__
        kind = "Api" if isinstance(status, int) else None
        if isinstance(code, str) and code in {
            "invalid_signature",
            "timestamp_too_old",
            "malformed_signature",
            "missing_signature",
            "invalid_payload",
        }:
            kind = "Webhook"
            name = "SolvaPayError"
        return Outcome(
            ok=False,
            error_name=name,
            error_message=str(exc),
            error_status=status if isinstance(status, int) else None,
            error_kind=kind,
            error_code=code if isinstance(code, str) else None,
        )
    return Outcome(
        ok=False,
        error_name=type(exc).__name__,
        error_message=str(exc),
    )


def json_eq(left: Any, right: Any) -> bool:
    """Deep equality with numeric coercion (`25` == `25.0`)."""
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return float(left) == float(right)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(
            json_eq(a, b) for a, b in zip(left, right, strict=True)
        )
    if isinstance(left, dict) and isinstance(right, dict):
        if set(left) != set(right):
            return False
        return all(json_eq(left[key], right[key]) for key in left)
    return left == right


def assert_expect(outcome: Outcome, fixture: Fixture) -> None:
    if fixture.expect_kind == "result":
        assert outcome.ok, (
            f"expected result, got error "
            f"name={outcome.error_name!r} message={outcome.error_message!r}"
        )
        assert json_eq(outcome.value, fixture.expect_result), (
            f"result mismatch:\n  got:      {outcome.value!r}\n"
            f"  expected: {fixture.expect_result!r}"
        )
        return

    expected = fixture.expect_error
    assert expected is not None
    assert not outcome.ok, f"expected error {expected.message!r}, got success {outcome.value!r}"
    _assert_error(outcome, expected)


def _assert_error(actual: Outcome, expected: FixtureErrorExpect) -> None:
    assert actual.error_message == expected.message, (
        f"error message mismatch: got {actual.error_message!r}, expected {expected.message!r}"
    )
    if expected.name is not None:
        assert actual.error_name == expected.name, (
            f"error name mismatch: got {actual.error_name!r}, expected {expected.name!r}"
        )
    if expected.status is not None:
        assert actual.error_status == expected.status, (
            f"error status mismatch: got {actual.error_status!r}, expected {expected.status!r}"
        )
    if expected.kind is not None:
        assert actual.error_kind == expected.kind, (
            f"error kind mismatch: got {actual.error_kind!r}, expected {expected.kind!r}"
        )
    if expected.code is not None:
        assert actual.error_code == expected.code, (
            f"error code mismatch: got {actual.error_code!r}, expected {expected.code!r}"
        )
