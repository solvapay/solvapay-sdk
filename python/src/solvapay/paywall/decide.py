"""Whether a paid call may go ahead, ported from ``@solvapay/server``'s ``paywall.ts``.

``Paywall.decide`` resolves the customer, checks the limits (from a short
cache, or the API), and answers ``allow`` or ``gate``. ``Paywall.run_allow``
runs the handler for an ``allow`` and records the usage. The rules about
plans, credits and limits stay in the API; this module only carries the
answer to the caller.

Deliberate differences from the TypeScript SDK (see conformance/README.md):

- Errors are told apart by status and code, never by message text.
- A lookup error other than 404 fails, instead of being logged and skipped.
- A 409 on customer creation is resolved by one lookup by ``externalRef``;
  if that finds nothing it fails with ``customer_conflict``. The platform
  links an email-matched customer itself, so the TypeScript SDK's retry
  with a generated email (which could create a duplicate) is not ported.
- The customer cache belongs to the client instance, so two clients with
  different keys in one process never share a customer.
"""

from __future__ import annotations

import asyncio
import logging
import re
import secrets
import string
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, TypeVar

from .._js import get, truthy
from ..client import AsyncApiClient
from ..errors import SolvaPayError
from .gate import build_paywall_gate

logger = logging.getLogger("solvapay")

T = TypeVar("T")
Json = dict[str, Any]

DEFAULT_LIMITS_CACHE_TTL_SECONDS = 10.0
_ALPHABET = string.ascii_lowercase + string.digits


FREE_METER_PATTERN = r"^free-[a-z0-9-]+$"


@dataclass(frozen=True)
class FreeLimit:
    """A free allowance the platform meters: ``cap`` calls per ``scope``.

    ``meter`` must match ``free-[a-z0-9-]+``. A ``rolling_window`` scope needs
    ``window_days``.
    """

    cap: int
    scope: Literal["rolling_window", "lifetime"]
    meter: str = "free-requests"
    window_days: int | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "meter", self.meter.lower())
        if not re.fullmatch(FREE_METER_PATTERN, self.meter):
            raise SolvaPayError(
                f"Free meter {self.meter!r} must match {FREE_METER_PATTERN}",
                code="invalid_free_limit",
            )
        if self.cap <= 0:
            raise SolvaPayError("A free limit's cap must be above 0", code="invalid_free_limit")
        if self.scope == "rolling_window" and not self.window_days:
            raise SolvaPayError(
                "A rolling_window free limit needs window_days", code="invalid_free_limit"
            )

    def wire(self) -> Json:
        out: Json = {"meter": self.meter, "cap": self.cap, "scope": self.scope}
        if self.window_days is not None:
            out["windowDays"] = self.window_days
        return out


@dataclass
class PaywallDecision:
    """``allow``: run the handler. ``gate``: return ``gate`` to the caller instead."""

    outcome: Literal["allow", "gate"]
    customer_ref: str
    request_id: str
    limits: Json | None
    gate: Json | None = None
    consequence: Literal["overage"] | None = None

    @property
    def allowed(self) -> bool:
        return self.outcome == "allow"


class PaywallError(SolvaPayError):
    """Raised when a paid call is gated. ``gate`` is the paywall to show the customer."""

    def __init__(self, gate: Json) -> None:
        super().__init__(str(gate.get("message") or "Payment required"), code=str(gate["kind"]))
        self.gate = gate


@dataclass
class _CacheEntry:
    remaining: int
    timestamp: float
    limits: Json


@dataclass
class _Usage:
    meter_name: str | None = None
    usage_class: Literal["included", "overage"] | None = None
    extra: Json = field(default_factory=dict)


def _request_id() -> str:
    random = "".join(secrets.choice(_ALPHABET) for _ in range(9))
    return f"solvapay_{int(time.time() * 1000)}_{random}"


class Paywall:
    """Decides paid calls for one API client."""

    def __init__(
        self,
        api: AsyncApiClient,
        *,
        limits_cache_ttl: float = DEFAULT_LIMITS_CACHE_TTL_SECONDS,
    ) -> None:
        self.api = api
        self.limits_cache_ttl = limits_cache_ttl
        self._customers: dict[str, str] = {}
        self._customer_lookups: dict[str, asyncio.Future[str]] = {}
        self._limits: dict[str, _CacheEntry] = {}
        self._limits_fetches: dict[str, asyncio.Future[Json]] = {}
        self._claims: dict[str, int] = {}

    # Customers ---------------------------------------------------------------

    async def ensure_customer(
        self,
        customer_ref: str,
        external_ref: str | None = None,
        *,
        email: str | None = None,
        name: str | None = None,
    ) -> str:
        """The SolvaPay customer (``cus_…``) for your user, created on first use."""
        if customer_ref == "anonymous" or customer_ref.startswith("cus_"):
            return customer_ref
        if customer_ref in self._customers:
            return self._customers[customer_ref]
        key = external_ref or customer_ref
        pending = self._customer_lookups.get(key)
        if pending is None:
            pending = asyncio.ensure_future(
                self._resolve_customer(customer_ref, external_ref, email, name)
            )
            self._customer_lookups[key] = pending
            pending.add_done_callback(lambda _: self._customer_lookups.pop(key, None))
        ref = await asyncio.shield(pending)
        self._customers[customer_ref] = ref
        return ref

    async def _find_by_external_ref(self, external_ref: str) -> str | None:
        try:
            customer = await self.api.get_customer_by_query(external_ref=external_ref)
        except SolvaPayError as error:
            if error.status == 404:
                return None
            raise
        return customer.reference

    async def _resolve_customer(
        self, customer_ref: str, external_ref: str | None, email: str | None, name: str | None
    ) -> str:
        if external_ref:
            found = await self._find_by_external_ref(external_ref)
            if found:
                return found
        body: Json = {
            "email": email or f"{customer_ref}-{int(time.time() * 1000)}@auto-created.local",
            "metadata": {},
        }
        if name:
            body["name"] = name
        if external_ref:
            body["externalRef"] = external_ref
        try:
            created = await self.api.create_customer(body=body)
        except SolvaPayError as error:
            if error.status != 409:
                raise
            found = await self._find_by_external_ref(external_ref) if external_ref else None
            if found:
                return found
            raise SolvaPayError(
                f"A customer for {customer_ref} already exists and is not linked to it: "
                f"{error.message}. Link the existing customer to this externalRef.",
                code="customer_conflict",
                status=409,
                body=error.body,
            ) from error
        return created.reference

    # Limits ------------------------------------------------------------------

    def invalidate_limits(self, customer_ref: str, product: str | None = None) -> None:
        """Drops cached limits for a customer (every product, or one)."""
        aliases = {customer_ref}
        if customer_ref in self._customers:
            aliases.add(self._customers[customer_ref])
        if not customer_ref.startswith("cus_"):
            aliases.add(f"cus_{customer_ref}")
        for key in list(self._limits):
            ref, _, rest = key.partition(":")
            if ref in aliases and (product is None or rest.split(":", 1)[0] == product):
                del self._limits[key]

    async def _fetch_limits(self, key: str, body: Json) -> Json:
        pending = self._limits_fetches.get(key)
        if pending is None:
            self._claims[key] = 0

            async def fetch() -> Json:
                response = await self.api.check_limits(body=body)
                return response.model_dump(mode="json", by_alias=True, exclude_unset=True)

            pending = asyncio.ensure_future(fetch())
            self._limits_fetches[key] = pending
            pending.add_done_callback(lambda _: self._limits_fetches.pop(key, None))
        return await asyncio.shield(pending)

    async def decide(
        self,
        *,
        customer_ref: str,
        product: str,
        meter: str | None = None,
        free_limit: FreeLimit | None = None,
        tool_name: str | None = None,
    ) -> PaywallDecision:
        """``allow`` or ``gate`` for one paid call by ``customer_ref``.

        A gate records a ``paywall`` usage event; an allow records nothing
        until ``run_allow`` has run the handler.
        """
        if not product:
            raise SolvaPayError("A product reference is required", code="missing_product")
        usage_type = (free_limit.meter if free_limit else None) or meter or "requests"
        request_id = _request_id()
        started = time.monotonic()

        if free_limit and (not customer_ref.strip() or customer_ref.strip() == "anonymous"):
            raise SolvaPayError("identity required", code="identity_required", status=401)

        backend_ref = await self.ensure_customer(customer_ref, customer_ref)
        key = f"{backend_ref}:{product}:{usage_type}"
        cached = self._limits.get(key)
        now = time.monotonic()

        limits: Json
        if cached and now - cached.timestamp < self.limits_cache_ttl:
            limits = cached.limits
            if cached.remaining > 0:
                cached.remaining -= 1
                if cached.remaining <= 0:
                    del self._limits[key]
                within = True
            else:
                # The last unit was used: block one call from the cache, then re-check.
                within = False
                del self._limits[key]
        else:
            self._limits.pop(key, None)
            body: Json = {
                "customerRef": backend_ref,
                "productRef": product,
                "meterName": usage_type,
                "includeCheckoutSession": True,
            }
            if free_limit:
                body["freeAllowance"] = free_limit.wire()
            limits = await self._fetch_limits(key, body)
            remaining = limits["remaining"]
            if not limits["withinLimits"]:
                within = False
            elif remaining == -1:
                within = True
            elif remaining > 0:
                # Callers sharing one fetch each claim a distinct unit.
                claimed = self._claims.get(key, 0) + 1
                self._claims[key] = claimed
                if claimed <= remaining:
                    within = True
                    self._limits[key] = _CacheEntry(
                        remaining=remaining - claimed, timestamp=time.monotonic(), limits=limits
                    )
                else:
                    within = False
            else:
                # withinLimits with nothing remaining is overage: the API allows it.
                within = True

        if not within:
            await self.track_usage(
                customer_ref=backend_ref,
                product=product,
                action=str(get(limits, "meterName") or usage_type),
                outcome="paywall",
                request_id=request_id,
                duration_ms=int((time.monotonic() - started) * 1000),
                tool_name=tool_name,
                usage=_Usage(meter_name=free_limit.meter if free_limit else None),
            )
            # Gating on our own count (the last cached unit is used, or more
            # parallel callers than units shared one check): the limits we
            # counted down from still say units remain. The gate says none do.
            gate_limits = (
                {**limits, "withinLimits": False, "remaining": 0}
                if limits.get("withinLimits")
                else limits
            )
            return PaywallDecision(
                outcome="gate",
                customer_ref=backend_ref,
                request_id=request_id,
                limits=limits,
                gate=build_paywall_gate(product, gate_limits),
            )

        return PaywallDecision(
            outcome="allow",
            customer_ref=backend_ref,
            request_id=request_id,
            limits=limits,
            consequence="overage" if truthy(get(limits, "overage")) else None,
        )

    async def run_allow(
        self,
        decision: PaywallDecision,
        handler: Callable[[], Awaitable[T]],
        *,
        product: str,
        meter: str | None = None,
        free_limit: FreeLimit | None = None,
        tool_name: str | None = None,
    ) -> T:
        """Runs the handler for an ``allow`` and records ``success`` or ``fail``."""
        if not decision.allowed:
            raise SolvaPayError("run_allow needs an allow decision", code="invalid_argument")
        usage_type = (free_limit.meter if free_limit else None) or meter or "requests"
        action = str(get(decision.limits, "meterName") or usage_type)
        started = time.monotonic()
        try:
            result = await handler()
        except PaywallError:
            raise
        except BaseException:
            await self.track_usage(
                customer_ref=decision.customer_ref,
                product=product,
                action=action,
                outcome="fail",
                request_id=decision.request_id,
                duration_ms=int((time.monotonic() - started) * 1000),
                tool_name=tool_name,
                usage=_Usage(meter_name=free_limit.meter if free_limit else None),
            )
            raise
        await self.track_usage(
            customer_ref=decision.customer_ref,
            product=product,
            action=action,
            outcome="success",
            request_id=decision.request_id,
            duration_ms=int((time.monotonic() - started) * 1000),
            tool_name=tool_name,
            usage=_Usage(
                meter_name=free_limit.meter if free_limit else None,
                usage_class=None
                if free_limit
                else ("overage" if decision.consequence == "overage" else "included"),
            ),
        )
        return result

    # Usage -------------------------------------------------------------------

    async def track_usage(
        self,
        *,
        customer_ref: str,
        product: str,
        action: str,
        outcome: Literal["success", "paywall", "fail"],
        request_id: str,
        duration_ms: int,
        tool_name: str | None = None,
        usage: _Usage | None = None,
    ) -> None:
        """Records one usage event. Logs a failure instead of failing the paid call.

        The event is keyed ``{request_id}:{outcome}``, so a retry never counts twice.
        A 404 (a customer created moments ago and not yet visible) is retried twice.
        """
        metadata: Json = {"action": action or "api_requests", "requestId": request_id}
        if tool_name:
            metadata["toolName"] = tool_name
        if usage and usage.meter_name:
            metadata["meterName"] = usage.meter_name
        if usage and usage.usage_class:
            metadata["usageClass"] = usage.usage_class
        body: Json = {
            "customerRef": customer_ref,
            "actionType": "api_call",
            "units": 1,
            "outcome": outcome,
            "productRef": product,
            "duration": duration_ms,
            "idempotencyKey": f"{request_id}:{outcome}",
            "metadata": metadata,
            "timestamp": datetime.now(timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
        }
        for attempt in range(3):
            try:
                await self.api.record_usage(body=body)
                return
            except SolvaPayError as error:
                if error.status == 404 and attempt < 2:
                    await asyncio.sleep(0.5)
                    continue
                logger.error(
                    "SolvaPay usage tracking failed for %s (%s): %s [%s]",
                    customer_ref,
                    outcome,
                    error.message,
                    error.code,
                )
                return
