# SDK testing guide (contributors)

This page is for contributors testing code inside the `solvapay-sdk` monorepo.
Because shared behavior now lives in one Rust core reused by every language
facade (see [architecture.md](./architecture.md)), the test strategy centers on
**one behavioral truth replayed everywhere**: golden fixtures, a shared fixture
runner, dual-implementation suites, a shadow harness, and cross-language
signature parity.

## Test architecture

### Golden fixtures — the single behavioral truth

`contract/fixtures/` holds behavioral golden fixtures (webhook signatures, retry
schedules, paywall classification/gate/payload, all 36 client request/response
shapes, and every helper decision core). Each fixture is a language-neutral
input → expected-output record. These are the source of truth for behavior; every
surface must reproduce them byte-for-byte.

- **TypeScript side:** the fixture harness (`scripts/lib/fixture-harness.ts`)
  replays fixtures against the TS facades. Run via `pnpm test:contract`.
- **Rust side:** `rust/tools/fixture-runner` replays the same fixtures against
  the Rust core (`cargo run -q -p fixture-runner -- ../contract/fixtures` from
  `rust/`), reporting `parsed`/`executed`/`passed`/`failed` counts.

A behavior change is a fixture diff, reviewed like code.

### Runtime bindings

`@solvapay/core` and `@solvapay/server` always dispatch to Rust (napi on Node,
WASM on edge/browser). Contract fixtures (`pnpm test:contract`) exercise that
path directly — there is no `SOLVAPAY_IMPL` selection flag. `@solvapay/mcp-core`
keeps a TypeScript fallback when the binding is not installed (edge/standalone).

### Shadow harness

The shadow harness compares the WASM client facade against the Rust CLI on the
same inputs and flags any wire divergence:

```bash
pnpm shadow:selftest   # offline: IDENTICAL + intentional-divergence self-check
pnpm shadow:run        # live comparison (SOLVAPAY_SHADOW_* env, manual/dispatch)
```

The Rust side is `rust/tools/shadow-invoker`; the TS driver is
`scripts/shadow/`.

### Cross-language signature parity

Generated signature-parity suites assert every surface exposes the same
operations with the same shapes. They are emitted by `pnpm gen` and run per
language in CI (TS `signature-parity.generated.test.ts`, plus the Python/Ruby/
Rust/Go generated parity tests). Offline drift is caught by `pnpm parity:check`.

### Rust gates

Run from the `rust/` directory:

```bash
cargo test --workspace          # core, transport, dto-gen, bindings
cargo clippy --workspace --all-targets -- -D warnings
./scripts/check-no-unwrap.sh    # bans .unwrap()/.expect()/panic outside #[cfg(test)]
```

CI also builds/tests the wasm32 target, each language binding
(`cargo test -p solvapay-{python,ruby,c}`, the Go/wazero suite), and the
`doc_coverage` gate for generated doc comments.

### Per-language conformance

Each binding runs the shared golden fixtures through its own facade (Python/Ruby/
Go/Rust contract suites in CI) so conformance is proven per surface, not just in
the core.

## Package-level tests

- **Unit tests:** package behavior with isolated mocks/stubs.
- **Integration tests:** end-to-end flows across adapters and HTTP handlers.
- **Example validation:** verify runnable examples stay in sync with facades.

### Stub mode

Use stub mode for deterministic local/CI testing without real API credentials:

```ts
import { createSolvaPay } from '@solvapay/server'

// No API key => stub mode
const solvaPay = createSolvaPay()
```

You can also inject a custom stub client for tighter control over limits,
storage, or artificial delay.

### Recommended patterns

- Create a fresh client in `beforeEach` to keep tests isolated.
- Keep free-tier limits small (e.g. `1-5`) to exercise paywall paths quickly.
- Assert structured paywall error fields, not only message text.
- Use in-memory storage by default for speed and reliability.

### What to test

- purchase checks and limit checks
- customer resolution and creation paths
- paywall errors and checkout URL generation
- usage event tracking behavior
- framework adapters (`http`, `next`, and `mcp`)

## Local commands

```bash
pnpm test                       # full monorepo TS suite
pnpm -F @solvapay/server test
pnpm -F @solvapay/react test
```

Contract / codegen gates (when touching the manifest, OpenAPI snapshot, fixtures,
or emitters):

```bash
pnpm gen:check                  # regen + git-diff drift gate
pnpm manifest:check
pnpm parity:check
pnpm test:contract
```

See [`sdk-codegen.md`](./sdk-codegen.md) for the full regenerate workflow.

## CI expectations

Before opening a PR, make sure:

- all relevant package tests pass
- generated surfaces are up to date (`pnpm gen:check`) if you changed contract
  inputs, fixtures, or dto-gen
- fixtures pass on both sides (`pnpm test:contract` + the `fixture-runner`) when
  you change behavior
- Rust gates pass (`cargo test --workspace`, `cargo clippy`, `check-no-unwrap.sh`)
  when you touch `rust/`
- new behavior has coverage in unit, integration, or fixture tests
- docs links are valid (`pnpm docs:validate-links`)

## Where to read next

- [`architecture.md`](./architecture.md) for the two-layer model and surface map
- `CONTRIBUTING.md` for contributor workflow
- [`sdk-codegen.md`](./sdk-codegen.md) for OpenAPI → five-surface regeneration
- [`error-handling.md`](./error-handling.md) for the cross-language error model
- `examples/` for runnable integration references
- `packages/*/README.md` for package-specific usage constraints
