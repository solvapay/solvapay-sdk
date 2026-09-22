"""Host-side ``with_retry``: delay math is native; timers stay here."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Callable
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from typing import TypeVar

from solvapay._native import call_native_sync
from solvapay.defaults import _INITIAL_DELAY_MS, _MAX_RETRIES, _RETRY_BACKOFF

_DRIVERS_PATH = Path(__file__).resolve().parent / "drivers.generated.py"
_drivers_spec = spec_from_file_location("solvapay._drivers_generated_retry", _DRIVERS_PATH)
if _drivers_spec is None or _drivers_spec.loader is None:
    raise ImportError(f"cannot load {_DRIVERS_PATH}")
_drivers = module_from_spec(_drivers_spec)
_drivers_spec.loader.exec_module(_drivers)

_T = TypeVar("_T")


def _next_delay_ms(
    attempt: int,
    *,
    max_retries: int,
    initial_delay: int,
    backoff_strategy: str,
) -> int | None:
    delay = call_native_sync(
        "retry_next_delay_ms",
        json.dumps(
            {
                "attempt": attempt,
                "maxRetries": max_retries,
                "initialDelay": initial_delay,
                "backoffStrategy": backoff_strategy,
            }
        ),
    )
    if delay is None:
        return None
    if isinstance(delay, bool) or not isinstance(delay, (int, float)):
        raise TypeError("retry_next_delay_ms must return a number or null")
    return int(delay)


def _delay(attempt: int, max_retries: int, initial_delay: int, backoff_strategy: str) -> int | None:
    return _next_delay_ms(
        attempt,
        max_retries=max_retries,
        initial_delay=initial_delay,
        backoff_strategy=backoff_strategy,
    )


async def _asleep(delay_ms: int) -> None:
    await asyncio.sleep(delay_ms / 1000)


def _sleep(delay_ms: int) -> None:
    time.sleep(delay_ms / 1000)


async def with_retry(
    operation: Callable[[], object],
    *,
    max_retries: int = _MAX_RETRIES,
    initial_delay: int = _INITIAL_DELAY_MS,
    backoff_strategy: str = _RETRY_BACKOFF,
    should_retry: Callable[[Exception, int], bool] | None = None,
    on_retry: Callable[[Exception, int, int], None] | None = None,
) -> _T:
    """Retry an async or sync callable using the frozen native delay table."""
    return await _drivers.run_generated_with_retry_async(
        operation,
        max_retries=max_retries,
        initial_delay=initial_delay,
        backoff_strategy=backoff_strategy,
        next_delay_ms=_delay,
        sleep=_asleep,
        should_retry=should_retry,
        on_retry=on_retry,
    )


def with_retry_blocking(
    operation: Callable[[], _T],
    *,
    max_retries: int = _MAX_RETRIES,
    initial_delay: int = _INITIAL_DELAY_MS,
    backoff_strategy: str = _RETRY_BACKOFF,
    should_retry: Callable[[Exception, int], bool] | None = None,
    on_retry: Callable[[Exception, int, int], None] | None = None,
) -> _T:
    """Blocking twin of :func:`with_retry`."""
    return _drivers.run_generated_with_retry_blocking(
        operation,
        max_retries=max_retries,
        initial_delay=initial_delay,
        backoff_strategy=backoff_strategy,
        next_delay_ms=_delay,
        sleep=_sleep,
        should_retry=should_retry,
        on_retry=on_retry,
    )
