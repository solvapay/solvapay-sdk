"""Hand-written stubs for the idiomatic facade (Step 41-d / 42T)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
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
    def get_api_client(self) -> ApiClient:
        """Return the bound client, constructing the native client on first use."""
        ...
    def track_usage(self, params: dict[str, object]) -> None:
        """Record a usage event through the same retry path as ``payable`` handlers."""
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


# Re-exported from the generated `drivers.generated.py`, which `facade.py` loads
# by path because its filename is not a valid module name. Mirror of the
# protocols and signatures dto-gen emits there.
class AsyncGateDriverHost(Protocol):
    def ensure_customer(self, customer_ref: str) -> Awaitable[str]: ...
    def read_limits_cache(self, key: str) -> dict[str, object] | None: ...
    def check_limits(self, action: dict[str, object]) -> Awaitable[object]: ...
    def apply_cache(self, cache: object) -> None: ...
    def now_ms(self) -> int: ...


class PayableDriverHost(Protocol):
    def run_gate(self, action: dict[str, object]) -> dict[str, object]: ...
    def invoke_handler(self, action: dict[str, object]) -> dict[str, object]: ...
    def track_usage(self, request: object) -> None: ...
    def now_ms(self) -> int: ...
    def random_unit(self) -> float: ...


class AsyncPayableDriverHost(Protocol):
    def run_gate(self, action: dict[str, object]) -> Awaitable[dict[str, object]]: ...
    def invoke_handler(self, action: dict[str, object]) -> Awaitable[dict[str, object]]: ...
    def track_usage(self, request: object) -> Awaitable[None]: ...
    def now_ms(self) -> int: ...
    def random_unit(self) -> float: ...


async def run_generated_gate_loop_async(
    gate_next: Callable[[object, object], dict[str, object]],
    host: AsyncGateDriverHost,
    start_event: dict[str, object],
) -> dict[str, object]:
    """Drive the generated gate loop, delegating I/O to ``host``."""
    ...


def run_generated_payable_loop(
    payable_next: Callable[[object, object], dict[str, object]],
    host: PayableDriverHost,
    start_event: dict[str, object],
) -> object:
    """Drive the generated payable loop, delegating I/O to ``host``."""
    ...


async def run_generated_payable_loop_async(
    payable_next: Callable[[object, object], dict[str, object]],
    host: AsyncPayableDriverHost,
    start_event: dict[str, object],
) -> object:
    """Async twin of :func:`run_generated_payable_loop`."""
    ...
