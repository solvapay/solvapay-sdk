"""Payable handler loop for the interim Pyodide / Cloudflare Workers FFI.

Delete this module with `workers.py` when the PyEmscripten wheel lands — see
`docs/contributing/pyodide-emscripten-wheel.md`.
"""

from __future__ import annotations

import inspect
import json
import random
import time
from collections.abc import Awaitable, Callable, Mapping, MutableMapping
from dataclasses import dataclass, field
from types import ModuleType
from typing import Protocol

Handler = Callable[[dict[str, object], "WorkersResponseContext"], Awaitable[object]]
GetCustomerRef = Callable[[dict[str, object]], str | Awaitable[str]]


class _WorkersWasmClient(Protocol):
    async def get_customer(self, args_json: str) -> str: ...
    async def create_customer(self, args_json: str) -> str: ...
    async def update_customer(self, args_json: str) -> str: ...
    async def check_limits(self, args_json: str) -> str: ...
    async def track_usage(self, args_json: str) -> str: ...


def _workers() -> ModuleType:
    from solvapay_mcp import workers

    return workers


class PaywallError(Exception):
    """Paywall gate outcome carrying structured content."""

    def __init__(
        self, message: str, structured_content: Mapping[str, object] | None = None
    ) -> None:
        super().__init__(message)
        self.name = "PaywallError"
        self.structured_content = dict(structured_content or {})


def _now_ms() -> int:
    return int(time.time() * 1000)


def _call_js_sync(js_module: object, name: str, args: Mapping[str, object]) -> object:
    fn = getattr(js_module, name, None)
    if fn is None or not callable(fn):
        raise _workers().WorkersSolvaPayError(f"js module is missing {name}")
    raw = fn(json.dumps(dict(args)))
    if inspect.isawaitable(raw):
        raise _workers().WorkersSolvaPayError(f"{name} must be a sync wasm export")
    if not isinstance(raw, str):
        raw = str(raw)
    return _workers().unwrap_wasm_envelope(raw)


def _solvapay_call(js_module: object, op: str, args: Mapping[str, object]) -> object:
    fn = getattr(js_module, "solvapayCall", None)
    if fn is None or not callable(fn):
        raise _workers().WorkersSolvaPayError("js module is missing solvapayCall")
    raw = fn(json.dumps({"op": op, "args": dict(args)}))
    if inspect.isawaitable(raw):
        raise _workers().WorkersSolvaPayError("solvapayCall must be a sync wasm export")
    if not isinstance(raw, str):
        raw = str(raw)
    return _workers().unwrap_wasm_envelope(raw)


def _as_object_map(value: object, what: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise _workers().WorkersSolvaPayError(f"{what} returned a non-object value")
    return {str(k): v for k, v in value.items()}


class WorkersResponseContext:
    """Merchant-facing payable context (`respond` / `gate` / `emit`) on wasm."""

    customer: Mapping[str, object]
    product: Mapping[str, object]

    def __init__(
        self,
        *,
        js_module: object,
        customer: Mapping[str, object],
        product: Mapping[str, object],
        product_ref: str,
        limits: Mapping[str, object] | None = None,
    ) -> None:
        self.customer = customer
        self.product = product
        self._js_module = js_module
        self._product_ref = product_ref
        self._limits = dict(limits) if limits is not None else None
        self._emitted: list[dict[str, object]] = []

    def emit(self, block: Mapping[str, object]) -> None:
        self._emitted.append(dict(block))

    def respond(
        self, data: object, options: Mapping[str, object] | None = None
    ) -> dict[str, object]:
        args: dict[str, object] = {"data": data}
        if options is not None:
            args["options"] = dict(options)
        if self._emitted:
            args["emittedBlocks"] = list(self._emitted)
        if self._limits is not None:
            args["limits"] = self._limits
        value = _call_js_sync(self._js_module, "makeResponseResult", args)
        return _as_object_map(value, "makeResponseResult")

    def gate(self, reason: str | None = None) -> None:
        payload: dict[str, object] = {"product": self._product_ref}
        if reason is not None:
            payload["reason"] = reason
        content = _solvapay_call(self._js_module, "mcpDefaultGate", payload)
        if not isinstance(content, Mapping):
            raise TypeError("mcpDefaultGate did not return an object")
        message = str(content.get("message") or "Payment required")
        raise PaywallError(message, dict(content))


@dataclass
class WorkersPayableSpec:
    """Registered merchant payable tool."""

    product: str
    handler: Handler
    title: str | None
    description: str | None
    input_schema: dict[str, object]
    get_customer_ref: GetCustomerRef | None
    output_schema: dict[str, object] | None = None
    usage_type: str = "requests"


@dataclass
class WorkersPayableRegistry:
    """In-process payable tool registry for `mcpDispatch` `payableTools`."""

    tools: dict[str, WorkersPayableSpec] = field(default_factory=dict)

    def dispatch_tools(self) -> list[dict[str, object]]:
        listed: list[dict[str, object]] = []
        for name, spec in sorted(self.tools.items(), key=lambda item: item[0]):
            item: dict[str, object] = {"name": name, "inputSchema": spec.input_schema}
            if spec.title is not None:
                item["title"] = spec.title
            if spec.description is not None:
                item["description"] = spec.description
            if spec.output_schema is not None:
                schema = spec.output_schema
                if "type" not in schema:
                    schema = {**schema, "type": "object"}
                item["outputSchema"] = schema
            listed.append(item)
        return listed


def register_workers_payable(
    registry: WorkersPayableRegistry,
    name: str,
    *,
    product: str,
    handler: Handler,
    title: str | None = None,
    description: str | None = None,
    input_schema: dict[str, object] | None = None,
    output_schema: dict[str, object] | None = None,
    get_customer_ref: GetCustomerRef | None = None,
    usage_type: str | None = None,
) -> None:
    """Register a paywalled tool for the Workers `invokeHandler` loop."""
    schema: dict[str, object] = (
        input_schema if input_schema is not None else {"type": "object", "properties": {}}
    )
    registry.tools[name] = WorkersPayableSpec(
        product=product,
        handler=handler,
        title=title,
        description=description,
        input_schema=schema,
        output_schema=output_schema,
        get_customer_ref=get_customer_ref,
        usage_type=(
            usage_type.strip()
            if isinstance(usage_type, str) and usage_type.strip()
            else "requests"
        ),
    )


def _resolve_customer_ref(
    js_module: object,
    args: dict[str, object],
    get_customer_ref: GetCustomerRef | None,
) -> str:
    hook_ref = None
    if get_customer_ref is not None:
        resolved = get_customer_ref(args)
        if not isinstance(resolved, str):
            raise _workers().WorkersSolvaPayError("get_customer_ref must be synchronous on Workers")
        if resolved.strip():
            hook_ref = resolved.strip()
    raw = args.get("customer_ref")
    auth = args.get("auth")
    auth_ref = None
    if isinstance(auth, dict):
        candidate = auth.get("customer_ref")
        if isinstance(candidate, str):
            auth_ref = candidate
    payload: dict[str, object] = {}
    if hook_ref is not None:
        payload["hookRef"] = hook_ref
    if auth_ref is not None:
        payload["argsAuthCustomerRef"] = auth_ref
    if isinstance(raw, str):
        payload["argsCustomerRef"] = raw
    result = _call_js_sync(js_module, "resolveCustomerRef", payload)
    if isinstance(result, str) and result.strip():
        return result.strip()
    return "anonymous"


def _overlay_claimed_limits(
    js_module: object, limits: dict[str, object], claimed: int
) -> dict[str, object]:
    remaining = limits.get("remaining")
    remaining_f = float(remaining) if isinstance(remaining, int | float) else 0.0
    within = limits.get("withinLimits") is True
    evaluation = _call_js_sync(
        js_module,
        "evaluateClaimedLimits",
        {"withinLimits": within, "remaining": remaining_f, "claimed": float(claimed)},
    )
    if not isinstance(evaluation, dict):
        raise _workers().WorkersSolvaPayError("evaluateClaimedLimits returned a non-object value")
    overlaid = dict(limits)
    if remaining_f == -1.0 or (within and remaining_f == 0.0):
        overlaid["withinLimits"] = evaluation.get("withinLimits")
        overlaid["remaining"] = evaluation.get("remaining")
        return overlaid
    if evaluation.get("withinLimits") is not True:
        overlaid["withinLimits"] = False
        overlaid["remaining"] = 0
        return overlaid
    rem = evaluation.get("remaining")
    overlaid["withinLimits"] = True
    overlaid["remaining"] = (float(rem) if isinstance(rem, int | float) else 0.0) + 1.0
    return overlaid


def _apply_gate_cache(cache_store: MutableMapping[str, dict[str, object]], cache: object) -> None:
    if not isinstance(cache, dict):
        return
    op = cache.get("op")
    key = cache.get("key")
    if not isinstance(key, str):
        return
    if op == "delete":
        cache_store.pop(key, None)
        return
    if op == "updateRemaining":
        entry = cache_store.get(key)
        if isinstance(entry, dict) and "remaining" in cache:
            entry["remaining"] = cache.get("remaining")
        return
    if op == "set":
        timestamp = cache.get("timestamp")
        if not isinstance(timestamp, int | float):
            raise _workers().WorkersSolvaPayError("gateNext cache set missing timestamp")
        limits = cache.get("limits") if isinstance(cache.get("limits"), dict) else {}
        cache_store[key] = {
            "remaining": cache.get("remaining"),
            "timestamp": int(timestamp),
            "limits": limits,
        }


async def _workers_ensure_customer(
    client: _WorkersWasmClient,
    js_module: object,
    customer_ref: str,
    customer_cache: MutableMapping[str, tuple[str, int]],
) -> str:
    state: object = None
    event: dict[str, object] = {
        "kind": "start",
        "customerRef": customer_ref,
        "canCreateCustomer": True,
        "canUpdateCustomer": True,
        "nowMs": _now_ms(),
    }
    while True:
        out = _call_js_sync(js_module, "ensureCustomerNext", {"state": state, "event": event})
        if not isinstance(out, dict):
            raise _workers().WorkersSolvaPayError("ensureCustomerNext returned a non-object value")
        if "action" not in out and "error" in out:
            details = out.get("details")
            raise _workers().WorkersSolvaPayError(
                details if isinstance(details, str) and details else str(out["error"])
            )
        action = out.get("action")
        if not isinstance(action, dict):
            raise _workers().WorkersSolvaPayError("ensureCustomerNext returned unexpected action")
        state = out.get("state")
        kind = action.get("kind")
        if kind == "readCustomerCache":
            key = str(action.get("key") or "")
            hit = customer_cache.get(key)
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
                existing = _workers().unwrap_wasm_envelope(
                    await client.get_customer(json.dumps(params))
                )
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
            except Exception as err:
                if type(err).__name__ != "WorkersSolvaPayError":
                    raise
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
                raise _workers().WorkersSolvaPayError(
                    "ensureCustomerNext createCustomer missing params"
                )
            try:
                created = _workers().unwrap_wasm_envelope(
                    await client.create_customer(json.dumps(params_obj))
                )
                event = {
                    "kind": "customerCreateResult",
                    "ok": True,
                    "customer": created if isinstance(created, dict) else {},
                    "nowMs": _now_ms(),
                }
            except Exception as err:
                if type(err).__name__ != "WorkersSolvaPayError":
                    raise
                event = {
                    "kind": "customerCreateResult",
                    "ok": False,
                    "errorMessage": str(err),
                    "nowMs": _now_ms(),
                }
            continue
        if kind == "updateCustomer":
            payload: dict[str, object] = {"customerRef": action.get("customerRef")}
            patch = action.get("patch")
            if isinstance(patch, dict):
                payload.update(patch)
            try:
                _workers().unwrap_wasm_envelope(await client.update_customer(json.dumps(payload)))
                event = {"kind": "customerUpdateResult", "ok": True, "nowMs": _now_ms()}
            except Exception as err:
                if type(err).__name__ != "WorkersSolvaPayError":
                    raise
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
                raise _workers().WorkersSolvaPayError(
                    "ensureCustomerNext resolved without backendRef"
                )
            cache = action.get("cache")
            if isinstance(cache, dict) and isinstance(cache.get("key"), str):
                ts = cache.get("timestampMs")
                customer_cache[str(cache["key"])] = (
                    backend,
                    int(ts) if isinstance(ts, int | float) else _now_ms(),
                )
            return backend
        raise _workers().WorkersSolvaPayError(f"ensureCustomerNext unknown action kind: {kind}")


async def workers_gate(
    client: _WorkersWasmClient,
    js_module: object,
    customer_ref: str,
    *,
    product: str,
    usage_type: str,
    limits_cache: MutableMapping[str, dict[str, object]],
    customer_cache: MutableMapping[str, tuple[str, int]],
    claimed: dict[str, int],
) -> tuple[str, dict[str, object] | None, dict[str, object] | None]:
    """Drive `gateNext`. Returns (kind, allow_limits_or_none, gate_or_none)."""
    state: object = None
    event: dict[str, object] = {
        "kind": "start",
        "customerRef": customer_ref,
        "product": product,
        "usageType": usage_type,
        "startedMs": _now_ms(),
        "randomUnit": random.random(),
    }
    while True:
        out = _call_js_sync(js_module, "gateNext", {"state": state, "event": event})
        payload = _as_object_map(out, "gateNext")
        raw_state = payload.get("state")
        state = raw_state if isinstance(raw_state, dict) else None
        raw_action = payload.get("action")
        if not isinstance(raw_action, dict):
            raise _workers().WorkersSolvaPayError("gateNext returned unexpected action")
        action = {str(k): v for k, v in raw_action.items()}
        kind = action.get("kind")
        if kind == "ensureCustomer":
            backend = await _workers_ensure_customer(
                client, js_module, str(action.get("customerRef")), customer_cache
            )
            event = {"kind": "customerResolved", "backendRef": backend, "nowMs": _now_ms()}
            continue
        if kind == "readLimitsCache":
            key = str(action.get("key"))
            cached = limits_cache.get(key)
            now = _now_ms()
            if cached is not None:
                event = {
                    "kind": "limitsCacheEntry",
                    "found": True,
                    "remaining": cached["remaining"],
                    "limits": cached.get("limits"),
                    "timestampMs": cached["timestamp"],
                    "nowMs": now,
                }
            else:
                event = {"kind": "limitsCacheEntry", "found": False, "nowMs": now}
            continue
        if kind == "checkLimits":
            delete_key = action.get("cacheDeleteKey")
            if isinstance(delete_key, str):
                limits_cache.pop(delete_key, None)
            args_json = json.dumps(
                {
                    "customerRef": action.get("customerRef"),
                    "productRef": action.get("productRef"),
                    "meterName": action.get("meterName"),
                    "includeCheckoutSession": bool(action.get("includeCheckoutSession")),
                }
            )
            limits_value = _workers().unwrap_wasm_envelope(await client.check_limits(args_json))
            if not isinstance(limits_value, dict):
                raise _workers().WorkersSolvaPayError("checkLimits returned a non-object body")
            dedup_key = (
                f"{action.get('customerRef')}:{action.get('productRef')}:"
                f"{action.get('meterName')}"
            )
            claimed[dedup_key] = claimed.get(dedup_key, 0) + 1
            event = {
                "kind": "limitsResult",
                "limits": _overlay_claimed_limits(
                    js_module, dict(limits_value), claimed[dedup_key]
                ),
                "nowMs": _now_ms(),
            }
            continue
        if kind in ("allow", "gate"):
            _apply_gate_cache(limits_cache, action.get("cache"))
            if kind == "gate":
                gate = action.get("gate")
                if not isinstance(gate, dict):
                    raise _workers().WorkersSolvaPayError(
                        "gateNext gate action missing gate payload"
                    )
                return "paywall", None, dict(gate)
            last_limits = action.get("limits") if isinstance(action.get("limits"), dict) else {}
            return "allow", dict(last_limits) if isinstance(last_limits, dict) else {}, None
        raise _workers().WorkersSolvaPayError(f"gateNext returned unknown action kind: {kind}")


async def workers_invoke_payable(
    spec: WorkersPayableSpec,
    args: dict[str, object],
    *,
    client: _WorkersWasmClient,
    js_module: object,
    limits_cache: MutableMapping[str, dict[str, object]],
    customer_cache: MutableMapping[str, tuple[str, int]],
    claimed: dict[str, int],
) -> dict[str, object]:
    """Port of `_invoke_payable` over wasm exports + `WasmClient`."""
    customer_ref = _resolve_customer_ref(js_module, args, spec.get_customer_ref)
    state: object = None
    event: dict[str, object] = {
        "kind": "start",
        "customerRef": customer_ref,
        "product": spec.product,
        "usageType": spec.usage_type,
        "startedMs": _now_ms(),
    }
    while True:
        out = _call_js_sync(js_module, "invokePayableNext", {"state": state, "event": event})
        payload = _as_object_map(out, "invokePayableNext")
        state = payload.get("state")
        raw_action = payload.get("action")
        if not isinstance(raw_action, dict):
            raise _workers().WorkersSolvaPayError("invokePayableNext returned unexpected action")
        action = {str(k): v for k, v in raw_action.items()}
        kind = action.get("kind")
        if kind == "runGate":
            gate_kind, limits, gate = await workers_gate(
                client,
                js_module,
                str(action.get("customerRef")),
                product=str(action.get("product") or spec.product),
                usage_type=str(action.get("usageType") or spec.usage_type),
                limits_cache=limits_cache,
                customer_cache=customer_cache,
                claimed=claimed,
            )
            if gate_kind == "paywall":
                assert gate is not None
                message = str(gate.get("message") or "Payment required")
                event = {"kind": "gatePaywall", "gate": gate, "message": message}
                continue
            event = {
                "kind": "gateAllow",
                "customerRef": str(action.get("customerRef") or customer_ref),
                "limits": dict(limits or {}),
            }
            continue
        if kind == "invokeHandler":
            limits_raw = action.get("limits")
            handler_limits = (
                {str(k): v for k, v in limits_raw.items()}
                if isinstance(limits_raw, dict)
                else {}
            )
            snapshot = _call_js_sync(
                js_module,
                "buildCustomerSnapshot",
                {
                    "customerRef": str(action.get("customerRef") or ""),
                    "limits": dict(handler_limits),
                },
            )
            if not isinstance(snapshot, Mapping):
                raise TypeError("buildCustomerSnapshot did not return an object")
            ctx = WorkersResponseContext(
                js_module=js_module,
                customer=dict(snapshot),
                product={"reference": spec.product, "name": spec.product},
                product_ref=spec.product,
                limits=handler_limits,
            )
            try:
                returned = await spec.handler(args, ctx)
            except PaywallError as err:
                gate = dict(err.structured_content)
                event = {
                    "kind": "handlerPaywall",
                    "gate": gate,
                    "message": str(err),
                }
                continue
            except Exception as err:
                event = {
                    "kind": "handlerErr",
                    "message": str(err),
                    "nowMs": _now_ms(),
                    "randomUnit": random.random(),
                }
                continue
            envelope = _call_js_sync(js_module, "assertResponseResult", {"value": returned})
            event = {
                "kind": "handlerOk",
                "envelope": envelope,
                "nowMs": _now_ms(),
                "randomUnit": random.random(),
            }
            continue
        if kind == "done":
            track = action.get("track")
            if isinstance(track, Mapping):
                request = track.get("request")
                if isinstance(request, Mapping):
                    _workers().unwrap_wasm_envelope(
                        await client.track_usage(json.dumps(dict(request)))
                    )
            result = action.get("result")
            if not isinstance(result, dict):
                raise _workers().WorkersSolvaPayError("invokePayableNext done missing result")
            return {str(k): v for k, v in result.items()}
        raise _workers().WorkersSolvaPayError(f"invokePayableNext unknown action kind: {kind}")


async def complete_invoke_handler(
    envelope: Mapping[str, object],
    *,
    registry: WorkersPayableRegistry,
    client: _WorkersWasmClient,
    js_module: object,
    limits_cache: MutableMapping[str, dict[str, object]],
    customer_cache: MutableMapping[str, tuple[str, int]],
    claimed: dict[str, int],
) -> dict[str, object]:
    """Run the merchant handler and `mcpResume`."""
    tool = str(envelope.get("tool") or "")
    token = str(envelope.get("token") or "")
    spec = registry.tools.get(tool)
    if spec is None:
        raise _workers().WorkersSolvaPayError(f"unknown payable tool: {tool}")
    args_raw = envelope.get("args")
    args = dict(args_raw) if isinstance(args_raw, dict) else {}
    ref = envelope.get("customerRef")
    if isinstance(ref, str) and "customer_ref" not in args:
        args["customer_ref"] = ref
    handler_envelope = await workers_invoke_payable(
        spec,
        args,
        client=client,
        js_module=js_module,
        limits_cache=limits_cache,
        customer_cache=customer_cache,
        claimed=claimed,
    )
    resumed = _solvapay_call(
        js_module, "mcpResume", {"token": token, "handlerEnvelope": handler_envelope}
    )
    if not isinstance(resumed, dict):
        raise TypeError("mcpResume did not return an object")
    return {"kind": "rpc", "rpc": resumed.get("rpc", resumed)}
