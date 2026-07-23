"""Host-side adapters for orchestration fixtures not on the public Python surface.

Mirrors `rust/tools/fixture-runner` bindings for `withRetry`,
`pollBalanceUntilIncreased`, and delay-table constants. Auth / SdkError
construction go through native `_fixture_*` helpers.
"""

from __future__ import annotations

import json
from typing import Any, Mapping

from solvapay._native import call_native_sync, unwrap_envelope
from solvapay._solvapay import _resolve_authenticated_user  # type: ignore[attr-defined]

from .clock import parse_iso8601_utc_to_unix_secs

TOPUP_BALANCE_POLL_DELAYS_MS = [500, 1000, 2000, 4000]
BALANCE_RECONCILE_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 16000]

HOST_FNS = frozenset(
    {
        "withRetry",
        "pollBalanceUntilIncreased",
        "TOPUP_BALANCE_POLL_DELAYS_MS",
        "BALANCE_RECONCILE_DELAYS_MS",
        "resolveAuthenticatedUser",
    }
)


def invoke_host(fn: str, args: Mapping[str, Any], *, clock: str | None) -> Any:
    if fn == "withRetry":
        return _invoke_with_retry(args)
    if fn == "pollBalanceUntilIncreased":
        return _invoke_poll_balance(args)
    if fn == "TOPUP_BALANCE_POLL_DELAYS_MS":
        return list(TOPUP_BALANCE_POLL_DELAYS_MS)
    if fn == "BALANCE_RECONCILE_DELAYS_MS":
        return list(BALANCE_RECONCILE_DELAYS_MS)
    if fn == "resolveAuthenticatedUser":
        payload = dict(args)
        if clock is not None:
            payload["nowUnixSecs"] = parse_iso8601_utc_to_unix_secs(clock)
        elif "nowUnixSecs" not in payload:
            payload["nowUnixSecs"] = 1_700_000_000
        return unwrap_envelope(_resolve_authenticated_user(json.dumps(payload)))
    raise KeyError(f"no host adapter for {fn}")


def _invoke_with_retry(args: Mapping[str, Any]) -> dict[str, Any]:
    attempts = args.get("attempts")
    if not isinstance(attempts, list) or not attempts:
        raise ValueError("withRetry args.attempts must be a non-empty array")
    options = args.get("options") if isinstance(args.get("options"), dict) else {}
    max_retries = int(options.get("maxRetries", 2))
    initial_delay = int(options.get("initialDelay", 500))
    backoff = str(options.get("backoffStrategy", "fixed"))
    should_retry = args.get("shouldRetry")
    on_retry = args.get("onRetry") is True

    events: list[str] = []
    delays: list[int] = []
    call_index = 0

    while True:
        attempt = call_index
        events.append(f"call:{attempt}")
        spec = attempts[call_index] if call_index < len(attempts) else None
        call_index += 1

        if isinstance(spec, dict) and "resolve" in spec:
            return {
                "delays": delays,
                "events": events,
                "outcome": {"type": "resolved", "value": spec["resolve"]},
            }

        if isinstance(spec, dict) and "throw" in spec:
            error_message = str(spec["throw"])
        elif isinstance(spec, dict) and "throwRaw" in spec:
            error_message = _js_string_coerce(spec["throwRaw"])
        elif spec is None:
            message = f"withRetry scenario exhausted attempts at call:{attempt}"
            return {
                "delays": delays,
                "events": events,
                "outcome": {"type": "rejected", "name": "Error", "message": message},
            }
        else:
            raise ValueError(f"unsupported withRetry attempt spec: {spec!r}")

        delay = call_native_sync(
            "retry_next_delay_ms",
            json.dumps(
                {
                    "attempt": attempt,
                    "maxRetries": max_retries,
                    "initialDelay": initial_delay,
                    "backoffStrategy": backoff,
                }
            ),
        )
        if delay is None:
            return {
                "delays": delays,
                "events": events,
                "outcome": {
                    "type": "rejected",
                    "name": "Error",
                    "message": error_message,
                },
            }

        if should_retry is not None:
            allow = _decide_should_retry(should_retry, attempt)
            events.append(f"shouldRetry:{attempt}={str(allow).lower()}")
            if not allow:
                return {
                    "delays": delays,
                    "events": events,
                    "outcome": {
                        "type": "rejected",
                        "name": "Error",
                        "message": error_message,
                    },
                }

        if on_retry:
            events.append(f"onRetry:{attempt}")

        delays.append(int(delay))
        events.append(f"sleep:{int(delay)}")


def _decide_should_retry(spec: Any, attempt: int) -> bool:
    if spec == "always":
        return True
    if spec == "never":
        return False
    if isinstance(spec, dict):
        veto = spec.get("vetoAt")
        if isinstance(veto, list):
            return attempt not in {int(x) for x in veto}
    raise ValueError(f"unsupported shouldRetry spec: {spec!r}")


def _js_string_coerce(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)
    # Arrays / objects mirror JS String(obj) → "[object Object]"
    return "[object Object]"


def _invoke_poll_balance(args: Mapping[str, Any]) -> dict[str, Any]:
    baseline = args.get("baseline")
    if not isinstance(baseline, (int, float)):
        raise ValueError("pollBalanceUntilIncreased args.baseline must be a number")
    observations = args.get("observations")
    if not isinstance(observations, list):
        raise ValueError("pollBalanceUntilIncreased args.observations must be an array")
    delays = _parse_poll_delays(args.get("delays"))

    recorded: list[int] = []
    obs_index = 0
    for delay in delays:
        recorded.append(int(delay))
        if obs_index >= len(observations):
            continue
        item = observations[obs_index]
        obs_index += 1
        if not isinstance(item, dict):
            raise ValueError("observation must be an object")
        if "throw" in item:
            continue
        if "credits" not in item:
            raise ValueError("observation needs credits or throw")
        credits = item["credits"]
        if not isinstance(credits, (int, float)):
            raise ValueError("observation.credits must be a number")
        delta = float(credits) - float(baseline)
        if delta > 0:
            credits_added: int | float = int(delta) if float(delta).is_integer() else delta
            return {"delays": recorded, "result": {"creditsAdded": credits_added}}
    return {"delays": recorded, "result": None}


def _parse_poll_delays(raw: Any) -> list[int]:
    # Missing delays → reconcile table (TS / fixture-runner default).
    if raw is None or raw == "reconcile":
        return list(BALANCE_RECONCILE_DELAYS_MS)
    if raw == "topup":
        return list(TOPUP_BALANCE_POLL_DELAYS_MS)
    if isinstance(raw, list):
        return [int(x) for x in raw]
    raise ValueError(f"unsupported poll delays: {raw!r}")
