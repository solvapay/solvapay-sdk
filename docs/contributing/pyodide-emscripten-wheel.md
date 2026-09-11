# PyEmscripten wheel for Python Workers (spec only)

Follow-up that makes `import solvapay_mcp` work unmodified on Cloudflare Python
Workers and **deletes** `solvapay_mcp.workers` plus its `.pyi` parity gate.

The wheel is **built locally and consumed by path**. It is never published to
PyPI. `cargo publish` / `maturin publish` / version bumps are out of scope.

## Why this exists

`solvapay` is a maturin/PyO3 `cdylib` (`solvapay._solvapay`). Pyodide loads
pure-Python packages, Pyodide-bundled packages, or **PyEmscripten** wheels. A
native abi3 `.so` is none of those. `pydantic-core` already ships this way and
is on Cloudflare's supported list — the shape is not exotic.

The shipping Python Worker example uses an interim JS FFI shim over
`@solvapay/server-wasm` because that artifact is already built and tested.

## Feasibility: will pywrangler bundle a path wheel?

Cloudflare's Python dependency docs describe bundling in **PyPI** terms
(package name + version, resolved against the Pyodide index / PyPI). There is
no documented `file:` / path-wheel install for `pywrangler`.

**If pywrangler is PyPI-only, this follow-up is blocked by the no-publish
rule.** Do not invent a workaround (vendoring a rebuilt wheel under a fake
PyPI name, publishing an `emscripten` extra). Re-measure against current
`pywrangler` / `workers-py` docs before starting implementation. If it still
cannot take a local wheel, stop and change the constraint — do not ship a
mask.

The repo already has the native path pattern in
[`sdks/python-mcp/pyproject.toml`](../../sdks/python-mcp/pyproject.toml):

```toml
[tool.uv.sources]
solvapay = { path = "../python", editable = true }
```

That is `uv` on CPython, not pywrangler on Pyodide.

## Cost 1 — async bridge (measured)

`sdks/python/src/client.rs` has **46** `pyo3_async_runtimes::tokio::future_into_py`
sites. `sdks/python/src/runtime.rs` initializes tokio with
`Builder::new_multi_thread()` (`rt-multi-thread` in
[`sdks/python/Cargo.toml`](../../sdks/python/Cargo.toml)).

Pyodide has **no threads**. The binding must re-plumb onto a single-threaded
runtime or a non-tokio executor before the wheel will load. Count the sites
again when the work starts; do not leave `rt-multi-thread` behind a silent
fallback.

## Cost 2 — a third `Transport` (measured)

On `wasm32-unknown-emscripten`, `target_os` is `emscripten`. Neither arm in
[`core/solvapay-transport/src/lib.rs`](../../core/solvapay-transport/src/lib.rs)
matches:

| Impl               | cfg                                                  | Emscripten?            |
| ------------------ | ---------------------------------------------------- | ---------------------- |
| `ReqwestTransport` | `not(target_arch = "wasm32")`                        | no                     |
| `FetchTransport`   | `all(target_arch = "wasm32", target_os = "unknown")` | no (`os = emscripten`) |

There is **no `Transport` impl** on that target today. `FetchTransport` cannot
be reused: wasm-bindgen / web-sys target `wasm32-unknown-unknown` only.

Model the new impl on
[`sdks/go/wasm/src/host_transport.rs`](../../sdks/go/wasm/src/host_transport.rs):
`Transport` over a `#[link(wasm_import_module = "solvapay_host")] extern "C"`
host import, calling back into Python `httpx` or JS `fetch`. Same JSON wire
as the Go guest (`method`, `url`, `headers`, `body` → `status`, `body`).

## Recurring cost — Pyodide ABI pin

The Worker compatibility date selects a Pyodide ABI. Every Pyodide bump
requires rebuilding this wheel and re-pinning the example. Budget that as a
release chore, not a one-off.

## Delete list when the wheel works

- `sdks/python-mcp/python/solvapay_mcp/workers.py`
- `sdks/python-mcp/python/solvapay_mcp/workers_payable.py`
- `sdks/python-mcp/tests/test_workers_parity.py`
- The example's `@solvapay/server-wasm` FFI and `WasmApiClient`
- Restore `create_solvapay_mcp_server` + `create_mcp_oauth_starlette` +
  `build_http_app()` unchanged on the Worker
