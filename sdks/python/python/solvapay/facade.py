"""Idiomatic Python facade: ``create_solvapay`` / ``payable`` / ``gate`` (Step 41-d / §2.4).

Host-side concerns only: env/config, customer-lookup dedup (60s TTL, errors
uncached), limits cache (default 10s). Gate copy and ``structured_content``
come from the generated decision-core envelopes so outcomes match TypeScript.
"""

from __future__ import annotations

import json
import os
import random
import time
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timezone
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


_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def _generate_request_id() -> str:
    """Match the TypeScript ``solvapay_{epoch_ms}_{9-char base36}`` format."""
    suffix = "".join(random.choice(_BASE36) for _ in range(9))
    return f"solvapay_{_now_ms()}_{suffix}"


def _iso8601_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _resolved_meter_name(product: str, usage_type: str) -> str:
    resolved = _call_sync_decision(
        "resolve_check_limits_params",
        {"productRef": product, "usageType": usage_type},
    )
    if isinstance(resolved, dict) and isinstance(resolved.get("meterName"), str):
        return resolved["meterName"]
    raise SolvaPayError("resolve_check_limits_params returned unexpected value")


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


def _track_usage(
    client: ApiClient,
    *,
    customer_ref: str,
    product_ref: str,
    action: str,
    outcome: str,
    request_id: str,
    duration_ms: float,
) -> None:
    payload: dict[str, Any] = {
        "customerRef": customer_ref,
        "actionType": "api_call",
        "units": 1,
        "outcome": outcome,
        "productRef": product_ref,
        "duration": duration_ms,
        "metadata": {"action": action, "requestId": request_id},
        "timestamp": _iso8601_timestamp(),
    }
    _unwrap_envelope(client.track_usage_blocking(json.dumps(payload)))


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
        resolved_base = api_base_url if api_base_url is not None else os.environ.get(
            "SOLVAPAY_API_BASE_URL"
        )
        self._api_base_url = resolved_base
        self._api_key: str | None = None
        self._bound_client: ApiClient | None = None
        if api_client is not None:
            self._bound_client = api_client
        else:
            key = api_key if api_key is not None else os.environ.get("SOLVAPAY_SECRET_KEY")
            if not key:
                _raise_solvapay_error(
                    "SOLVAPAY_SECRET_KEY is required when api_client is not provided",
                    code="missing_api_key",
                )
            self._api_key = key
        self._limits_cache_ttl = limits_cache_ttl
        self._limits_cache: dict[str, dict[str, Any]] = {}

    def get_api_client(self) -> ApiClient:
        if self._bound_client is not None:
            return self._bound_client
        key = self._api_key
        if not key:
            _raise_solvapay_error(
                "SOLVAPAY_SECRET_KEY is required when api_client is not provided",
                code="missing_api_key",
            )
        from solvapay._solvapay import SolvaPayClient

        self._bound_client = SolvaPayClient(key, self._api_base_url)
        return self._bound_client

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
        started_ms = _now_ms()
        state: dict[str, Any] | None = None
        event: dict[str, Any] = {
            "kind": "start",
            "customerRef": customer_ref,
            "product": product,
            "usageType": usage_type,
            "startedMs": started_ms,
        }
        action: dict[str, Any]
        while True:
            out = _call_sync_decision("gate_next", {"state": state, "event": event})
            if not isinstance(out, dict):
                raise SolvaPayError("gate_next returned unexpected value")
            raw_state = out.get("state")
            state = raw_state if isinstance(raw_state, dict) else None
            raw_action = out.get("action")
            if not isinstance(raw_action, dict):
                raise SolvaPayError("gate_next returned unexpected action")
            action = raw_action
            kind = action.get("kind")
            if kind == "ensureCustomer":
                backend = await self._ensure_customer(str(action.get("customerRef")), blocking=blocking)
                event = {"kind": "customerResolved", "backendRef": backend, "nowMs": _now_ms()}
                continue
            if kind == "lookupCache":
                key = str(action.get("key"))
                cached = self._limits_cache.get(key)
                now = _now_ms()
                if cached is not None and now - cached["timestamp"] < self._limits_cache_ttl:
                    event = {
                        "kind": "cacheHit",
                        "remaining": cached["remaining"],
                        "limits": cached.get("limits"),
                        "nowMs": now,
                    }
                else:
                    if cached is not None:
                        self._limits_cache.pop(key, None)
                    event = {"kind": "cacheMiss", "nowMs": now}
                continue
            if kind == "checkLimits":
                delete_key = action.get("cacheDeleteKey")
                if isinstance(delete_key, str):
                    self._limits_cache.pop(delete_key, None)
                args_json = json.dumps(
                    {
                        "customerRef": action.get("customerRef"),
                        "productRef": action.get("productRef"),
                        "meterName": action.get("meterName"),
                        "includeCheckoutSession": bool(action.get("includeCheckoutSession")),
                    }
                )
                if blocking:
                    limits_value = _unwrap_envelope(self.get_api_client().check_limits_blocking(args_json))
                else:
                    limits_value = _unwrap_envelope(await self.get_api_client().check_limits(args_json))
                if not isinstance(limits_value, dict):
                    limits_value = {}
                event = {"kind": "limitsResult", "limits": limits_value, "nowMs": _now_ms()}
                continue
            if kind == "done":
                break
            raise SolvaPayError(f"gate_next returned unknown action kind: {kind}")

        self._apply_gate_cache(action.get("cache"))
        backend_ref = str(action.get("customerRef"))
        meter_name = str(action.get("meterName") or usage_type)
        last_limits = action.get("limits") if isinstance(action.get("limits"), dict) else {}
        track = action.get("track") if isinstance(action.get("track"), dict) else None
        if track is not None:
            _track_usage(
                self.get_api_client(),
                customer_ref=str(track.get("customerRef") or backend_ref),
                product_ref=str(track.get("productRef") or product),
                action=str(track.get("action") or meter_name),
                outcome="paywall",
                request_id=_generate_request_id(),
                duration_ms=float(track.get("durationMs") or 0),
            )
        if action.get("outcome") == "gate":
            gate = action.get("gate")
            if not isinstance(gate, dict):
                raise SolvaPayError("gate_next done/gate missing gate payload")
            return PayablePaywallResult(kind="paywall", content=gate)

        decision = {"outcome": "allow", "limits": last_limits}

        def track_success(
            *,
            duration: float | None = None,
            metadata: dict[str, Any] | None = None,
        ) -> None:
            _ = metadata
            _track_usage(
                self.get_api_client(),
                customer_ref=backend_ref,
                product_ref=product,
                action=meter_name,
                outcome="success",
                request_id=_generate_request_id(),
                duration_ms=0 if duration is None else duration,
            )

        def track_fail(
            err: object,
            *,
            duration: float | None = None,
            metadata: dict[str, Any] | None = None,
        ) -> None:
            _ = err
            _ = metadata
            _track_usage(
                self.get_api_client(),
                customer_ref=backend_ref,
                product_ref=product,
                action=meter_name,
                outcome="fail",
                request_id=_generate_request_id(),
                duration_ms=0 if duration is None else duration,
            )

        return PayableAllowResult(
            kind="allow",
            customer_ref=backend_ref,
            decision=decision,
            track_success=track_success,
            track_fail=track_fail,
        )

    def _apply_gate_cache(self, cache: object) -> None:
        if not isinstance(cache, dict):
            return
        op = cache.get("op")
        key = cache.get("key")
        if not isinstance(key, str):
            return
        if op == "delete":
            self._limits_cache.pop(key, None)
            return
        if op == "updateRemaining":
            entry = self._limits_cache.get(key)
            if isinstance(entry, dict) and "remaining" in cache:
                entry["remaining"] = cache.get("remaining")
            return
        if op == "set":
            limits = cache.get("limits") if isinstance(cache.get("limits"), dict) else {}
            self._limits_cache[key] = {
                "timestamp": cache.get("timestamp") or _now_ms(),
                "remaining": cache.get("remaining"),
                "limits": limits,
            }

    async def _lookup_customer(self, args: dict[str, str], *, blocking: bool) -> Any:
        args_json = json.dumps(args)
        if blocking:
            return _unwrap_envelope(self.get_api_client().get_customer_blocking(args_json))
        return _unwrap_envelope(await self.get_api_client().get_customer(args_json))

    async def _ensure_customer(self, customer_ref: str, *, blocking: bool) -> str:
        kind = _call_sync_decision("classify_customer_ref", {"customerRef": customer_ref})
        is_backend = kind == "backend" or (
            isinstance(customer_ref, str) and customer_ref.startswith("cus_")
        )
        if kind == "anonymous":
            return customer_ref
        if is_backend:
            return customer_ref

        cached = _shared_customer_dedup.get_cached(customer_ref)
        if cached is not None:
            return cached

        args_json = json.dumps({"externalRef": customer_ref})
        try:
            if blocking:
                existing = _unwrap_envelope(self.get_api_client().get_customer_blocking(args_json))
            else:
                existing = _unwrap_envelope(await self.get_api_client().get_customer(args_json))
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
            created = _unwrap_envelope(self.get_api_client().create_customer_blocking(create_args))
        else:
            created = _unwrap_envelope(await self.get_api_client().create_customer(create_args))
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
