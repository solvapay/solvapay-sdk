"""Hand-written stubs for the idiomatic facade (Step 41-d / 42T)."""

from __future__ import annotations

from collections.abc import Callable
from typing import ParamSpec, Protocol, TypeVar

from solvapay.results import PayableGateResult

_P = ParamSpec("_P")
_R = TypeVar("_R")


class ApiClient(Protocol):
    """Minimal async + blocking client surface used by the facade."""

    async def check_limits(self, args_json: str) -> str: ...
    def check_limits_blocking(self, args_json: str) -> str: ...
    async def track_usage(self, args_json: str) -> str: ...
    def track_usage_blocking(self, args_json: str) -> str: ...
    async def get_customer(self, args_json: str) -> str: ...
    def get_customer_blocking(self, args_json: str) -> str: ...
    async def create_customer(self, args_json: str) -> str: ...
    def create_customer_blocking(self, args_json: str) -> str: ...


class SolvaPay:
    """High-level facade over the generated PyO3 binding surface."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        api_base_url: str | None = None,
        limits_cache_ttl: int = 10_000,
        api_client: ApiClient | None = None,
    ) -> None:
        """Construct a facade from credentials or an injected ``ApiClient``."""
        ...
    def payable(
        self, *, product: str, usage_type: str = "requests"
    ) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]:
        """Return a decorator that gates the wrapped callable before invocation."""
        ...
    async def gate(
        self,
        customer_ref: str,
        *,
        product: str,
        usage_type: str = "requests",
    ) -> PayableGateResult:
        """Async paywall gate — returns paywall or allow with trackers."""
        ...
    def gate_blocking(
        self,
        customer_ref: str,
        *,
        product: str,
        usage_type: str = "requests",
    ) -> PayableGateResult:
        """Blocking twin of :meth:`gate`."""
        ...


def create_solvapay(
    *,
    api_key: str | None = None,
    api_base_url: str | None = None,
    limits_cache_ttl: int = 10_000,
    api_client: ApiClient | None = None,
) -> SolvaPay:
    """Factory matching §2.4 / catalog ``create_solvapay``."""
    ...
