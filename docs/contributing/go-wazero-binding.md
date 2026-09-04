# Go binding: wazero + committed WASI guest

The Go facade (`sdks/go`, published as `github.com/solvapay/solvapay-sdk/sdks/go`) does
not link `sdks/capi` and does not use cgo. It embeds a `wasm32-wasip1` build of
`solvapay-core` + `solvapay-transport` (`solvapay_core.wasm`) and runs that
guest under [wazero](https://github.com/tetratelabs/wazero). HTTP leaves the
guest through a host import (`solvapay_host::transport_send`) implemented in
Go `net/http`.

This is unusual. Among the SDKs we surveyed, nothing comparable ships a
payments core this way; OpenDAL's `purego` path is the nearest neighbour and
still calls a native library. Both halves of the trade are recorded here so
the next proposal to "just use cgo" has to reopen a written decision.

## Why wazero wins here

- **No per-platform Go artifacts.** One git tag is the module plus the
  embedded wasm. Consumers `go get` without a C toolchain, without
  `CGO_ENABLED=1`, and without a matrix of `.so` / `.dylib` / `.dll` files.
- **No cgo in the customer process.** Integrators stay on pure Go. CI and
  `GOOS`/`GOARCH` cross-compilation stay ordinary.
- **One rebuild path.** `sdks/go/scripts/build-wasm.sh` produces the guest;
  `.github/workflows/publish-go.yml` rebuilds it and `git diff --exit-code`
  fails if the committed blob does not match source. The facade and the guest
  cannot silently diverge at publish time.
- **Shared core.** The guest is the same Rust core the other facades compile
  natively. Fixture envelopes and error codes stay one implementation.

## What it costs

- **Native performance.** wazero interprets/compiles wasm on first use
  (process-wide compilation cache). This is slower than a cgo cdylib or the
  napi/PyO3/Magnus facades. Acceptable for an SDK that is network-bound on
  almost every call.
- **Go cannot reuse `sdks/capi`.** The C ABI is a native `cdylib`/`staticlib`.
  Sharing it would reintroduce per-platform artifacts and a C toolchain for
  consumers — the thing this design avoids. Do not "simplify" Go onto
  `solvapay-c` without reopening this ADR.
- **`panic = "abort"`.** The `wasm-release` profile aborts the instance on
  panic. wazero surfaces that as a host error; it does not `catch_unwind`
  inside the guest. See [error-handling.md](./error-handling.md) §7.6.

## Staleness

`publish-go.yml` rebuilds `solvapay_core.wasm` and requires a clean
`git diff` against the committed file. That is the whole skew guard: there is
no facade↔native version check because there is no separate native package.
`BuildInfo()` returns the guest `{version, coreSha}` stamp. `coreSha` is
`unknown` unless the committed guest was built with `SOLVAPAY_CORE_SHA` set
(do not stamp it on the publish rebuild — that would break the
byte-identical staleness check).

## Exit criteria — reopen this decision when

1. A consumer workload is CPU-bound on the guest (not HTTP) and the wazero
   cost is measurable and unacceptable.
2. We are willing to publish per-`GOOS`/`GOARCH` artifacts and require cgo
   (or a prebuilt C library) for every Go integrator.
3. wazero drops `wasm32-wasip1` support or the guest ABI we rely on.

Until one of those is true, "use cgo" and "share `sdks/capi`" are closed.
