"""Beta Cloudflare Python Worker — Starlette over the wasm engine FFI.

Python Workers are first-class (`Default(WorkerEntrypoint)` + ASGI). The only
bridged import is SolvaPay: Pyodide cannot load the native `solvapay` cdylib,
so we construct `WasmClient` from the staged workerd export
(`src/vendor/server-wasm/runtime/workerd.js`) and pass it to
`solvapay_mcp.workers.build_workers_http_app`.
"""

from __future__ import annotations

import inspect

from workers import WorkerEntrypoint, asgi

from solvapay_mcp.workers import build_workers_http_app
from solvapay_mcp.workers_payable import WorkersPayableRegistry, register_workers_payable

from fetch_market_data import FetchMarketData
from tools import register_tools

_APP = None


def _require(env: object, name: str) -> str:
    value = getattr(env, name, None)
    if value is None or str(value).strip() == "":
        raise RuntimeError(
            f"{name} is not set — check wrangler.jsonc `vars` or run `wrangler secret put {name}`"
        )
    return str(value).strip()


async def _js_wasm_client(env: object) -> object:
    try:
        from workers import import_from_javascript
    except ImportError as exc:
        raise RuntimeError(
            "workers.import_from_javascript is required to load the staged workerd.js"
        ) from exc
    # npm specifiers are not uploaded for Python Workers; stage via
    # scripts/stage-server-wasm.mjs (same artifact as @solvapay/server-wasm).
    # On deploy, import_from_javascript returns the ES module (JsProxy),
    # not a Python awaitable — awaiting it throws TypeError (Worker 1101).
    loaded = import_from_javascript("./vendor/server-wasm/runtime/workerd.js")
    mod = await loaded if inspect.isawaitable(loaded) else loaded
    ready = getattr(mod, "ready", None)
    if callable(ready):
        maybe = ready()
        if inspect.isawaitable(maybe):
            await maybe
    api_base = getattr(env, "SOLVAPAY_API_BASE_URL", None)
    api_base_url = str(api_base).strip() if api_base else None
    # Pyodide calls JS functions without `new`; wasm-bindgen classes need it.
    return mod, mod.WasmClient.new(_require(env, "SOLVAPAY_SECRET_KEY"), api_base_url or None)


def _widget_html() -> str:
    from workers import import_from_javascript

    mod = import_from_javascript("./vendor/server-wasm/runtime/mcp-app-html.js")
    return str(mod.mcpAppHtml)


async def _app(env: object):
    global _APP
    if _APP is not None:
        return _APP
    js_module, js_client = await _js_wasm_client(env)
    api_base = getattr(env, "SOLVAPAY_API_BASE_URL", None)
    api_base_url = str(api_base).strip() if api_base else None
    product_ref = _require(env, "SOLVAPAY_PRODUCT_REF")
    registry = WorkersPayableRegistry()

    def _register(name: str, **kwargs: object) -> None:
        register_workers_payable(registry, name, **kwargs)

    register_tools(
        product=product_ref,
        source=FetchMarketData(),
        register=_register,
    )
    _APP = build_workers_http_app(
        js_client,
        js_module=js_module,
        widget_html=_widget_html,
        api_base_url=api_base_url or None,
        product_ref=product_ref,
        public_base_url=_require(env, "MCP_PUBLIC_BASE_URL"),
        hide_audiences=["ui"],
        payable_registry=registry,
    )
    return _APP


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        app = await _app(self.env)
        return await asgi.fetch(app, request, self.env)
