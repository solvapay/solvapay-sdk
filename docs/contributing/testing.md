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

- **TypeScript side:** the fixture harness (`tools/conformance/lib/fixture-harness.ts`)
  replays fixtures against the TS facades. Run via `pnpm test:contract`.
- **Rust side:** `tools/conformance/fixture-runner` replays the same fixtures against
  the Rust core (`cargo run -q -p fixture-runner -- contract/fixtures` from the
  repo root), reporting `parsed`/`executed`/`passed`/`failed` counts.

A behavior change is a fixture diff, reviewed like code.

### Runtime bindings

`@solvapay/core` and `@solvapay/server` always dispatch to Rust (napi on Node,
WASM on edge/browser). Contract fixtures (`pnpm test:contract`) exercise that
path directly — there is no `SOLVAPAY_IMPL` selection flag. `@solvapay/mcp-core`
keeps a TypeScript fallback when the binding is not installed (edge/standalone).

### Shadow harness

`pnpm shadow:selftest` is a **required CI check** (not migration residue). It
compares the published npm facade path (WASM `FetchTransport`) against the Rust
`shadow-invoker` CLI on the same inputs and flags any wire divergence:

```bash
pnpm shadow:selftest   # offline: IDENTICAL + intentional-divergence self-check
pnpm shadow:run        # live comparison (SOLVAPAY_SHADOW_* env, manual/dispatch)
```

The Rust side is `tools/conformance/shadow-invoker`; the TS orchestrator is
`tools/conformance/shadow/` (report keys `facadeNormalized` / `facadeRaw` /
`facadeWire`, `args.facade`, side label `facade`).

### Cross-language signature parity

Generated signature-parity suites assert every surface exposes the same
operations with the same shapes. They are emitted by `pnpm gen` and run per
language in CI (TS `signature-parity.generated.test.ts`, plus the Python/Ruby/
Rust/Go generated parity tests). Offline drift is caught by `pnpm parity:check`.

### Rust gates

Run from the repo root:

```bash
cargo test --workspace          # core, transport, dto-gen, bindings
cargo clippy --workspace --all-targets -- -D warnings
./tools/repo/check-no-unwrap.sh # bans .unwrap()/.expect()/panic outside #[cfg(test)]
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

One command per job:

```bash
pnpm test                       # TypeScript package suite (turbo)
pnpm test:contract              # tools/ contract tests (vitest)
pnpm test:fixtures              # Rust fixture-runner
pnpm test:all                   # core language surfaces (add --native for bindings)
pnpm test:live                  # live-contract drivers against a running stack
pnpm gates                      # local contract gates (also the pre-push hook)
pnpm build:all                  # core builds (add --native for bindings)
```

`pnpm test:live` is opt-in. It is not part of `pnpm test`, `pnpm gates`, pre-push, or CI.
Without `SOLVAPAY_SHADOW_BASE_URL` and `SOLVAPAY_SHADOW_API_KEY` it fails fast with that
requirement named — that message is correct, not a broken script.

`pnpm build:native` and `pnpm test:native` rebuild host-target Node bindings and can
overwrite tracked `sdks/node-native/index.js` / `index.d.ts` plus non-deterministic
`sdks/wasm/pkg/` and `sdks/go/solvapay_core.wasm` blobs. Restore those paths before
pushing (`git checkout -- sdks/node-native/index.d.ts sdks/node-native/index.js
sdks/wasm/pkg/ sdks/go/solvapay_core.wasm`) unless you intentionally regenerated
the napi loader.

The Go WASI guest build copies the cargo artifact when `wasm-opt` is missing. That
fallback is intentional; CI omits Binaryen so linux/amd64 bytes stay canonical.
`brew install binaryen` shrinks a local artifact only — do not record that blob.

### `test:live` against the local platform

The SDK routes are served by five backend services. The provider-app proxy at
`http://localhost:3010` fans `/v1/*` out to the owner. Identity on `:3001` is
the wrong target.

```bash
export SOLVAPAY_SHADOW_BASE_URL=http://localhost:3010
export SOLVAPAY_SHADOW_API_KEY=sk_sandbox_...   # Developers → Secret keys
pnpm test:live
```

`test:live` also sets `USE_REAL_BACKEND=true` and `SOLVAPAY_SECRET_KEY` for the
`@solvapay/server` integration suite. JSON reports land under
`contract/shadow/output/`.

```bash
pnpm -F @solvapay/server test
pnpm -F @solvapay/react test
```

Contract / codegen gates (when touching the manifest, OpenAPI snapshot, fixtures,
or emitters):

```bash
pnpm gen:check                  # regen + working-tree idempotence drift gate
pnpm manifest:check
pnpm parity:check
pnpm test:contract
```

See [`sdk-codegen.md`](./sdk-codegen.md) for the full regenerate workflow.

## Real-backend integration (`@solvapay/server`)

These suites hit a live platform. Point them at the provider-app proxy on
`:3010` — not identity-service on `:3001`.

```bash
# sdks/typescript/server/.env
USE_REAL_BACKEND=true
SOLVAPAY_SECRET_KEY=sk_sandbox_...
SOLVAPAY_API_BASE_URL=http://localhost:3010
STRIPE_TEST_SECRET_KEY=sk_test_...   # payment suite only
```

```bash
pnpm --filter @solvapay/server test:integration
pnpm --filter @solvapay/server test:integration:payment
```

### Stripe webhook E2E

`ENABLE_WEBHOOK_TESTS=true` turns on the payment-suite case that confirms a
test card, waits for the Stripe webhook to book credits, then exercises a
protected handler.

**Preferred (ngrok, no Stripe CLI):** run the platform with `ngrok.yml` so
Stripe delivers to `https://api.<subdomain>.ngrok.app/v1/webhooks/stripe`.
Do not also run `stripe listen` — that duplicates every event.

```bash
# from ../platform, with ngrok.yml configured
pnpm run dev

# from sdks/typescript/server
ENABLE_WEBHOOK_TESTS=true pnpm test:integration:payment
```

**Fallback (no tunnels):** forward with the Stripe CLI to payment-service.

```bash
stripe listen --forward-to localhost:3003/v1/webhooks/stripe
ENABLE_WEBHOOK_TESTS=true pnpm test:integration:payment
```

## CI expectations

Before opening a PR, make sure:

- all relevant package tests pass
- generated surfaces are up to date (`pnpm gen:check`) if you changed contract
  inputs, fixtures, or dto-gen
- fixtures pass on both sides (`pnpm test:contract` + the `fixture-runner`) when
  you change behavior
- Rust gates pass (`cargo test --workspace`, `cargo clippy`, `check-no-unwrap.sh`)
  when you touch `core/` or `sdks/`
- new behavior has coverage in unit, integration, or fixture tests
- docs links are valid (`pnpm docs:validate-links`)

## Where to read next

- [`architecture.md`](./architecture.md) for the two-layer model and surface map
- `CONTRIBUTING.md` for contributor workflow
- [`sdk-codegen.md`](./sdk-codegen.md) for OpenAPI → five-surface regeneration
- [`error-handling.md`](./error-handling.md) for the cross-language error model
- `examples/` for runnable integration references
- `sdks/typescript/*/README.md` for package-specific usage constraints
