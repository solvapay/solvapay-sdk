"""Idiomatic Python facade: ``create_solvapay`` / ``payable`` / ``gate`` (Step 41-d / §2.4).

Host-side concerns only: env/config, customer-lookup dedup (60s TTL, errors
uncached), limits cache (default 10s). Gate copy and ``structured_content``
come from the generated decision-core envelopes so outcomes match TypeScript.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import threading
import time
from collections.abc import Awaitable, Callable, Mapping
from functools import wraps
from typing import Any, ParamSpec, Protocol, TypeVar

from solvapay.defaults import _CUSTOMER_DEDUP_MAX_CACHE_SIZE, _DEFAULT_LIMITS_CACHE_TTL_MS
from solvapay.errors import PaywallError, SolvaPayError
from solvapay.results import PayableAllowResult, PayableGateResult, PayablePaywallResult
from solvapay.retry import with_retry_blocking

_P = ParamSpec("_P")
_R = TypeVar("_R")


class _InflightWaiter:
    """Thread-safe leader/follower cell for one customer-ref lookup."""

    def __init__(self) -> None:
        self._event = threading.Event()
        self._result: str | None = None
        self._error: BaseException | None = None

    def set_result(self, value: str) -> None:
        self._result = value
        self._event.set()

    def set_error(self, error: BaseException) -> None:
        self._error = error
        self._event.set()

    def wait(self) -> str:
        self._event.wait()
        if self._error is not None:
            raise self._error
        if self._result is None:
            raise SolvaPayError("customer lookup failed")
        return self._result


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
    from solvapay import _native as native

    return native.call_native_sync(name, json.dumps(args))


def _should_retry_usage(error: Exception, _attempt: int) -> bool:
    return bool(
        _call_sync_decision("should_retry_usage_error", {"message": str(error)})
    )


def _post_usage(client: ApiClient, request: dict[str, Any]) -> None:
    with_retry_blocking(
        lambda: _unwrap_envelope(client.track_usage_blocking(json.dumps(request))),
        should_retry=_should_retry_usage,
    )


def _emit_handler_usage(
    client: ApiClient,
    state: dict[str, Any] | None,
    event: dict[str, Any],
) -> None:
    out = _call_sync_decision("gate_next", {"state": state, "event": event})
    if not isinstance(out, dict):
        raise SolvaPayError("gate_next returned unexpected value")
    action = out.get("action")
    if not isinstance(action, dict):
        raise SolvaPayError("gate_next returned unexpected action")
    kind = action.get("kind")
    if kind == "skipUsage":
        return
    if kind != "emitUsage":
        raise SolvaPayError(f"gate_next handler event returned unexpected action kind: {kind}")
    request = action.get("request")
    if not isinstance(request, dict):
        raise SolvaPayError("gate_next emitUsage missing request")
    _post_usage(client, request)


class _CustomerDeduplicator:
    """Process-wide customer-lookup dedup (60s TTL; errors uncached)."""

    def __init__(self, *, max_cache_size: int = _CUSTOMER_DEDUP_MAX_CACHE_SIZE) -> None:
        self._max_cache_size = max_cache_size
        self._lock = threading.Lock()
        self._inflight: dict[str, _InflightWaiter] = {}
        self._cache: dict[str, tuple[str, int]] = {}

    def acquire(self, key: str) -> tuple[_InflightWaiter, bool]:
        with self._lock:
            existing = self._inflight.get(key)
            if existing is not None:
                return existing, False
            waiter = _InflightWaiter()
            self._inflight[key] = waiter
            return waiter, True

    def publish(
        self,
        key: str,
        waiter: _InflightWaiter,
        result: str | None,
        error: BaseException | None,
    ) -> None:
        with self._lock:
            if error is not None:
                waiter.set_error(error)
            elif result is not None:
                waiter.set_result(result)
            else:
                waiter.set_error(SolvaPayError("customer lookup failed"))
            if self._inflight.get(key) is waiter:
                del self._inflight[key]

    def get_entry(self, key: str) -> tuple[str, int] | None:
        with self._lock:
            return self._cache.get(key)

    def put(self, key: str, value: str, timestamp_ms: int) -> None:
        with self._lock:
            self._cache[key] = (value, timestamp_ms)
            overflow = len(self._cache) - self._max_cache_size
            if overflow <= 0:
                return
            oldest = sorted(self._cache.items(), key=lambda item: item[1][1])[:overflow]
            for evict_key, _ in oldest:
                del self._cache[evict_key]

    def size(self) -> int:
        with self._lock:
            return len(self._cache)

    def clear(self) -> None:
        with self._lock:
            self._inflight.clear()
            self._cache.clear()


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

    def track_usage(self, params: Mapping[str, Any]) -> None:
        """Record a usage event through the same retry path as ``payable`` handlers."""
        _post_usage(self.get_api_client(), dict(params))

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
                        raise PaywallError(_paywall_short_message(result.content), result.content)
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
                    raise PaywallError(_paywall_short_message(result.content), result.content)
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
            "limitsCacheTTLMs": self._limits_cache_ttl,
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
                backend = await self._ensure_customer(
                    str(action.get("customerRef")),
                    blocking=blocking,
                )
                event = {"kind": "customerResolved", "backendRef": backend, "nowMs": _now_ms()}
                continue
            if kind == "readLimitsCache":
                key = str(action.get("key"))
                cached = self._limits_cache.get(key)
                now = _now_ms()
                if cached is not None:
                    event = {
                        "kind": "limitsCacheEntry",
                        "found": True,
                        "remaining": cached["remaining"],
                        "limits": cached.get("limits"),
                        "timestampMs": cached["timestamp"],
                        "nowMs": now,
                        "randomUnit": random.random(),
                    }
                else:
                    event = {
                        "kind": "limitsCacheEntry",
                        "found": False,
                        "nowMs": now,
                        "randomUnit": random.random(),
                    }
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
                client = self.get_api_client()
                if blocking:
                    limits_value = _unwrap_envelope(client.check_limits_blocking(args_json))
                else:
                    limits_value = _unwrap_envelope(await client.check_limits(args_json))
                if not isinstance(limits_value, dict):
                    raise SolvaPayError("checkLimits returned a non-object body")
                event = {
                    "kind": "limitsResult",
                    "limits": limits_value,
                    "nowMs": _now_ms(),
                    "randomUnit": random.random(),
                }
                continue
            if kind in ("allow", "gate"):
                break
            raise SolvaPayError(f"gate_next returned unknown action kind: {kind}")

        self._apply_gate_cache(action.get("cache"))
        backend_ref = str(action.get("customerRef"))
        last_limits = action.get("limits") if isinstance(action.get("limits"), dict) else {}
        request = action.get("request") if isinstance(action.get("request"), dict) else None
        if request is not None:
            _post_usage(self.get_api_client(), request)
        if kind == "gate":
            gate = action.get("gate")
            if not isinstance(gate, dict):
                raise SolvaPayError("gate_next gate action missing gate payload")
            return PayablePaywallResult(kind="paywall", content=gate)

        decision: dict[str, Any] = {"outcome": "allow", "limits": last_limits}
        consequence = action.get("consequence")
        if consequence in ("throttled", "overage"):
            decision["consequence"] = consequence
        driver_state = state if isinstance(state, dict) else None

        def track_success(
            *,
            duration: float | None = None,
            metadata: dict[str, Any] | None = None,
        ) -> None:
            _ = metadata
            _emit_handler_usage(
                self.get_api_client(),
                driver_state,
                {
                    "kind": "handlerSucceeded",
                    "durationMs": 0 if duration is None else duration,
                    "nowMs": _now_ms(),
                    "randomUnit": random.random(),
                },
            )

        def track_fail(
            err: object,
            *,
            duration: float | None = None,
            metadata: dict[str, Any] | None = None,
        ) -> None:
            _ = metadata
            _emit_handler_usage(
                self.get_api_client(),
                driver_state,
                {
                    "kind": "handlerFailed",
                    "durationMs": 0 if duration is None else duration,
                    "nowMs": _now_ms(),
                    "randomUnit": random.random(),
                    "errorMessage": str(err),
                    "isPaywallError": isinstance(err, PaywallError),
                },
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
            timestamp = cache.get("timestamp")
            if not isinstance(timestamp, (int, float)):
                raise SolvaPayError("gate_next cache set missing timestamp")
            limits = cache.get("limits") if isinstance(cache.get("limits"), dict) else {}
            self._limits_cache[key] = {
                "timestamp": timestamp,
                "remaining": cache.get("remaining"),
                "limits": limits,
                "checkoutUrl": cache.get("checkoutUrl"),
                "meterName": cache.get("meterName"),
            }

    async def _lookup_customer(self, args: dict[str, str], *, blocking: bool) -> Any:
        args_json = json.dumps(args)
        if blocking:
            return _unwrap_envelope(self.get_api_client().get_customer_blocking(args_json))
        return _unwrap_envelope(await self.get_api_client().get_customer(args_json))

    async def _ensure_customer(self, customer_ref: str, *, blocking: bool) -> str:
        waiter, leader = _shared_customer_dedup.acquire(customer_ref)
        if not leader:
            if blocking:
                return waiter.wait()
            return await asyncio.to_thread(waiter.wait)
        try:
            result = await self._run_ensure_customer(customer_ref, blocking=blocking)
            _shared_customer_dedup.publish(customer_ref, waiter, result, None)
            return result
        except BaseException as err:
            _shared_customer_dedup.publish(customer_ref, waiter, None, err)
            raise

    async def _run_ensure_customer(self, customer_ref: str, *, blocking: bool) -> str:
        client = self.get_api_client()
        can_update = hasattr(client, "update_customer") and hasattr(
            client, "update_customer_blocking"
        )
        state: Any = None
        event: dict[str, Any] = {
            "kind": "start",
            "customerRef": customer_ref,
            "canCreateCustomer": True,
            "canUpdateCustomer": can_update,
            "nowMs": _now_ms(),
        }
        while True:
            out = _call_sync_decision(
                "ensure_customer_next", {"state": state, "event": event}
            )
            if (
                isinstance(out, dict)
                and "action" not in out
                and "error" in out
                and "status" in out
            ):
                details = out.get("details")
                raise SolvaPayError(
                    details if isinstance(details, str) and details else str(out["error"])
                )
            if not isinstance(out, dict):
                raise SolvaPayError("ensure_customer_next returned unexpected value")
            action = out.get("action")
            if not isinstance(action, dict):
                raise SolvaPayError("ensure_customer_next returned unexpected action")
            state = out.get("state")
            kind = action.get("kind")
            if kind == "readCustomerCache":
                key = str(action.get("key") or "")
                hit = _shared_customer_dedup.get_entry(key)
                if hit is None:
                    event = {"kind": "customerCacheEntry", "found": False, "nowMs": _now_ms()}
                else:
                    backend_ref, timestamp_ms = hit
                    event = {
                        "kind": "customerCacheEntry",
                        "found": True,
                        "backendRef": backend_ref,
                        "timestampMs": timestamp_ms,
                        "nowMs": _now_ms(),
                    }
                continue
            if kind == "getCustomer":
                params: dict[str, str] = {}
                if action.get("byExternalRef"):
                    params["externalRef"] = str(action["byExternalRef"])
                elif action.get("byEmail"):
                    params["email"] = str(action["byEmail"])
                try:
                    existing = await self._lookup_customer(params, blocking=blocking)
                    if isinstance(existing, dict) and existing.get("customerRef"):
                        event = {
                            "kind": "customerLookupResult",
                            "found": True,
                            "customer": existing,
                            "nowMs": _now_ms(),
                        }
                    else:
                        event = {
                            "kind": "customerLookupResult",
                            "found": False,
                            "nowMs": _now_ms(),
                        }
                except SolvaPayError as err:
                    event = {
                        "kind": "customerLookupResult",
                        "found": False,
                        "errorMessage": str(err),
                        "nowMs": _now_ms(),
                    }
                continue
            if kind == "createCustomer":
                params_obj = action.get("params")
                if not isinstance(params_obj, dict):
                    raise SolvaPayError("ensure_customer_next createCustomer missing params")
                create_args = json.dumps(params_obj)
                try:
                    if blocking:
                        created = _unwrap_envelope(client.create_customer_blocking(create_args))
                    else:
                        created = _unwrap_envelope(await client.create_customer(create_args))
                    event = {
                        "kind": "customerCreateResult",
                        "ok": True,
                        "customer": created if isinstance(created, dict) else {},
                        "nowMs": _now_ms(),
                    }
                except SolvaPayError as err:
                    event = {
                        "kind": "customerCreateResult",
                        "ok": False,
                        "errorMessage": str(err),
                        "nowMs": _now_ms(),
                    }
                continue
            if kind == "updateCustomer":
                payload: dict[str, Any] = {"customerRef": action.get("customerRef")}
                patch = action.get("patch")
                if isinstance(patch, dict):
                    payload.update(patch)
                try:
                    if blocking:
                        _unwrap_envelope(client.update_customer_blocking(json.dumps(payload)))
                    else:
                        _unwrap_envelope(await client.update_customer(json.dumps(payload)))
                    event = {"kind": "customerUpdateResult", "ok": True, "nowMs": _now_ms()}
                except SolvaPayError as err:
                    event = {
                        "kind": "customerUpdateResult",
                        "ok": False,
                        "errorMessage": str(err),
                        "nowMs": _now_ms(),
                    }
                continue
            if kind == "resolved":
                backend = action.get("backendRef")
                if not isinstance(backend, str) or not backend:
                    raise SolvaPayError("ensure_customer_next resolved without backendRef")
                cache = action.get("cache")
                if isinstance(cache, dict) and isinstance(cache.get("key"), str):
                    ts = cache.get("timestampMs")
                    _shared_customer_dedup.put(
                        str(cache["key"]),
                        backend,
                        int(ts) if isinstance(ts, (int, float)) else _now_ms(),
                    )
                return backend
            raise SolvaPayError(f"ensure_customer_next unknown action kind: {kind}")


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


def _paywall_short_message(content: Any) -> str:
    if not isinstance(content, dict):
        raise SolvaPayError("paywall result missing gate content")
    message = content.get("shortMessage")
    if not isinstance(message, str) or not message:
        raise SolvaPayError("paywall gate missing shortMessage")
    return message


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
