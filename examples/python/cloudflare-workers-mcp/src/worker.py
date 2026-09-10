"""Beta Cloudflare Python Worker — Starlette over the wasm engine FFI.

Python Workers are first-class (`Default(WorkerEntrypoint)` + ASGI). The only
bridged import is SolvaPay: Pyodide cannot load the native `solvapay` cdylib,
so we construct `@solvapay/server-wasm` `WasmClient` and pass it to
`solvapay_mcp.workers.build_workers_http_app`.
"""

from __future__ import annotations

from workers import WorkerEntrypoint, asgi

from solvapay_mcp.workers import build_workers_http_app

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
            "workers.import_from_javascript is required to load @solvapay/server-wasm"
        ) from exc
    mod = await import_from_javascript("@solvapay/server-wasm")
    ready = getattr(mod, "ready", None)
    if callable(ready):
        maybe = ready()
        if hasattr(maybe, "__await__"):
            await maybe
    api_base = getattr(env, "SOLVAPAY_API_BASE_URL", None)
    api_base_url = str(api_base).strip() if api_base else None
    return mod.WasmClient(_require(env, "SOLVAPAY_SECRET_KEY"), api_base_url or None)


async def _app(env: object):
    global _APP
    if _APP is not None:
        return _APP
    js_client = await _js_wasm_client(env)
    _APP = build_workers_http_app(
        js_client,
        product_ref=_require(env, "SOLVAPAY_PRODUCT_REF"),
        public_base_url=_require(env, "MCP_PUBLIC_BASE_URL"),
        hide_audiences=["ui"],
    )
    return _APP


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        app = await _app(self.env)
        return await asgi.fetch(app, request, self.env)
