# SDK architecture (contributors)

This is the canonical **as-built** reference for the `solvapay-sdk` monorepo. It
describes the SDK as it exists today, after the Rust-core migration: one Rust
semantic core reused by every language surface, with thin language facades on top.

For _why_ it is built this way (decisions, rationale, per-step research), see
[`rust-core-sdk-redesign-v2.md`](./rust-core-sdk-redesign-v2.md). For _how far_
the migration got, see [`rust-migration-map.md`](./rust-migration-map.md). For
_how the code is generated_, see [`sdk-codegen.md`](./sdk-codegen.md).

## Two-layer model

The SDK is two layers:

1. **Language facades** — thin, idiomatic packages that own type conversion,
   env/config resolution, and host concerns (timers, caches, event loops).
2. **One Rust semantic core** — models, validation, request construction,
   response normalization, retry _schedules_, paywall decisions, webhook
   verification, and the shared MCP payload contracts. Written once, reused by
   every surface.

The governing rule is the **thin-facade rule** (redesign-v2 §1): every facade —
TypeScript included — is a type-conversion shim over the Rust core. Semantic
logic lives in Rust unless it appears on the [never-moves list](#what-stays-in-the-facades)
below. Divergence between surfaces is a build failure (cross-language
signature-parity suites), not a support ticket.

Two boundary rules the core must never break (redesign-v2 §4.2):

- **No env-var reads in core.** Env resolution stays in the facades; core
  receives explicit config. This is what makes browser-WASM capability
  separation verifiable. The written contract is
  [`configuration.md`](./configuration.md).
- **No timers in core.** The retry engine computes _schedules_ (pure); the
  binding owns the actual sleep. Deduplication and cache intervals stay
  host-side entirely.

## Component diagram

Facades sit over specialized bindings, which sit over the Rust workspace
(reproduced from redesign-v2 §4.1):

```mermaid
flowchart TB
  subgraph facades ["Language facades (public API)"]
    TS["TypeScript facade<br/>@solvapay/server"]
    PY["Python facade<br/>solvapay (PyPI)"]
    RB["Ruby facade<br/>solvapay (gem)"]
    GO["Go facade<br/>go module"]
    RS["Rust facade<br/>solvapay (crates.io)"]
    REACT["@solvapay/react<br/>TS-only"]
  end

  subgraph bindings ["Specialized bindings"]
    NAPI["napi-rs<br/>Node native"]
    WASM["wasm-bindgen<br/>browser / Workers / Deno"]
    PYO3["PyO3 + maturin"]
    MAG["Magnus + rb-sys"]
    WAZERO["wazero + embedded WASM<br/>wasm32-wasip1"]
    CABI["Optional C ABI<br/>cbindgen + opaque handles"]
  end

  subgraph rust ["Rust workspace"]
    LOGIC["solvapay-core<br/>pure logic, no transport"]
    DTO["solvapay-dto<br/>generated wire models"]
    TRANSPORT["solvapay-transport<br/>transport trait + client shell"]
    FACADE["solvapay<br/>public facade crate"]
  end

  REACT --> TS
  TS --> NAPI
  TS --> WASM
  PY --> PYO3
  RB --> MAG
  GO --> WAZERO
  RS --> FACADE
  NAPI --> TRANSPORT
  WASM --> TRANSPORT
  PYO3 --> TRANSPORT
  MAG --> TRANSPORT
  WAZERO --> TRANSPORT
  CABI --> TRANSPORT
  FACADE --> TRANSPORT
  TRANSPORT --> DTO
  TRANSPORT --> LOGIC
  DTO --> LOGIC
```

## Repository layout

The monorepo holds both the TypeScript packages and the Rust workspace.

```text
solvapay-sdk/
├─ sdks/                # Language SDKs / bindings
│  ├─ typescript/       # published @solvapay/* TypeScript packages
│  │  ├─ core/
│  │  ├─ server/
│  │  ├─ react/
│  │  ├─ react-supabase/
│  │  ├─ mcp/
│  │  ├─ mcp-core/
│  │  ├─ auth/
│  │  └─ next/
│  ├─ rust/             # public crates.io facade crate (`solvapay`)
│  ├─ node-native/      # napi-rs (Node native)
│  ├─ wasm/             # wasm-bindgen (edge + browser profiles)
│  ├─ python/           # PyO3 + maturin
│  ├─ ruby/             # Magnus + rb-sys
│  ├─ go/               # wazero + embedded wasm32-wasip1 core
│  │  └─ mcp/           # payable-MCP adapter over the Go MCP SDK
│  └─ capi/             # optional cbindgen C ABI
├─ core/                # Semantic crates (published to crates.io except as noted)
│  ├─ solvapay-core/       # pure logic; serde/hmac only; no HTTP, no tokio
│  ├─ solvapay-dto/        # generated wire models + SDK overlays
│  ├─ solvapay-export/     # proc-macro marker scanned by dto-gen
│  └─ solvapay-transport/  # transport trait, reqwest/fetch impls, client shell
├─ tools/
│  ├─ shared/           # layout loaders + `repo-paths` crate
│  ├─ codegen/          # dto-gen + TS gen wrappers
│  ├─ conformance/      # fixture-runner, live-contract, shadow-invoker
│  ├─ repo/             # repo gates (required-checks, unwrap, publish graph)
│  ├─ cli/              # `solvapay` CLI (npx solvapay init)
│  ├─ create-solvapay/  # scaffolder for new MCP apps
│  └─ init/             # shared init/env logic
├─ internal/
│  ├─ fuzz/             # detached libFuzzer workspace (not a cargo member)
│  ├─ demo-services/    # private
│  ├─ test-utils/       # private
│  └─ tsconfig/         # private `@solvapay/tsconfig`
├─ contract/            # OpenAPI snapshot, manifest, golden fixtures
├─ examples/            # per-language examples (go/python/ruby/rust/typescript)
├─ docs/
├─ Cargo.toml           # Cargo workspace (members under core/, sdks/, tools/)
├─ pnpm-workspace.yaml
├─ turbo.json
└─ package.json
```

### Rust crate responsibilities

| Crate                | Responsibility                                                                                                                            | Dependency discipline                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `solvapay-core`      | Validation, retry policy, webhook verify, helper decision cores, paywall, business/credit/seller logic, MCP payload builders, error model | `serde`, `hmac`/`sha2`, `subtle`. **No** `reqwest`, **no** `tokio`, **no** `wasm-bindgen` — this is what keeps browser WASM small |
| `solvapay-dto`       | Generated wire models + SDK overlays                                                                                                      | `serde` only; generated — never hand-edited                                                                                       |
| `solvapay-export`    | Inert `#[solvapay_export]` marker scanned by dto-gen                                                                                      | Proc-macro crate; no runtime logic                                                                                                |
| `solvapay-transport` | `Transport` trait, `reqwest`/rustls (native) + Fetch (wasm32) impls, client shell, 36 routed methods + 5 MCP composites (41 total)        | Depends on core + dto; async but runtime-agnostic                                                                                 |
| `solvapay`           | Public crates.io facade: idiomatic re-exports + `blocking` feature                                                                        | Depends on transport + core; ergonomics only, no new logic                                                                        |

## What's implemented where

The core ask of this doc: a map from each behavior to its Rust source and the
TypeScript facade that delegates to it. All paths are verified on disk.

**Pure logic — `solvapay-core`:**

- **Webhook verify** → `core/solvapay-core/src/webhook.rs` (+ shared
  `hmac_util.rs`) ← `sdks/typescript/server/src/{native,webhook-wasm}.ts`
- **Retry policy** (schedules, not sleeps) → `.../src/retry.rs`
- **Paywall** → `paywall_state.rs`, `paywall_gate.rs`, `paywall_decision.rs`,
  `paywall_payload.rs`, plus the host-callback sequencers `gate_driver.rs`
  (`gate_next`) and `invoke_payable.rs` (`invoke_payable_next`) so every
  language facade runs the same ten-step gate and payable invocation
- **Helper decision cores** → `customer_sync.rs`, `payment.rs`, `checkout.rs`,
  `purchase.rs`, `renewal.rs`, `usage.rs`, `limits.rs`, `plans.rs`, `product.rs`,
  `route_error.rs`, `activation.rs`, `auth_resolution.rs`, `balance_poll.rs`
  (shared shape in `helper_error.rs`)
- **Core value helpers** → `business_details.rs`, `credit_display.rs`,
  `seller_identity.rs`
- **MCP payload contracts** → `src/mcp/` (`tool_names.rs`, `descriptors.rs`,
  `envelope.rs`, `paywall_tool_result.rs`, `payable_tool_result.rs`)
- **Error model** → `error.rs` (`SdkError`) — see [error-handling.md](./error-handling.md)

**HTTP client — `solvapay-transport`:** the `Transport` trait plus the reqwest
(native) and Fetch (wasm32) implementations and the client shell that wires auth
headers, idempotency, and retry, with 36 routed client methods plus 5
routeless MCP composites (`mcpBootstrap`, `mcpCallBuiltinTool`, `mcpReadResource`,
`mcpOauthRequest`, `mcpDispatch`) →
`core/solvapay-transport/src/{transport,reqwest_transport,fetch_transport,shell,client}.rs`.

**TypeScript delegation glue:**

- Node → `sdks/typescript/server/src/native.ts` (+ `native-decisions.ts`,
  `native-registry.ts`) over `sdks/node-native/src/*` (napi-rs)
- Edge/browser → `sdks/typescript/server/src/wasm.ts` over `sdks/wasm`
  (wasm-bindgen)
- `@solvapay/core` is Rust-backed (its helpers delegate to the core via the
  same bindings)

## Language surfaces

Five first-party surfaces, plus an optional C ABI. All expose the same public
capabilities; only syntax differs (cross-surface parity is enforced in CI).

| Surface      | Binding toolchain                                                                    | Status                                                                   |
| ------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| TypeScript   | napi-rs (Node native), wasm-bindgen (edge + browser)                                 | GA — the published `@solvapay/*` packages                                |
| Python       | PyO3 + maturin (`abi3` wheels) + `solvapay-mcp` adapter                              | Built + tested in CI; publish is TestPyPI-gated (not GA)                 |
| Ruby         | Magnus + rb-sys (platform gems) + `solvapay-mcp` adapter                             | Built + tested in CI; publish gated (not GA)                             |
| Go           | wazero + embedded `wasm32-wasip1` core (`//go:embed`) + `solvapay-go/mcp` adapter    | Built + tested in CI; subtree module release (not GA)                    |
| Rust         | `solvapay` crate (thin facade, no FFI) + `blocking` feature + `solvapay-mcp` adapter | Built + tested in CI; crates.io publish gated (not GA)                   |
| C ABI (opt.) | cbindgen + opaque handles (`sdks/capi`)                                              | Generated `dispatch.rs` (golden-tested); opaque handles + `ctest` engine |

The TypeScript surface further splits by runtime:

- **Node** → napi-rs native package (unsupported platforms fail to load)
- **Edge / Workers / Deno** → the `edge` wasm-bindgen profile (`@solvapay/server-wasm`)
- **Browser** → the `browser` wasm-bindgen profile — a public-safe pure-logic
  subset only (no webhook / no secret-key symbols)

## Runtime strategy

`@solvapay/server` picks the right binding per runtime, so consumers keep one
import style:

- **Node** loads the napi-rs native addon. If no prebuild matches the platform,
  load fails — there is no WASI fallback. Edge/browser use `@solvapay/server-wasm`.
- **Edge/browser** load the wasm-bindgen build via export conditions
  (`deno`/`workerd`/`worker`/`edge-light`/`browser` before generic
  `import`/`default`).

**Capability-separated builds** (redesign-v2 §7.1) keep secret-key operations out
of the browser: the `browser` profile compiles only the public-safe subset, and a
CI symbol audit (`sdks/wasm/scripts/check-browser-symbols.mjs`)
allowlists exactly the public-safe exports. Webhook verification and the
transport client are `edge`-gated, so no secret-key `WasmClient` symbol can enter
the browser module. The structural gate is the Cargo feature graph plus the
export audit — not a runtime check. The **browser** wasm-bindgen profile also
omits the five MCP composite client ops; those exist on Node napi, the edge
WASM profile, and the native Python/Ruby/Go/Rust/C adapters.

TypeScript `client.ts` operation wrappers are generated (`client.runtime.generated.ts`).
JSON-RPC MCP routing for TypeScript (fetch JSON mode) and Python (Starlette
`create_mcp_engine_starlette`) uses the same `mcpDispatch` / `mcpResume` loop
as Rust, Go, Ruby, and C. MCP protocol transport (SSE, sessions) stays
per-language. Browser MCP App widgets load `@solvapay/core/browser-wasm`
(no portable TypeScript fallback).

**Committed WASM blobs.** Two binary trees stay tracked on purpose; they are
not the same as the gitignored napi `.wasm` under `sdks/node-native/`.

- `sdks/go/solvapay_core.wasm` is `//go:embed`'d. The Go module has no
  install-time compile step, and `go:embed` cannot follow a symlink, so the
  guest blob has to live next to the Go sources and is staleness-gated in CI.
- `sdks/wasm/pkg/**` is what `@solvapay/server-wasm` publishes. Its `build`
  script is `check-artifacts-present` (not a wasm-bindgen rebuild), so
  TypeScript contributors can `pnpm build:packages` without a Rust toolchain.

Do not gitignore those two trees. Node's optional native `.node` / WASI
artifacts are installed or built per platform, which is why they stay
untracked.

**Runtime bindings:** `@solvapay/core` and `@solvapay/server` are Rust-only after
Steps 52/53 — Node uses `@solvapay/server-native` (napi), edge/browser uses
`@solvapay/server-wasm`. Missing bindings throw; there is no `SOLVAPAY_IMPL`
rollback flag. See [testing.md](./testing.md).

## How code generation works

The five surfaces are generated from two committed inputs — the OpenAPI snapshot
and the reviewed contract manifest — lowered to a canonical IR and rendered by
per-surface emitters:

```text
Backend OpenAPI ──► snapshot (committed) ──┐
                                           ├──► pnpm gen (dto-gen) ──► DTOs, facades,
SDK contract manifest (reviewed) ──────────┘        binding glue, parity suites, fixtures
```

`pnpm gen` regenerates Rust DTOs, TS overlays/marshalling, Node/WASM/Python/Ruby/
Go/Rust binding shims, and the signature-parity suites. Hand-editing generated
files fails CI (`@generated` header gate + `pnpm gen:check`). The **full runbook**
(scaffolding operations, binding reconciliation, gates, failure modes) lives in
[`sdk-codegen.md`](./sdk-codegen.md) — this doc does not duplicate it.

## What stays in the facades

The operative test: **any decision expressible as JSON-in → JSON-out belongs
in core.** Facades own host I/O, timers, caches, and registration glue.

Hand-written and never moved to Rust:

- The entire `@solvapay/react` package (components, hooks, Stripe.js glue, i18n)
- Framework adapters (`http.ts`, `next.ts`, `mcp.ts`) and `fetch` handlers —
  thin shells that delegate to the Rust decision/client cores. Payable
  `gate` / `invoke` sequencing is `gate_next` / `invoke_payable_next` in
  `solvapay-core` (`gate_driver.rs`, `invoke_payable.rs`). Top-up process
  sequencing is `topup_process_next`. Hosts run the driver loops.
- `createSolvaPay` factory ergonomics
- `createRequestDeduplicator` + limits-cache plumbing (host timers/maps)
- `@solvapay/auth`, `@solvapay/next`, `@solvapay/cli`, `create-solvapay`, `@solvapay/init`
- MCP SDK registration glue and transport (OAuth bridge, bearer, SSE/session).
  Descriptor text, CSP merge, narration (including virtual-tool markdown),
  and the default `ctx.gate()` stub are Rust ops. Virtual-tool _registration_
  remains TypeScript-only by design — the other languages would still need
  host glue even with shared text.
  The hand-written `registerPayable` / `ctx` surface is pinned by
  [`mcp-authoring-adapter-contract.md`](./mcp-authoring-adapter-contract.md).
- Per-language examples under `examples/<language>/`

**Nil-core helper deviation.** `payment-method`, `auto-recharge`, `merchant`,
and the HTTP `trackUsage` helper deliberately have no Rust decision core.
Do not grow new semantic logic there — that is where facade copies quietly
drifted (the payable-path `metadata.action` bug). New decisions go through
a JSON-in / JSON-out core function.

## Design principles

- Semantic logic lives in Rust once; facades stay thin (thin-facade rule).
- Keep secrets in server code only; browser builds are capability-separated.
- No env reads or timers in the core; facades own host concerns.
- Prefer shared types from the core/`@solvapay/core` over duplicated interfaces.
- Generated surfaces are never hand-edited — change the manifest and rerun `pnpm gen`.

## Build and release model

- `turbo` orchestrates workspace tasks; TS packages build with `tsup`.
- `pnpm gen` produces the committed generated surfaces; committed WASM/glue
  artifacts mean TypeScript contributors do not need a Rust/wasm-bindgen
  toolchain for `pnpm build:packages`.
- Per-package versioning is driven by Changesets; branch/release flow is in
  [`CONTRIBUTING.md`](../../CONTRIBUTING.md) and
  [`docs/publishing.mdx`](../publishing.mdx).

## Where to read next

- [`mcp-authoring-adapter-contract.md`](./mcp-authoring-adapter-contract.md) — layer-3 `registerPayable` / `ctx` contract and `contract/mcp-fixtures/` corpus
- [`sdk-codegen.md`](./sdk-codegen.md) — regenerating DTOs, facades, binding glue (`pnpm gen`)
- [`codegen-ast-derivation.md`](./codegen-ast-derivation.md) — derive binding descriptors and conformance harnesses from Rust (after step 55)
- [`rust-core-sdk-redesign-v2.md`](./rust-core-sdk-redesign-v2.md) — deep spec, decisions, and rationale
- [`rust-migration-map.md`](./rust-migration-map.md) — per-step migration status
- [`testing.md`](./testing.md) — fixtures, dual-impl suites, parity, cargo gates
- [`error-handling.md`](./error-handling.md) — the `SdkError` model and stable codes
- [`performance.md`](./performance.md) — WASM budgets and measurement methodology
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — setup and pull request workflow
- [`docs/publishing.mdx`](../publishing.mdx) — Changesets, publish workflows, and the unpublished-dependency gate
- package-level `README.md` files for package-specific constraints
