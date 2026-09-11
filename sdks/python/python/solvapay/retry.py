"""Host-side ``with_retry``: delay math is native; timers stay here."""

from __future__ import annotations

import asyncio
import inspect
import json
import time
from collections.abc import Callable
from typing import TypeVar

from solvapay._native import call_native_sync

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


async def with_retry(
    operation: Callable[[], object],
    *,
    max_retries: int = 2,
    initial_delay: int = 500,
    backoff_strategy: str = "fixed",
    should_retry: Callable[[Exception, int], bool] | None = None,
    on_retry: Callable[[Exception, int, int], None] | None = None,
) -> _T:
    """Retry an async or sync callable using the frozen native delay table."""
    attempt = 0
    while True:
        try:
            result = operation()
            if inspect.isawaitable(result):
                return await result
            return result  # type: ignore[return-value]
        except Exception as err:
            delay = _next_delay_ms(
                attempt,
                max_retries=max_retries,
                initial_delay=initial_delay,
                backoff_strategy=backoff_strategy,
            )
            if delay is None:
                raise
            if should_retry is not None and not should_retry(err, attempt):
                raise
            if on_retry is not None:
                on_retry(err, attempt, delay)
            await asyncio.sleep(delay / 1000)
            attempt += 1


def with_retry_blocking(
    operation: Callable[[], _T],
    *,
    max_retries: int = 2,
    initial_delay: int = 500,
    backoff_strategy: str = "fixed",
    should_retry: Callable[[Exception, int], bool] | None = None,
    on_retry: Callable[[Exception, int, int], None] | None = None,
) -> _T:
    """Blocking twin of :func:`with_retry`."""
    attempt = 0
    while True:
        try:
            return operation()
        except Exception as err:
            delay = _next_delay_ms(
                attempt,
                max_retries=max_retries,
                initial_delay=initial_delay,
                backoff_strategy=backoff_strategy,
            )
            if delay is None:
                raise
            if should_retry is not None and not should_retry(err, attempt):
                raise
            if on_retry is not None:
                on_retry(err, attempt, delay)
            time.sleep(delay / 1000)
            attempt += 1
