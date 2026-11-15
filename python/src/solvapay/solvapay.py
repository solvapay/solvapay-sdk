"""``create_solvapay()``: the SDK's entry point.

```python
from solvapay import create_solvapay

solvapay = create_solvapay()  # reads SOLVAPAY_SECRET_KEY

@solvapay.payable(product="prd_…")
async def summarise(text: str, *, customer_ref: str) -> str:
    ...
```

Configuration comes from arguments, else the environment, the same
variables the TypeScript SDK reads:

- ``SOLVAPAY_SECRET_KEY`` (required): the merchant's secret key.
- ``SOLVAPAY_API_BASE_URL``: defaults to ``https://api.solvapay.com``.
- ``SOLVAPAY_PRODUCT_REF``: the product a paid call is for, when not given.
"""

from __future__ import annotations

import functools
import inspect
import os
from collections.abc import Awaitable, Callable
from typing import Any, ParamSpec, TypeVar

from ._http import DEFAULT_API_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_SECONDS
from .client import AsyncApiClient
from .errors import SolvaPayError
from .paywall.decide import (
    DEFAULT_LIMITS_CACHE_TTL_SECONDS,
    FreeLimit,
    Paywall,
    PaywallDecision,
    PaywallError,
)

P = ParamSpec("P")
R = TypeVar("R")


class SolvaPay:
    """The API client and the paywall for one merchant key."""

    def __init__(self, *, api: AsyncApiClient, product_ref: str | None = None, **paywall: Any):
        self.api = api
        self.product_ref = product_ref
        self.paywall = Paywall(api, **paywall)

    def require_product(self, product: str | None) -> str:
        """The product for a paid call: the one given, else ``SOLVAPAY_PRODUCT_REF``."""
        resolved = product or self.product_ref
        if not resolved:
            raise SolvaPayError(
                "No product: pass product=… or set SOLVAPAY_PRODUCT_REF.",
                code="missing_product",
            )
        return resolved

    async def gate(
        self,
        *,
        customer_ref: str,
        product: str | None = None,
        meter: str | None = None,
        free_limit: FreeLimit | None = None,
        tool_name: str | None = None,
    ) -> PaywallDecision:
        """``allow`` or ``gate`` for one paid call, for a handler you run yourself.

        After an ``allow``, record the outcome with ``paywall.run_allow`` (or
        call ``paywall.track_usage`` yourself).
        """
        return await self.paywall.decide(
            customer_ref=customer_ref,
            product=self.require_product(product),
            meter=meter,
            free_limit=free_limit,
            tool_name=tool_name,
        )

    def payable(
        self,
        *,
        product: str | None = None,
        meter: str | None = None,
        free_limit: FreeLimit | None = None,
        customer_ref_arg: str = "customer_ref",
    ) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
        """Makes an async function paid. Raises ``PaywallError`` (with ``.gate``) when gated.

        The customer is read from the keyword argument named ``customer_ref_arg``.
        """
        resolved_product = self.require_product(product)

        def wrap(handler: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
            if not inspect.iscoroutinefunction(handler):
                raise SolvaPayError("payable() wraps async functions", code="invalid_argument")

            @functools.wraps(handler)
            async def paid(*args: P.args, **kwargs: P.kwargs) -> R:
                customer_ref = kwargs.get(customer_ref_arg)
                if not isinstance(customer_ref, str) or not customer_ref:
                    raise SolvaPayError(
                        f"{handler.__name__}() was called without {customer_ref_arg}=…",
                        code="identity_required",
                        status=401,
                    )
                decision = await self.paywall.decide(
                    customer_ref=customer_ref,
                    product=resolved_product,
                    meter=meter,
                    free_limit=free_limit,
                    tool_name=handler.__name__,
                )
                if decision.gate is not None:
                    raise PaywallError(decision.gate)
                return await self.paywall.run_allow(
                    decision,
                    lambda: handler(*args, **kwargs),
                    product=resolved_product,
                    meter=meter,
                    free_limit=free_limit,
                    tool_name=handler.__name__,
                )

            return paid

        return wrap

    async def aclose(self) -> None:
        await self.api.aclose()

    async def __aenter__(self) -> SolvaPay:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()


def create_solvapay(
    *,
    api_key: str | None = None,
    api_base_url: str | None = None,
    product_ref: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_retries: int = DEFAULT_MAX_RETRIES,
    limits_cache_ttl: float = DEFAULT_LIMITS_CACHE_TTL_SECONDS,
    api: AsyncApiClient | None = None,
) -> SolvaPay:
    """A ``SolvaPay`` from arguments, else the environment. Fails without a secret key."""
    if api is None:
        key = api_key or os.environ.get("SOLVAPAY_SECRET_KEY")
        if not key:
            raise SolvaPayError(
                "A SolvaPay secret key is required: pass api_key=… or set SOLVAPAY_SECRET_KEY.",
                code="missing_secret",
            )
        api = AsyncApiClient(
            api_key=key,
            api_base_url=api_base_url
            or os.environ.get("SOLVAPAY_API_BASE_URL")
            or DEFAULT_API_BASE_URL,
            timeout=timeout,
            max_retries=max_retries,
        )
    return SolvaPay(
        api=api,
        product_ref=product_ref or os.environ.get("SOLVAPAY_PRODUCT_REF") or None,
        limits_cache_ttl=limits_cache_ttl,
    )
