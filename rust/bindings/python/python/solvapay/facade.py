"""Idiomatic Python facade: ``create_solvapay`` / ``payable`` / ``gate`` (Step 41-d / §2.4).

Host-side concerns only: env/config, customer-lookup dedup (60s TTL, errors
uncached), limits cache (default 10s). Gate copy and ``structured_content``
come from the generated decision-core envelopes so outcomes match TypeScript.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Awaitable, Callable, Mapping
from functools import wraps
from typing import Any, ParamSpec, Protocol, TypeVar

from solvapay.errors import PaywallError, SolvaPayError
from solvapay.results import PayableAllowResult, PayableGateResult, PayablePaywallResult

_P = ParamSpec("_P")
_R = TypeVar("_R")

_CUSTOMER_DEDUP_TTL_MS = 60_000
_DEFAULT_LIMITS_CACHE_TTL_MS = 10_000


class ApiClient(Protocol):
    """Minimal client surface used by the facade (async + blocking twins)."""

    async def check_limits(self, args_json: str) -> str: ...
    def check_limits_blocking(self, args_json: str) -> str: ...
    async def track_usage(self, args_json: str) -> str: ...
    def track_usage_blocking(self, args_json: str) -> str: ...
    async def get_customer(self, args_json: str) -> str: ...
    def get_customer_blocking(self, args_json: str) -> str: ...
    async def create_customer(self, args_json: str) -> str: ...
    def create_customer_blocking(self, args_json: str) -> str: ...


def _now_ms() -> int:
    return int(time.time() * 1000)


def _raise_solvapay_error(
    message: str,
    *,
    code: str | None = None,
    status: int | None = None,
) -> None:
    err = SolvaPayError(message)
    if code is not None:
        setattr(err, "code", code)
    if status is not None:
        setattr(err, "status", status)
    raise err


def _unwrap_envelope(envelope_json: str) -> Any:
    """Parse a JSON envelope or raise SolvaPayError / PaywallError (§5.7)."""
    try:
        envelope = json.loads(envelope_json)
    except json.JSONDecodeError as err:
        raise SolvaPayError("SolvaPay native binding returned invalid JSON envelope") from err
    if not isinstance(envelope, dict) or "ok" not in envelope:
        raise SolvaPayError("SolvaPay native binding returned malformed envelope")
    if envelope["ok"] is True:
        return envelope.get("value")
    error = envelope.get("error") or {}
    kind = error.get("kind")
    message = error.get("message") or "SolvaPay error"
    if kind == "Paywall":
        gate = error.get("gate") or {}
        if not isinstance(gate, dict):
            gate = {}
        raise PaywallError(message, gate)
    if kind == "Api":
        status = error.get("status") if isinstance(error.get("status"), int) else None
        _raise_solvapay_error(message, code=error.get("code"), status=status)
    code = error.get("code") if isinstance(error.get("code"), str) else None
    _raise_solvapay_error(message, code=code)


def _call_sync_decision(name: str, args: dict[str, Any]) -> Any:
    """Invoke a generated sync decision / payload-builder and unwrap."""
    try:
        from solvapay import _native as native

        return native.call_native_sync(name, json.dumps(args))
    except ImportError:
        pass

    import solvapay._solvapay as binding

    fn = getattr(binding, name, None)
    if fn is None:
        raise SolvaPayError(f"SolvaPay native binding missing sync method: {name}")
    return _unwrap_envelope(fn(json.dumps(args)))


class _CustomerDeduplicator:
    """Process-wide customer-lookup dedup (60s TTL; errors uncached)."""

    def __init__(self) -> None:
        self._inflight: dict[str, Any] = {}
        self._cache: dict[str, tuple[str, int]] = {}

    def get_cached(self, key: str) -> str | None:
        hit = self._cache.get(key)
        if hit is None:
            return None
        value, expires_at = hit
        if _now_ms() >= expires_at:
            self._cache.pop(key, None)
            return None
        return value

    def put(self, key: str, value: str) -> None:
        self._cache[key] = (value, _now_ms() + _CUSTOMER_DEDUP_TTL_MS)


_shared_customer_dedup = _CustomerDeduplicator()


class SolvaPay:
    """High-level facade over the generated PyO3 binding surface."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        api_base_url: str | None = None,
        limits_cache_ttl: int = _DEFAULT_LIMITS_CACHE_TTL_MS,
        api_client: ApiClient | None = None,
    ) -> None:
        if api_client is not None:
            self._client: ApiClient = api_client
        else:
            key = api_key if api_key is not None else os.environ.get("SOLVAPAY_SECRET_KEY")
            if not key:
                _raise_solvapay_error(
                    "SOLVAPAY_SECRET_KEY is required when api_client is not provided",
                    code="missing_api_key",
                )
            from solvapay._solvapay import SolvaPayClient

            self._client = SolvaPayClient(key, api_base_url)
        self._limits_cache_ttl = limits_cache_ttl
        self._limits_cache: dict[str, dict[str, Any]] = {}

    def payable(
        self, *, product: str, usage_type: str = "requests"
    ) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]:
        """Decorator that gates the wrapped callable before invocation."""

        def decorator(fn: Callable[_P, _R]) -> Callable[_P, _R]:
            if _is_coroutine_fn(fn):

                @wraps(fn)
                async def async_wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
                    customer_ref = _extract_customer_ref(args, kwargs)
                    result = await self.gate(customer_ref, product=product, usage_type=usage_type)
                    if result.kind == "paywall":
                        raise PaywallError("Payment required", result.content)
                    try:
                        out = await fn(*args, **kwargs)  # type: ignore[misc]
                    except Exception as err:
                        result.track_fail(err)
                        raise
                    result.track_success()
                    return out  # type: ignore[return-value]

                return async_wrapper  # type: ignore[return-value]

            @wraps(fn)
            def sync_wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
                customer_ref = _extract_customer_ref(args, kwargs)
                result = self.gate_blocking(
                    customer_ref, product=product, usage_type=usage_type
                )
                if result.kind == "paywall":
                    raise PaywallError("Payment required", result.content)
                try:
                    out = fn(*args, **kwargs)
                except Exception as err:
                    result.track_fail(err)
                    raise
                result.track_success()
                return out

            return sync_wrapper

        return decorator

    async def gate(
        self,
        customer_ref: str,
        *,
        product: str,
        usage_type: str = "requests",
    ) -> PayableGateResult:
        """Async paywall gate — returns paywall or allow with trackers."""
        return await self._gate(
            customer_ref, product=product, usage_type=usage_type, blocking=False
        )

    def gate_blocking(
        self,
        customer_ref: str,
        *,
        product: str,
        usage_type: str = "requests",
    ) -> PayableGateResult:
        """Blocking twin of :meth:`gate`."""
        # Synchronous path uses blocking client methods; decisions stay sync.
        import asyncio

        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(
                self._gate(customer_ref, product=product, usage_type=usage_type, blocking=True)
            )
        # Already inside an event loop — run decide with blocking client only.
        return _run_blocking(
            self._gate(customer_ref, product=product, usage_type=usage_type, blocking=True)
        )

    async def _gate(
        self,
        customer_ref: str,
        *,
        product: str,
        usage_type: str,
        blocking: bool,
    ) -> PayableGateResult:
        backend_ref = await self._ensure_customer(customer_ref, blocking=blocking)
        limits_key = f"{backend_ref}:{product}:{usage_type}"
        cached = self._limits_cache.get(limits_key)
        now = _now_ms()
        within_limits: bool
        remaining: float | int | None
        last_limits: dict[str, Any] | None = None

        if cached is not None and now - cached["timestamp"] < self._limits_cache_ttl:
            cached_eval = _call_sync_decision(
                "evaluate_cached_limits",
                {"remaining": cached["remaining"]},
            )
            within_limits = bool(cached_eval["withinLimits"])
            remaining = cached_eval.get("remaining")
            if within_limits:
                cached["remaining"] = remaining
            if cached_eval.get("evict"):
                self._limits_cache.pop(limits_key, None)
            last_limits = cached.get("limits")
        else:
            if cached is not None:
                self._limits_cache.pop(limits_key, None)
            args_json = json.dumps(
                {
                    "customerRef": backend_ref,
                    "productRef": product,
                    "meterName": usage_type,
                }
            )
            if blocking:
                limits_value = _unwrap_envelope(self._client.check_limits_blocking(args_json))
            else:
                limits_value = _unwrap_envelope(await self._client.check_limits(args_json))
            if not isinstance(limits_value, dict):
                limits_value = {}
            last_limits = limits_value
            fresh = _call_sync_decision(
                "evaluate_fresh_limits",
                {
                    "withinLimits": bool(limits_value.get("withinLimits", False)),
                    "remaining": limits_value.get("remaining", 0),
                },
            )
            within_limits = bool(fresh["withinLimits"])
            remaining = fresh.get("remaining")
            self._limits_cache[limits_key] = {
                "timestamp": now,
                "remaining": remaining,
                "limits": limits_value,
            }

        decision = _call_sync_decision(
            "decide_paywall_outcome",
            {
                "withinLimits": within_limits,
                "product": product,
                "limits": last_limits,
                "checkoutUrl": (last_limits or {}).get("checkoutUrl"),
            },
        )
        if not isinstance(decision, dict):
            raise SolvaPayError("decide_paywall_outcome returned unexpected value")

        if decision.get("outcome") == "gate":
            gate = decision.get("gate") or {}
            if not isinstance(gate, dict):
                gate = _call_sync_decision(
                    "build_paywall_gate",
                    {"productRef": product, "limits": last_limits or {"remaining": 0}},
                )
            return PayablePaywallResult(kind="paywall", content=gate)

        def track_success(
            *,
            duration: float | None = None,
            metadata: dict[str, Any] | None = None,
        ) -> None:
            payload: dict[str, Any] = {
                "customerRef": backend_ref,
                "action": usage_type,
                "productRef": product,
            }
            if duration is not None:
                payload["duration"] = duration
            if metadata is not None:
                payload["metadata"] = metadata
            args_json = json.dumps(payload)
            if blocking:
                _unwrap_envelope(self._client.track_usage_blocking(args_json))
            else:
                # Fire-and-forget via blocking twin so callers need not await.
                _unwrap_envelope(self._client.track_usage_blocking(args_json))

        def track_fail(
            err: object,
            *,
            duration: float | None = None,
            metadata: dict[str, Any] | None = None,
        ) -> None:
            meta = dict(metadata or {})
            meta["error"] = str(err)
            track_success(duration=duration, metadata=meta)

        return PayableAllowResult(
            kind="allow",
            customer_ref=backend_ref,
            decision=decision,
            track_success=track_success,
            track_fail=track_fail,
        )

    async def _ensure_customer(self, customer_ref: str, *, blocking: bool) -> str:
        kind = _call_sync_decision("classify_customer_ref", {"customerRef": customer_ref})
        if kind in ("backend", "anonymous") or (
            isinstance(customer_ref, str) and customer_ref.startswith("cus_")
        ):
            return customer_ref

        cached = _shared_customer_dedup.get_cached(customer_ref)
        if cached is not None:
            return cached

        args_json = json.dumps({"externalRef": customer_ref})
        try:
            if blocking:
                existing = _unwrap_envelope(self._client.get_customer_blocking(args_json))
            else:
                existing = _unwrap_envelope(await self._client.get_customer(args_json))
            if isinstance(existing, dict) and existing.get("customerRef"):
                ref = str(existing["customerRef"])
                _shared_customer_dedup.put(customer_ref, ref)
                return ref
        except SolvaPayError:
            pass

        # Mirror TS paywall.ensureCustomer: generate email via core helper.
        # If the app ref is already an email, pass it through — otherwise the
        # fallback template (`{ref}-{now}@auto-created.local`) becomes invalid.
        email = customer_ref if "@" in customer_ref else None
        params = _call_sync_decision(
            "build_create_customer_params",
            {
                "customerRef": customer_ref,
                "externalRef": customer_ref,
                "email": email,
                "nowMs": _now_ms(),
            },
        )
        if not isinstance(params, dict):
            raise SolvaPayError("build_create_customer_params returned unexpected value")
        create_args = json.dumps(params)
        if blocking:
            created = _unwrap_envelope(self._client.create_customer_blocking(create_args))
        else:
            created = _unwrap_envelope(await self._client.create_customer(create_args))
        if not isinstance(created, dict):
            raise SolvaPayError("create_customer did not return an object")
        ref = _call_sync_decision(
            "extract_backend_customer_ref",
            {"response": created, "fallback": customer_ref},
        )
        if not isinstance(ref, str) or not ref:
            raise SolvaPayError("create_customer did not return customerRef")
        _shared_customer_dedup.put(customer_ref, ref)
        return ref


def create_solvapay(
    *,
    api_key: str | None = None,
    api_base_url: str | None = None,
    limits_cache_ttl: int = _DEFAULT_LIMITS_CACHE_TTL_MS,
        api_client: ApiClient | None = None,
) -> SolvaPay:
    """Factory matching §2.4 / catalog ``create_solvapay``."""
    return SolvaPay(
        api_key=api_key,
        api_base_url=api_base_url,
        limits_cache_ttl=limits_cache_ttl,
        api_client=api_client,
    )


def _is_coroutine_fn(fn: Callable[..., object]) -> bool:
    import inspect

    return inspect.iscoroutinefunction(fn)


def _extract_customer_ref(args: tuple[object, ...], kwargs: Mapping[str, object]) -> str:
    if "customer_ref" in kwargs and isinstance(kwargs["customer_ref"], str):
        return kwargs["customer_ref"]
    if args and isinstance(args[0], dict):
        auth = args[0].get("auth") if isinstance(args[0].get("auth"), dict) else {}
        ref = auth.get("customer_ref") or args[0].get("customer_ref")
        if isinstance(ref, str) and ref:
            return ref
    return "anonymous"


def _run_blocking(awaitable: Awaitable[Any]) -> Any:
    import asyncio
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, awaitable).result()


__all__ = ["ApiClient", "SolvaPay", "create_solvapay"]
