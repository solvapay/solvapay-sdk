"""Dispatch a golden fixture against the Python binding / host adapters."""

from __future__ import annotations

import json
from typing import Any

from solvapay._native import CLIENT_METHODS, SYNC_METHODS, call_native_sync, unwrap_envelope
from solvapay._solvapay import (  # type: ignore[attr-defined]
    SolvaPayClient,
    _construct_sdk_error,
    _verify_webhook_at,
)
from solvapay.errors import PaywallError, SolvaPayError

from .clock import parse_iso8601_utc_to_unix_ms, parse_iso8601_utc_to_unix_secs
from .compare import Outcome, outcome_from_exception, outcome_from_value
from .fixture_loader import Fixture
from .host_adapters import HOST_FNS, invoke_host
from .names import camel_to_snake
from .stub_backend import StubBackend, assert_wire_request

API_KEY = "sk_test_fixture"


def replay_fixture(fixture: Fixture) -> Outcome:
    """Run one fixture and return a normalized outcome (does not assert expect)."""
    fn = fixture.input.fn
    try:
        if fn == "verifyWebhook":
            return outcome_from_value(_dispatch_webhook(fixture))
        if fn == "constructSdkError":
            return _dispatch_construct_sdk_error(fixture)
        if fn in HOST_FNS:
            return outcome_from_value(
                invoke_host(fn, fixture.input.args, clock=fixture.input.clock)
            )
        snake = camel_to_snake(fn)
        if snake in CLIENT_METHODS:
            return _dispatch_client(fixture, snake)
        if snake in SYNC_METHODS:
            return _dispatch_sync_outcome(fixture, snake)
        raise KeyError(f"unsupported fixture fn: {fn}")
    except (SolvaPayError, PaywallError) as exc:
        return outcome_from_exception(exc)


def _dispatch_construct_sdk_error(fixture: Fixture) -> Outcome:
    envelope = json.loads(_construct_sdk_error(json.dumps(dict(fixture.input.args))))
    assert envelope.get("ok") is False, "constructSdkError must return an error envelope"
    error = envelope.get("error")
    assert isinstance(error, dict)
    kind = error.get("kind")
    message = error.get("message") or "SolvaPay error"
    name = "PaywallError" if kind == "Paywall" else "SolvaPayError"
    code = error.get("code")
    if kind == "Transport":
        retryable = error.get("retryable")
        code = "retryable" if retryable is True else "non_retryable"
    status = error.get("status")
    return Outcome(
        ok=False,
        error_name=name,
        error_message=message if isinstance(message, str) else str(message),
        error_status=status if isinstance(status, int) else None,
        error_kind=kind if isinstance(kind, str) else None,
        error_code=code if isinstance(code, str) else None,
    )


def _dispatch_webhook(fixture: Fixture) -> Any:
    args = fixture.input.args
    body = str(args["body"])
    signature = str(args["signature"])
    secret = str(args["secret"])
    clock = fixture.input.clock
    if clock is None:
        raise ValueError("input.clock is required for verifyWebhook")
    now = parse_iso8601_utc_to_unix_secs(clock)
    return json.loads(_verify_webhook_at(body, signature, secret, now))


def _dispatch_sync_outcome(fixture: Fixture, snake: str) -> Outcome:
    args = dict(fixture.input.args)
    if snake == "build_create_customer_params":
        clock = fixture.input.clock
        if clock is None:
            raise ValueError("input.clock is required for buildCreateCustomerParams")
        args["nowMs"] = parse_iso8601_utc_to_unix_ms(clock)
    try:
        value = call_native_sync(snake, json.dumps(args))
    except SolvaPayError as exc:
        # MCP brand / assert failures surface as JS `Error` in fixtures.
        if snake == "assert_response_result":
            return Outcome(ok=False, error_name="Error", error_message=str(exc))
        return outcome_from_exception(exc)

    # validatePublicBaseUrl returns Option<string> on the wire; fixtures expect a throw.
    if snake == "validate_public_base_url" and isinstance(value, str):
        return Outcome(ok=False, error_name="Error", error_message=value)
    return outcome_from_value(value)


def _dispatch_client(fixture: Fixture, snake: str) -> Outcome:
    clock_ms = (
        parse_iso8601_utc_to_unix_ms(fixture.input.clock)
        if fixture.input.clock is not None
        else None
    )
    rng_seed = fixture.input.rng_seed
    args_json = json.dumps(dict(fixture.input.args))

    if fixture.wire is None:
        client = SolvaPayClient._for_fixtures(  # type: ignore[attr-defined]
            API_KEY,
            "http://127.0.0.1:1",
            clock_ms,
            rng_seed,
        )
        try:
            value = unwrap_envelope(getattr(client, f"{snake}_blocking")(args_json))
            return outcome_from_value(value)
        except (SolvaPayError, PaywallError) as exc:
            return outcome_from_exception(exc)

    wire = fixture.wire
    with StubBackend(
        response_status=wire.response.status,
        response_body=wire.response.body,
    ) as stub:
        client = SolvaPayClient._for_fixtures(  # type: ignore[attr-defined]
            API_KEY,
            stub.base_url,
            clock_ms,
            rng_seed,
        )
        try:
            value = unwrap_envelope(getattr(client, f"{snake}_blocking")(args_json))
            outcome = outcome_from_value(value)
        except (SolvaPayError, PaywallError) as exc:
            outcome = outcome_from_exception(exc)

        assert len(stub.captured) == 1, (
            f"wire fixture expected exactly one HTTP call, got {len(stub.captured)}"
        )
        assert_wire_request(stub.captured[0], wire.request)
        return outcome
