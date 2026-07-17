# Rust Core SDK migration map

Living **state / progress / handoff** layer for the Rust core SDK redesign. Companion to the architecture/spec doc:

- **Spec / architecture:** [`rust-core-sdk-redesign-v2.md`](./rust-core-sdk-redesign-v2.md) — what to build and why
- **This map:** where each of the 55 steps stands, and what each phase handed off

Session workflow (redesign §14): pick the next incomplete step in redesign §9 → implement only that step → prove its "done when" → update **this map** (status + handoff bullets). At each phase close, finalize that phase's handoff entry before opening the next phase's first PR.

**Current progress (2026-07-17):** Steps 1–29 **Done** (Phases 0–3 closed; Phase 4 in progress). **Next:** step 30 (helpers: usage / limits / plans).

## Status legend

| Status | Meaning |
| --- | --- |
| `Not started` | Not begun |
| `In progress` | Actively being implemented |
| `Done` | "Done when" verified; see matrix notes |
| `Blocked` | Cannot proceed; link to [Open handoff items](#open-handoff-items-index) |

## Phase / step status matrix

| Step | Title | Phase | Status | PR / commit | "Done when" verified | Handoff |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | OpenAPI snapshot + regen script | Phase 0 | Done | — | `pnpm snapshot:openapi:check` zero diff + idempotent; `pnpm test:contract` green; CI offline steps added | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 2 | SDK contract manifest | Phase 0 | Done | `3edcb72b` | `pnpm manifest:check` green (schema, coverage, OpenAPI cross-check); `pnpm test:contract` green | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 3 | Fixture harness | Phase 0 | Done | — | Sample fixtures pass end to end via `pnpm test:contract` (`webhook-verification/accept`, `timestamp-too-old`, `client/create-payment-intent-success`) | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 4 | Webhook-signature fixtures | Phase 0 | Done | — | Full §6.1 axis set (17 webhook fixtures) passes via harness against both node and edge `verifyWebhook`; `pnpm test:contract` green | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 5 | Retry-schedule fixtures | Phase 0 | Done | — | Full §6.2 set (13 retry fixtures) passes via harness against real `withRetry`; `pnpm test:contract` green | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 6 | Paywall fixtures | Phase 0 | Done | — | Full §6.3 set under `contract/fixtures/paywall/` (classification / gate / messages / client-payload) passes via harness against real paywall helpers; `pnpm test:contract` green | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 7 | Client request/response fixtures | Phase 0 | Done | — | All 36 `SolvaPayClient` methods covered under `contract/fixtures/client/<method-kebab>/` (≥1 success + ≥1 error each); `pnpm test:contract` green | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 8 | Scaffold cargo workspace | Phase 1 | Done | — | CI rust job: fmt, clippy deny, no-unwrap gate, native + wasm32 build, no-tokio tree, `cargo test`, empty fixture suite (`parsed=N executed=0 skipped-unbound=N`) | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 9 | Business details | Phase 1 | Done | — | `contract/fixtures/business-details/` (99 cases) green in TS harness + Rust runner (`executed=99 passed=99 failed=0`); issue-shape gotcha locked; `cargo test --workspace` + step-8 gates green | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 10 | Credit display + seller identity | Phase 1 | Done | — | `contract/fixtures/credit-display/` (18) + `seller-identity/` (17) green in TS harness + Rust runner (`executed=134 passed=134 failed=0` with business-details); RED observed on stubs; `cargo test --workspace` + step-8 gates green | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 11 | Retry policy engine | Phase 1 | Done | — | Core unit tests + 13 `retry-schedule` fixtures green via host adapter; full bound corpus `executed=147 passed=147 failed=0`; step-8 gates green | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 12 | Webhook verification | Phase 1 | Done | — | `solvapay-core::webhook` + Rust runner binding; Step 4 `webhook-verification/` fixtures green (`passed` via `fixture-runner`); frozen messages from generated `error_templates` | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 13 | Paywall state | Phase 1 | Done | — | `solvapay-core::paywall_state` + runner bindings; classification / gate-message / nudge fixtures green byte-for-byte | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 14 | Paywall gate | Phase 1 | Done | — | `solvapay-core::paywall_gate` + runner binding; gate fixtures green incl. skip-absent field presence | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 15 | Rust DTO generator | Phase 2 | Done | — | `dto-gen` lowers OpenAPI snapshot → `solvapay-dto` (`schemas`/`routes`); CI regen-drift + fmt/clippy/no-unwrap; `cargo build -p solvapay-dto` | [Phase 2](#phase-2--generated-dtos-and-error-model) |
| 16 | SDK-only overlays | Phase 2 | Done | — | `overlays:` catalog in manifest; `dto-gen --manifest` emits `overlays.rs` + `overlays.generated.d.ts`; `pnpm manifest:check`, `cargo build -p solvapay-dto`, `tsc --noEmit`, regen idempotence + CI drift gates green (§15 note 11 / `serde_norway 0.9.42`) | [Phase 2](#phase-2--generated-dtos-and-error-model) |
| 17 | Error model | Phase 2 | Done | — | `SdkError` in `solvapay-core`; manifest-frozen templates → `error_templates.rs`; `error-model/` fixtures + one §6.4 conversion helper; RED→GREEN on `cargo test -p solvapay-core error`; `pnpm test:contract` + step-8 gates | [Phase 2](#phase-2--generated-dtos-and-error-model) |
| 18 | TS declarations + parity check | Phase 2 | Done | — | Manifest `params` catalog; `client.generated.d.ts` + API-diff mutual assignability; `pnpm parity:check`; generated `signature-parity.generated.test.ts`; CI drift + `@generated` header gates; RED→GREEN on dto-gen emit + `test:types` | [Phase 2](#phase-2--generated-dtos-and-error-model) |
| 19 | Native transport | Phase 3 | Done | — | `ReqwestTransport` + wiremock corpus round-trips; §15 note 13 | [Phase 3](#phase-3--http-client-core) |
| 20 | WASM Fetch transport | Phase 3 | Done | — | `FetchTransport` + `test-wasm-transport.sh` corpus round-trips; §15 note 14 | [Phase 3](#phase-3--http-client-core) |
| 21 | Client shell | Phase 3 | Done | — | Shell unit + shell-level fixtures on reqwest + Fetch; §15 note 15 | [Phase 3](#phase-3--http-client-core) |
| 22 | Client methods, group A | Phase 3 | Done | — | 29 Group A fixtures (28 wire + `get-customer-missing-params`) green on reqwest + Fetch; `SolvaPayClient` 10 methods in `client.rs` | [Phase 3](#phase-3--http-client-core) |
| 23 | Client methods, group B | Phase 3 | Done | — | 19 Group B fixtures green on reqwest + Fetch; all 7 `ProcessPaymentResult` branches; `attachBusinessDetails` raw JSON passthrough | [Phase 3](#phase-3--http-client-core) |
| 24 | Client methods, group C | Phase 3 | Done | — | 56 Group C fixtures green on reqwest + Fetch; `OPERATION_NAMES` coverage gate (36/36); `execute_raw` for delete 404 + cancel/reactivate | [Phase 3](#phase-3--http-client-core) |
| 25 | Shadow-mode harness | Phase 3 | Done | — | Offline `pnpm shadow:selftest` green (IDENTICAL + intentional divergence wire dump); `pnpm manifest:check`; shadow-invoker 36-fn coverage + wiremock; live `pnpm shadow:run` via `SOLVAPAY_SHADOW_*` (manual / workflow_dispatch) | [Phase 3](#phase-3--http-client-core) |
| 26 | Helpers: customer / auth / activation | Phase 4 | Done | — | `helper-auth` (24) + `helper-customer-sync` (20) + `helper-activation` (4) green in TS harness + Rust `fixture-runner` (`executed=256 passed=256 failed=0`); RED stub auth → `failed=24`; `auth-core` / `ensure-customer` vitest green; step-8 gates + §15 note 18 | [Phase 4](#phase-4--route-helper-cores) |
| 27 | Helpers: payment / payment-method / checkout | Phase 4 | Done | — | `helper-payment` (22) + `helper-checkout` (8) green in TS harness + Rust `fixture-runner` (`executed=286 passed=286 failed=0`; was 256); RED stubs → `failed=17`; payment/checkout characterization + core unit tests green; payment-method nil decision core (orchestration-only); step-8 gates + §15 note 19 | [Phase 4](#phase-4--route-helper-cores) |
| 28 | Helpers: auto-recharge / balance-poll | Phase 4 | Done | — | `helper-balance-poll` (14) green in TS harness + Rust `fixture-runner` (`executed=300 passed=300 failed=0`; was 286); RED stubs → unit `failed=3` + fixture `failed=12`; auto-recharge characterization + core unit tests green; auto-recharge nil decision core; step-8 gates + §15 note 20 | [Phase 4](#phase-4--route-helper-cores) |
| 29 | Helpers: purchase / renewal | Phase 4 | Done | — | `helper-purchase` (10) + `helper-renewal` (24) green in TS harness + Rust `fixture-runner` (`executed=334 passed=334 failed=0`; was 300); RED stubs → unit `failed=23`; purchase/renewal characterization + core unit tests green; step-8 gates + §15 note 21 | [Phase 4](#phase-4--route-helper-cores) |
| 30 | Helpers: usage / limits / plans | Phase 4 | Not started | — | — | [Phase 4](#phase-4--route-helper-cores) |
| 31 | Helpers: merchant / product / error | Phase 4 | Not started | — | — | [Phase 4](#phase-4--route-helper-cores) |
| 32 | Paywall decision core | Phase 5 | Not started | — | — | [Phase 5](#phase-5--paywall-decision-engine-and-mcp-contracts) |
| 33 | Client payload shapes | Phase 5 | Not started | — | — | [Phase 5](#phase-5--paywall-decision-engine-and-mcp-contracts) |
| 34 | MCP payload builders | Phase 5 | Not started | — | — | [Phase 5](#phase-5--paywall-decision-engine-and-mcp-contracts) |
| 35 | MCP names + descriptors | Phase 5 | Not started | — | — | [Phase 5](#phase-5--paywall-decision-engine-and-mcp-contracts) |
| 36 | Scaffold napi-rs | Phase 6 | Not started | — | — | [Phase 6](#phase-6--node-binding-cutover-then-edgebrowser-wasm) |
| 37 | Wire conditional exports | Phase 6 | Not started | — | — | [Phase 6](#phase-6--node-binding-cutover-then-edgebrowser-wasm) |
| 38 | Edge/browser WASM cutover | Phase 6 | Not started | — | — | [Phase 6](#phase-6--node-binding-cutover-then-edgebrowser-wasm) |
| 39 | Clean-install smoke tests | Phase 6 | Not started | — | — | [Phase 6](#phase-6--node-binding-cutover-then-edgebrowser-wasm) |
| 40 | Scaffold PyO3/maturin | Phase 7 | Not started | — | — | [Phase 7](#phase-7--python) |
| 41 | Generate the Python facade | Phase 7 | Not started | — | — | [Phase 7](#phase-7--python) |
| 42 | Live contract tests + publish (Python) | Phase 7 | Not started | — | — | [Phase 7](#phase-7--python) |
| 43 | Scaffold Magnus/rb-sys | Phase 8 | Not started | — | — | [Phase 8](#phase-8--ruby) |
| 44 | Generate the Ruby facade | Phase 8 | Not started | — | — | [Phase 8](#phase-8--ruby) |
| 45 | Live contract tests + publish (Ruby) | Phase 8 | Not started | — | — | [Phase 8](#phase-8--ruby) |
| 46 | Scaffold the `solvapay` facade crate | Phase 9 | Not started | — | — | [Phase 9](#phase-9--rust-public-crate) |
| 47 | Generate Rust facade signatures + signature-parity suite | Phase 9 | Not started | — | — | [Phase 9](#phase-9--rust-public-crate) |
| 48 | crates.io publish + docs.rs + live contract tests | Phase 9 | Not started | — | — | [Phase 9](#phase-9--rust-public-crate) |
| 49 | Scaffold wazero binding | Phase 10 | Not started | — | — | [Phase 10](#phase-10--go-wazero--embedded-wasm) |
| 50 | Generate the Go facade + signature-parity suite | Phase 10 | Not started | — | — | [Phase 10](#phase-10--go-wazero--embedded-wasm) |
| 51 | Live contract tests + go module release wiring | Phase 10 | Not started | — | — | [Phase 10](#phase-10--go-wazero--embedded-wasm) |
| 52 | Delete superseded TS in `@solvapay/core` | Post-cutover | Not started | — | — | [Post-cutover](#post-cutover--deletion-and-c-abi) |
| 53 | Delete superseded TS in `@solvapay/server` | Post-cutover | Not started | — | — | [Post-cutover](#post-cutover--deletion-and-c-abi) |
| 54 | Publish the optional C ABI | Post-cutover | Not started | — | — | [Post-cutover](#post-cutover--deletion-and-c-abi) |
| 55 | Promote all compatibility gates | Post-cutover | Not started | — | — | [Post-cutover](#post-cutover--deletion-and-c-abi) |

## Per-phase handoff log

### Phase 0 — Contract freeze and golden fixtures — Done

<!-- running per-step bullets accumulate here as each step lands -->
- Step 1 (OpenAPI snapshot + regen script): Checked in path-filtered source + derived snapshot, shared `scripts/lib/openapi-pipeline.ts`, `scripts/snapshot-openapi.ts` (`--from-url` / `--from-file` / `--check`), `pnpm test:contract`, offline CI gates; `generate-types.ts` imports the shared pipeline — "done when" verified: `pnpm snapshot:openapi:check` zero diff + idempotent; contract tests green
- Step 2 (SDK contract manifest): Checked in `contract/manifest/sdk-contract.yaml` + Zod schema/CLI (`scripts/lib/manifest-schema.ts`, `scripts/manifest.ts`), `pnpm manifest:validate` / `manifest:check` with offline OpenAPI route/DTO cross-check — "done when" verified at `3edcb72b`
- Step 3 (Fixture harness): Zod §5.3 schema + TS runner (`scripts/lib/fixture-schema.ts`, `scripts/lib/fixture-harness.ts`), discovery suite `scripts/contract-fixtures.test.ts`, samples under `contract/fixtures/` — "done when" verified: three sample fixtures pass end to end via `pnpm test:contract`
- Step 4 (Webhook-signature fixtures): Full §6.1 axis under `contract/fixtures/webhook-verification/` (17 cases); `createDefaultRegistry` registers both `node` and `edge` `verifyWebhook` bindings — "done when" verified: every fixture replays green against both implementations via `pnpm test:contract`
- Step 5 (Retry-schedule fixtures): Full §6.2 axis under `contract/fixtures/retry-schedule/` (13 cases); harness `withRetry` binding + `installDelayRecorder` — "done when" verified: every fixture replays green against real `withRetry` via `pnpm test:contract`
- Step 6 (Paywall fixtures): Full §6.3 axis under `contract/fixtures/paywall/` (classification / gate / messages / client-payload); harness bindings for the five pure helpers — "done when" verified: every fixture replays green via `pnpm test:contract`
- Step 7 (Client request/response fixtures): Full client corpus under `contract/fixtures/client/<method-kebab>/` for all 36 `SolvaPayClient` methods; harness extras for query capture, verbatim bodies, delete null coercion — "done when" verified: ≥1 success + ≥1 error per operation; `pnpm test:contract` green

#### Step 2 decisions for future handoffs

- **Manifest location:** `contract/manifest/sdk-contract.yaml` is the canonical public-API catalog (operations, top-level, core helpers, facade, error templates, defaults, name overrides).
- **Offline CI:** `pnpm manifest:check` never hits a live server; routes/DTO refs cross-check against `contract/openapi/sdk-v1.snapshot.json`.
- **Name overrides:** manual per-language names only via `nameOverrides`; emitters must not hard-code renames.

#### Step 3 decisions for future handoffs

- **Fixture directory:** `contract/fixtures/<suite>/<case>.json` — discovered recursively by `scripts/contract-fixtures.test.ts` (picked up by existing `pnpm test:contract`; no CI workflow change).
- **Registry design:** `FixtureRegistry` maps `input.fn` → one or more `{ id, invoke }` bindings so step 4 can register both node and edge `verifyWebhook` under the same name; step 3 registers `verifyWebhook` (`node`) and `createPaymentIntent` (`client`) only.
- **Clock / RNG / fetch patching:** harness patches `Date.now`, `Math.random` (mulberry32 from `rngSeed`), and `globalThis.fetch` for the binding call and restores in `finally` — SDK code stays unchanged in Phase 0.
- **Error codes:** TS harness asserts `expect.error.name` + byte-exact `message` (+ `status` when given). §5.3 `kind` / `code` are Rust-era taxonomy carried in fixtures for later runners; not invented or asserted on the TS side (resolved via manifest message templates in Rust).
- **Dev dependency:** root `package.json` adds `"@solvapay/server": "workspace:*"` so the harness imports the built package (same ordering as CI: `build:packages` → `test:contract`).

#### Step 4 decisions for future handoffs

- **Axis file naming:** `webhook-verification/<axis>.json` — one file per §6.1 axis (accept variants, five error codes, ±299/±301 boundaries, exact 300 s edge, malformed/invalid variants). Shared constants: clock `2026-07-01T00:00:00Z`, secret `whsec_test_fixture_secret`, same event body as Step 3 samples.
- **Dual-binding replay:** `createDefaultRegistry` registers `verifyWebhook` twice (`id: 'node'` from `@solvapay/server`, `id: 'edge'` from `@solvapay/server/edge`). Harness awaits promises and patches `Date.now` globally — no special async path needed. Proves the Node/Edge duplicates have not drifted.
- **Exact-boundary at 300 s:** reject condition is `age > 300` (not `>=`), so `t = now - 300` is an **accept** fixture (`accept-boundary-300s.json`); `±301` are `timestamp_too_old`.
- **HMAC values:** computed once with `node:crypto` (`sha256(secret, "{t}.{body}")` hex); no generator script checked in — harness replay proves each value.

#### Step 5 decisions for future handoffs

- **Scenario-in-args:** `input.args` carries a declarative retry scenario (`attempts`, optional `options` / `shouldRetry` / `onRetry`); the binding synthesizes closures. No schema change — `args` remains `z.record(string, unknown)`.
- **Observation, not throw:** every retry fixture uses `expect.result` with `{ delays, events, outcome }`; terminal rejection is `{ type: "rejected", name, message }` so Rust/Python runners never need a panic path for these cases.
- **Delay recorder:** patch `globalThis.setTimeout` to record `ms`, push `sleep:<ms>`, and fire the callback synchronously — asserts computed delays, never wall-clock. Restored in binding `finally` and via harness `GlobalSnapshot`.
- **Single binding:** `withRetry` is the same export from `./utils` on both node and edge entry points — register once (`id: 'server'`), unlike step 4's dual `verifyWebhook`.

#### Step 6 decisions for future handoffs

- **Pure helpers only:** fixtures cover `classifyPaywallState`, `buildPaywallGate`, `buildGateMessage`, `buildNudgeMessage`, `paywallErrorToClientPayload` — no wire blocks; `expect.result` only (these never throw).
- **Skip-absent fields:** conditionally-spread fields (`plans` / `balance` / `productDetails` / `confirmationUrl`) are omitted from `expect.result` when absent — `deepStrictEqual` locks “never emit null for absent fields”.
- **Layout:** `paywall/<axis>/<case>.json` with axes `classification`, `gate`, `messages`, `client-payload`.

#### Step 7 decisions for future handoffs

- **Per-method directories:** `client/<method-kebab>/<case>.json` — every manifest operation has ≥1 success and ≥1 error case (enforced by `scripts/contract-fixtures.test.ts`).
- **Shared clock / RNG:** clock `2026-07-01T00:00:00Z` (epoch ms `1782864000000`); `rngSeed: 42` only on auto-generated idempotency-key fixtures (`random9` → `ln13h9a6y`).
- **Harness extras:** `wire.request.query` capture/assertion, verbatim string response bodies, `deleteProduct`/`deletePlan` coerce `undefined → null`.

**Phase-close handoff:**
- **What was done:** Frozen OpenAPI snapshot + SDK contract manifest; built the TS golden-fixture harness; authored full corpora for webhook verification, retry schedule, paywall pure helpers, and all 36 client methods under `contract/fixtures/`.
- **Why:** Phase 1+ Rust (and later language) runners must replay the same JSON against live implementations without inventing behavior.
- **Decisions to document:** §5.3 fixture format; dual `verifyWebhook` bindings; retry observation shape; paywall skip-absent JSON; client per-method coverage gate. Deviations: none material. Deferred: backend-published OpenAPI artifact for CI drift (open-items index).
- **Pointers:** redesign §5.3, §6.1–§6.3; `contract/fixtures/README.md`; `pnpm test:contract`.

#### Step 1 decisions for future handoffs

- **CI input:** backend publishes no OpenAPI artifact today → committed `contract/openapi/sdk-v1.source.json` is the offline CI input; CI never hits a live server.
- **Shared pipeline:** filter/prune/placeholder logic is one module used by both the snapshot script and `generate-types.ts`.
- **Determinism:** snapshot serialization recursively sorts object keys, preserves array order, 2-space indent, trailing newline (no new deps).
- **`/v1/sdk/agents` exclusion** kept for parity with `generate-types.ts`; currently a no-op if the route is absent upstream.
- **Open dependency:** automated drift vs backend CI needs a backend-published OpenAPI artifact (flag for backend team). See open-items index.
- **`contract/` is the Phase 0 contract-freeze root.** Step 2 → `contract/manifest/`; steps 3–7 → `contract/fixtures/`.

### Phase 1 — Pure, dependency-free logic — Done

<!-- running per-step bullets accumulate here as each step lands -->
- Step 8 (Scaffold cargo workspace): `rust/` workspace with `solvapay-core` + `fixture-runner`, pinned `rust-toolchain.toml` (1.96.0 + wasm32), Clippy/workspace deny of unwrap/expect/panic, ripgrep `scripts/check-no-unwrap.sh`, CI `rust` job (native + wasm32, no-tokio, empty fixture suite) — "done when" verified locally; see §15 note 6
- Step 9 (Business details): `solvapay-core::business_details` + `contract/fixtures/business-details/` (99 cases); TS harness `@solvapay/core` bindings; Rust fixture-runner real execution — "done when" verified: `pnpm test:contract` + `cargo run -p fixture-runner -- ../contract/fixtures` → `executed=99 passed=99 failed=0`; redesign §9 gotcha locked (byte-exact `BusinessDetailsValidationIssue` `{ path, message }`)
- Step 10 (Credit display + seller identity): `solvapay-core::{credit_display,seller_identity}` + fixtures `credit-display/` (18) / `seller-identity/` (17); reuses `derive_tax_id_type` + `is_supported_business_country`; RED: stubs returned wrong defaults (`failed=30` expectation mismatches) before GREEN — "done when" verified: TS harness green + `cargo run -p fixture-runner -- ../contract/fixtures` → `executed=134 passed=134 failed=0`
- Step 11 (Retry policy engine): `solvapay-core::retry` (`Backoff`, `RetryPolicy::next_delay`) + host adapter `fixture-runner` `withRetry`; RED: core stub returned `Some(1ms)` (assertion failures) then incomplete host loop (`parsed=13 executed=13 passed=4 failed=9`); GREEN: `retry-schedule` → `parsed=13 executed=13 passed=13 failed=0`, full corpus → `executed=147 passed=147 failed=0`; see §15 note 7
- Step 12 (Webhook verification): `solvapay-core::webhook` (`verify_webhook`, `WebhookError` / `WebhookErrorCode`) + fixture-runner host clock parse; Step 4 corpus green in Rust; messages later sourced from generated `error_templates` (step 17)
- Step 13 (Paywall state): `solvapay-core::paywall_state` classifier + gate/nudge message builders; paywall classification/message fixtures green byte-for-byte
- Step 14 (Paywall gate): `solvapay-core::paywall_gate` (`build_paywall_gate`, `PaywallGate`); gate fixtures green incl. skip-absent emission

**Phase-close handoff:**
- **What was done:** Cargo workspace + all Phase 1 pure logic in `solvapay-core` (business details, credit display, seller identity, retry, webhook, paywall state/gate); fixture-runner bindings replay Phase 0 corpora.
- **Why:** Host-agnostic decision cores must be proven byte-identical to TS before HTTP/DTO layers depend on them.
- **Decisions to document:** Step 8–14 bullets above; core deps frozen to serde/hmac/sha2/subtle (+ serde_json for webhook); timer/callback boundaries stay host-side. Deviations: JSON `balance: null` treated as absent in paywall state (pinned). Deferred: none material.
- **Pointers:** redesign §4.3, §6.1–§6.3; `contract/fixtures/`; §15 notes 6–9.

#### Step 8 decisions for future handoffs

- **Workspace root:** `rust/` at repo root (§4.3 layout); `Cargo.lock` committed; `rust/target/` gitignored.
- **Toolchain pin:** `rust/rust-toolchain.toml` channel `1.96.0`, components `clippy`/`rustfmt`, target `wasm32-unknown-unknown`.
- **Core deps only:** `solvapay-core` may depend on `serde`, `hmac`, `sha2`, `subtle` — nothing else until a later step widens the allow-list.
- **Fixture runner:** reads the same Phase 0 JSON under `contract/fixtures/`; empty binding registry → parse all, execute none, exit 0 with `parsed=N executed=0 skipped-unbound=N`. Bindings register in steps 9+.
- **No-unwrap enforcement:** `[workspace.lints.clippy]` deny + `rust/scripts/check-no-unwrap.sh` (skips `#[cfg(test)]` / `tests.rs`). Test modules may unwrap under `#[allow(...)]`.
- **WASM profile:** `[profile.wasm-release]` (`opt-level = "z"`, LTO, `panic = "abort"`, `codegen-units = 1`) ready for later wasm builds — not used by step 8 CI yet.

#### Step 9 decisions for future handoffs

- **Fixtures authored in this step:** no prior business-details corpus; suite lives at `contract/fixtures/business-details/` and was proven green against `@solvapay/core` before the Rust port.
- **No `regex` crate:** step 8 froze core deps; the 29 per-country tax-ID patterns are hand-rolled matchers (prefix + digit-count + small char-class checks); the accept/reject matrix proves equivalence.
- **Runner execution model:** `BindingRegistry` is `fn-name → Vec<Binding>` with `invoke(&FixtureInput) -> Result<Value, …>`; deep `serde_json::Value` equality against `expect.result` (absent ≠ null); non-zero exit when `failed > 0`; summary `parsed=N executed=N passed=N failed=N skipped-unbound=N`.
- **Issue-shape gotcha (redesign §9):** public contract is `BusinessDetailsValidationIssue = { path, message }` only (Zod’s internal `code` is not exported). Rust must emit the same paths + byte-exact messages so React form errors don’t change — locked by fixtures: `country` / `Country is required`, `country` / `Country is not supported for business purchases`, `customerCountry` / `Billing country is not supported for tax calculation`, `taxId` / `Enter a valid tax ID for {CC}`, `customerName` / Zod `too_big` default `Too big: expected string to have <=100 characters`.
- **Zero-arg options binding:** `getBusinessCountryOptions` locks `BUSINESS_COUNTRY_OPTIONS` localeCompare ordering.

#### Step 10 decisions for future handoffs

- **Fixtures authored in this step:** no prior credit-display / seller-identity corpus; suites proven green against `@solvapay/core` before the Rust port (Step 9 pattern).
- **Null-result (credit convert):** `creditsPerMinorUnit <= 0` → JSON `null` (not omit); fixture `expect.result: null`.
- **Rate `0` → `1`:** parity with JS `displayExchangeRate || 1`; locked by `convert/rate-zero-as-one.json`.
- **Rounding:** `f64::round` then cast to `i64` matches JS `Math.round` on the fixture set (prefer exact-integer cases; half-up `5250` → `53` locked).
- **Null-rows (seller identity):** unlike paywall skip-absent, emit `"taxIdentifier": null` / `"companyNumber": null` explicitly when absent.
- **Reuse:** seller identity calls `derive_tax_id_type` + `is_supported_business_country` (exported helper; no duplicated 29-country list).
- **Const map binding:** `SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE` serializes snake_case keys `eu_vat` / `gb_vat` / `us_ein`.

#### Step 11 decisions for future handoffs

- **Public API:** `Backoff::{Fixed,Linear,Exponential}` (Fixed default), `RetryPolicy { max_retries, initial_delay_ms, backoff }` with contract defaults `(2, 500, Fixed)`, `next_delay(attempt) -> Option<Duration>`; `attempt` zero-based; `max_retries` counts retries after the initial call; exhaustion is `None` (infallible — no `SdkError` yet).
- **Overflow safety:** linear uses `saturating_mul` / `saturating_add`; exponential uses `1u64.checked_shl(attempt)` then `saturating_mul` (or `u64::MAX` when shift overflows).
- **Callback/timer boundary:** core computes delays only; fixture-runner (and future language facades) own the host loop — `shouldRetry` then `onRetry` then recorded/real sleep. Non-`Error` coercion (`String(error)` → `boom` / `[object Object]`) stays host-side.
- **Fixtures unchanged:** all 13 Step 5 `retry-schedule` fixtures reused; no TS `withRetry` runtime change; only corrected stale linear/exponential JSDoc in `packages/server/src/types/options.ts`.
- **Verification:** `cargo test -p solvapay-core retry`; `cargo run -q -p fixture-runner -- ../contract/fixtures/retry-schedule` → 13/13; full fixtures → 147/147; `pnpm manifest:check` (defaults `2`/`500`/`fixed`); step-8 fmt/clippy/no-unwrap/wasm/no-tokio gates.

### Phase 2 — Generated DTOs and error model — Done

<!-- running per-step bullets accumulate here as each step lands -->
- Step 15 (Rust DTO generator): `dto-gen` + `solvapay-dto` from OpenAPI snapshot; CI regen-drift green
- Step 16 (SDK-only overlays): `overlays:` catalog in manifest; `dto-gen --manifest` emits `overlays.rs` + `overlays.generated.d.ts`; regen idempotence + CI drift gates green
- Step 17 (Error model): `solvapay-core::SdkError` (`Api` / `Paywall` / `Webhook` / `Transport`) + `render_template` / `api_from_template`; manifest `errors.webhook.messages` / `paywall.messages` / `transport.messageTemplate`; dto-gen emits `error_templates.rs`; webhook messages switch to generated constants; `From<WebhookError>`; fixture-runner `sdk_error_to_observation` (one §6.4 layer; webhook binding routes through it); `contract/fixtures/error-model/` (11 cases) + TS `constructSdkError` harness binding — RED→GREEN: `cargo test -p solvapay-core error` construction/serde/mapping tests written first then implemented; "done when" verified: error fixtures green in TS + Rust, `pnpm manifest:check`, step-8 gates, dto-gen regen idempotence
- Step 18 (TS declarations + parity check): manifest `params` + dto-gen catalog IR; `--ts-client-out` → `client.generated.d.ts`; API-diff (`test:types` mutual assignability); `pnpm parity:check` (§2.5 allowlist); `--ts-parity-out` → `signature-parity.generated.test.ts` (presence/arity/defaults/errors/sync); CI drift covers all three TS artifacts + `@generated` header gate — RED→GREEN on emit_client_ts / emit_parity_suite_ts / parity.ts tests then emitters

#### Step 17 decisions for future handoffs

- **Single surface:** Core returns / folds into `SdkError`; bindings convert once via `sdk_error_to_observation` (or language-native equivalent) — never a second taxonomy. Transport is `SdkError::Transport` only (step 19+).
- **Templates live in the manifest:** operation `errors.default` / `cases` already frozen; step 17 added webhook/paywall/transport message strings. dto-gen emits `solvapay-dto::error_templates`; `solvapay-core` depends on `solvapay-dto` for webhook message constants.
- **Fixtures:** `constructSdkError` builds variants for golden checks; TS asserts `name`/`message`/`status` only (`kind`/`code` are Rust-era); Transport uses stable codes `retryable` / `non_retryable`.

**Phase-close handoff:**
- **What was done:** `dto-gen` → `solvapay-dto` (wire schemas, routes, overlays, error templates); `SdkError` in core; TS `client.generated.d.ts` + parity/signature-parity gates.
- **Why:** Single generated contract for Rust transport and multi-language facades; no hand-duplicated DTOs or error strings.
- **Decisions to document:** Step 15–18 bullets; `ProcessPaymentResult` untagged enum; overlay catalog in manifest. Deviations: §13 OpenAPI gates (`includeCheckoutSession`, process-payment discriminator) still open — worked around via overlays/untagged. Deferred: backend republish for those gates.
- **Pointers:** redesign §2.5, §2.8; `contract/manifest/sdk-contract.yaml`; §15 notes 10–12.

### Phase 3 — HTTP client core — Done

<!-- running per-step bullets accumulate here as each step lands -->

- **Step 19 (Native transport):** `solvapay-transport::{Transport, HttpRequest, ReqwestTransport}`; dyn-compatible `BoxFuture` (`Send` native / bare wasm32); wiremock recorded-fixture round-trips. §15 note 13.
- **Step 20 (WASM Fetch transport):** `FetchTransport` via `js_sys::global().fetch`; Node `wasm-bindgen-test` + `wasm-fixture-server.mjs` per-fixture mounts; `test-wasm-transport.sh`. §15 note 14.
- **Step 21 (Client shell):** `ClientShell::execute` — auth/`Content-Type`, base-URL normalize, seeded mulberry32/`random9` idempotency, `RetryPolicy` loop + injectable sleeper, template `SdkError::Api` mapping. Shell-level fixtures green on both transports. §15 note 15.
- **Step 22 (Client methods, group A):** `SolvaPayClient` — 10 methods (`createCustomer` … `getPlatformConfig`); explicit wire bodies + response normalization (`getCustomer` three-shape, `createCustomer` `reference`/`customerRef` mapping); native `client_group_a_fixtures.rs` + wasm `wasm_client_group_a_fixtures.rs` over shared `tests/support/mod.rs`. Inventory: 29 fixtures (28 wire + validation-only `get-customer-missing-params`).
- **Step 23 (Client methods, group B):** Five payment/checkout methods; `process_payment_intent` → `solvapay_dto::schemas::ProcessPaymentResult` (7 branches); `attach_business_details` → raw `serde_json::Value` passthrough; `wire_bodies` private body structs + `caller_key_or_auto` + `serialize_whole_f64` for top-up amounts; native `client_group_b_fixtures.rs` + wasm `wasm_client_group_b_fixtures.rs`. Inventory: 19 fixtures (all wire).
- **Step 24 (Client methods, group C):** Remaining 21 methods (usage/limits, products, plans, purchases, payment-method/auto-recharge); 56 fixtures green on reqwest + Fetch; coverage gate `GROUP_A ∪ GROUP_B ∪ GROUP_C == error_templates::OPERATION_NAMES` (36); native `client_group_c_fixtures.rs` + wasm `wasm_client_group_c_fixtures.rs` + ignored `client_group_c_smoke.rs`.
- **Step 25 (Shadow-mode harness):** TS orchestrator + Rust `shadow-invoker` CLI run side-by-side; manifest `shadow:` volatile rules; offline stub self-test + live `pnpm shadow:run` — "done when" verified: `pnpm shadow:selftest` all green (suite IDENTICAL, intentional listPlans divergence dumps both wire exchanges).

#### Step 21 decisions for future handoffs

- **Shell API:** `ClientShell` over `SharedTransport` (`Arc<dyn Transport + Send + Sync>` native / `Arc<dyn Transport>` wasm32); `ShellRequest { method, path, query, body, idempotency, error_template }`; `Idempotency::{None, CallerKey, Auto { format, vars }}`. Typed methods (steps 22–24) call `execute` with the right template from `error_templates::operations::*`.
- **Default no-retry:** shell `RetryPolicy { max_retries: 0, … }` — TS `client.ts` does not retry; fixtures record one wire exchange. Wiring is fully tested (`max_retries: 2` → delays `[500, 500]`); facade `withRetry` stays host-side. Enabling retries later is a policy flip, not a loop rewrite.
- **Seeded RNG / clock hooks:** `with_clock` / `with_rng` / `with_sleeper` injectables; `mulberry32(42)` → `random9` `ln13h9a6y` (TS harness lock). Auto keys: `payment-{planRef}-{epochMs}-{random9}`, `topup-{epochMs}-{random9}`.
- **Diagrams:** no Mermaid changes (§4.1 already shows the shell).

#### Step 22 decisions for future handoffs

- **Typed client location:** `solvapay-transport::SolvaPayClient` wraps `ClientShell`; methods call `execute_typed` / `execute_json` with manifest `error_templates::operations::*`.
- **Path encoding parity:** `encode_path_segment` (JS `encodeURIComponent`) for `updateCustomer` / `assignCredits`; direct interpolation for `getCustomer` ref lookup and `getCustomerBalance` (matches TS).
- **Bodies vs param structs:** serialize explicit private body structs — e.g. `assignCredits` strips `customerRef`/`idempotencyKey` from JSON body; caller key only when non-empty.
- **Fixture harness:** `tests/support/mod.rs` — `GROUP_A_FNS`, `dispatch_group_a`, `assert_expect` (numeric JSON equality); wiremock (native) / `wasm-fixture-server.mjs` per-case mounts (wasm).
- **Validation-only fixture:** `get-customer-missing-params` has no `wire`; must fail with pre-transport `SdkError::Api` before transport.

#### Step 23 decisions for future handoffs

- **`ProcessPaymentResult` path:** use `solvapay_dto::schemas::ProcessPaymentResult` (not crate-root re-export); untagged ordering already correct — `succeeded-bare` deserializes as `SucceededRecurring` arm but re-serializes byte-identically under fixture comparison.
- **`attachBusinessDetails`:** return `serde_json::Value` via `execute_json` — OpenAPI 200 has no response schema; partial `taxBreakdown` would fail strict `TaxBreakdown` decode. Matches TS `res.json()` passthrough. Body omits `customerCountry` / `customerName` / `paymentIntentId`.
- **Explicit wire bodies:** do not serialize param structs directly — e.g. top-up adds constant `purpose: "credit_topup"`; payment/process bodies omit idempotency/path-only fields. `wire_bodies` module holds `#[derive(Serialize)]` structs.
- **Idempotency:** `create_payment_intent` / `create_topup_payment_intent` use `caller_key_or_auto` (`payment-{planRef}-{epochMs}-{random9}` / `topup-{epochMs}-{random9}`); others `Idempotency::None`.
- **Whole-number f64 on wire:** `serialize_whole_f64` emits JSON integers for whole `f64` values (e.g. top-up `amount: 2000` not `2000.0`) — required for wiremock `body_json` parity with Step 7 fixtures.
- **Inventory:** 19 fixtures — `createPaymentIntent` (4), `createTopupPaymentIntent` (3), `processPaymentIntent` (8 = 7 branches + error), `attachBusinessDetails` (2), `activatePlan` (2).

#### Step 24 decisions for future handoffs

- **`execute_raw`:** `ClientShell::execute_raw` shares auth/idempotency/retry with `execute` but returns `HttpResponse` without status→Api mapping or JSON parse. `execute` is implemented as `execute_raw` + map. Used by `delete_product` / `delete_plan` (404 = success → `()` / fixture `null`) and `cancel_purchase` / `reactivate_purchase` (status-specific CASES + invalid-JSON `{bodyPrefix200}` with `status: None`).
- **Merge-precedence gotchas (TS parity):** `get_product` = `{ ...data, ...result }` (top wins, keep `data`); `list_products` = `{ ...product, ...data }` (data wins, keep `data`); `list_plans` = `{ ...data, ...plan }` then `price = plan.price ?? data.price` and **delete** `data`. Only `get_product` path-encodes; other product/plan/purchase refs interpolate raw.
- **Coverage gate:** `dto-gen` emits `error_templates::OPERATION_NAMES` (all 36 manifest op ids); `client_group_c_fixtures::all_thirty_six_operations_are_dispatchable` asserts set equality with `GROUP_A_FNS ∪ GROUP_B_FNS ∪ GROUP_C_FNS` and that every `contract/fixtures/client/` fixture fn is dispatchable. Covered by regen-idempotence + drift CI.
- **Fixture inventory (56, all wire):** usage/limits 6; products 19; plans 11; purchases 12; payment-method/auto-recharge 8. Return `serde_json::Value` for merge/passthrough shapes; typed `CreateProductResult` / `CloneProductResult` / `()` for deletes.
- **Bodies:** `serialize_body_ts_numbers` coerces whole `f64` → JSON ints for wiremock; `SaveAutoRechargeBody` + `serialize_whole_f64`; cancel body omitted unless non-empty `reason`.

#### Step 25 decisions for future handoffs

- **Harness location:** TS orchestrator under `scripts/shadow/`; scenarios in `contract/shadow/scenarios.ts`; Rust side is CLI `rust/tools/shadow-invoker` (not a Node binding — napi is step 36). §11.4 diagram updated accordingly.
- **Manifest `shadow:`:** Top-level `shadow.globalVolatileKeys` / `volatileKeySuffixes` / `refPrefixes` plus per-op `shadow.volatile` JSON Pointers; Zod-validated by `pnpm manifest:check`. Normalizer **deletes** volatile keys (so typed Rust omit ↔ TS passthrough stay comparable) and replaces ref tokens inside URLs with `<volatile>`.
- **Env vars:** `SOLVAPAY_SHADOW_BASE_URL` + `SOLVAPAY_SHADOW_API_KEY` for live; optional `SOLVAPAY_SHADOW_ENABLE_STRIPE=true` / `SHADOW_INVOKER_BIN`. Scripts: `pnpm shadow:run`, `pnpm shadow:selftest`.
- **Stripe / purchase skips:** Scenarios with `requires: stripe` or `requires: activePurchase` are SKIPPED unless explicitly enabled — keeps “identical across the suite” honest.
- **CI:** Offline self-test in the Rust CI job; live shadow is manual-dispatch (`.github/workflows/shadow.yml`) until a hosted contract env exists (open handoff).
- **Divergence reports:** `contract/shadow/output/shadow-report.json` includes both normalized results and full wire exchanges.

**Phase-close handoff:**
- **What was done:** Native + WASM transports; client shell; all 36 typed `SolvaPayClient` methods (Groups A–C); shadow-mode harness proving TS↔Rust identity on normalized live/stub responses.
- **Why:** Phase 3 closes the HTTP client core before Phase 4 helper cores and Phase 6 napi cutover; shadow mode is the live-backend identity gate.
- **Decisions to document:** Steps 19–25 decision bullets; CLI invoker instead of binding for Phase 3; new §13 gate for hosted contract-test env. Deviations: none vs redesign intent. Deferred: live CI shadow until hosted env.
- **Pointers:** redesign §4.1, §10.3–10.4, §11.4, §15 notes 13–17; `scripts/shadow/`, `rust/tools/shadow-invoker/`.

### Phase 4 — Route helper cores — In progress

- **Step 26 (Helpers: customer / auth / activation):** `solvapay-core::{auth_resolution, customer_sync, activation, helper_error, hmac_util}`; TS pure extracts in `@solvapay/core` (`customer-sync`, `activation`) rewired into `paywall.ensureCustomer` / helpers; golden fixtures under `contract/fixtures/helper-*`; fixture-runner bindings. Auth TS runtime stays on `getAuthenticatedUserCore` (fixtures synthesize `Request` + env patch). RED: wrong-default auth stub → `failed=24`; GREEN: full corpus `executed=256 passed=256 failed=0`. §15 note 18.
- **Step 27 (Helpers: payment / payment-method / checkout):** `solvapay-core::{payment, checkout}`; TS pure extracts in `@solvapay/core` (`payment`, `checkout`) rewired into server shims; golden fixtures `helper-payment` (22) + `helper-checkout` (8); fixture-runner bindings. Characterization suites added for previously untested `checkout.ts` / `payment-method.ts`. RED: wrong-default stubs → unit `failed=11` + fixture `failed=17`; GREEN: `executed=286 passed=286 failed=0`. §15 note 19.
- **Step 28 (Helpers: auto-recharge / balance-poll):** `solvapay-core::balance_poll` (tables + `BalancePollPolicy` + `evaluate_balance_observation`); no TS extract — fixtures bind `@solvapay/server` `pollBalanceUntilIncreased` directly (withRetry precedent); golden fixtures `helper-balance-poll` (14); fixture-runner host adapter. Auto-recharge nil decision core; characterization suite extended. RED: wrong empty tables + evaluate `None` → unit `failed=3` + fixture `failed=12`; GREEN: `executed=300 passed=300 failed=0`. §15 note 20.
- **Step 29 (Helpers: purchase / renewal):** `solvapay-core::{purchase, renewal}`; TS pure extracts in `@solvapay/core` (`purchase`, `renewal`) rewired into server shims; golden fixtures `helper-purchase` (10) + `helper-renewal` (24); fixture-runner bindings. Characterization suite added for previously untested `renewal.ts`. RED: wrong-default stubs → unit `failed=23`; GREEN: `executed=334 passed=334 failed=0`. §15 note 21.

#### Step 26 decisions for future handoffs

- **Conformance strategy (deviation):** Phase 1 / step 25 precedent — golden fixtures proven TS-green first, then Rust `fixture-runner`. Literal "existing helper tests pass against the binding" defers to step 37 (napi cutover); `auth-core.unit.test.ts` (15) remains the closest runtime regression gate today.
- **`ensureCustomer` scope:** decision pieces only (`classifyCustomerRef`, options coercion, create-params, backend-ref extract, lookup/create/email-conflict classification). Caches, shared deduplicator, and HTTP stay TS (§8).
- **jose clock gotcha:** `jwtVerify` uses wall clock (`new Date()`); harness `Date.now` patching does not intercept it — `exp`/`nbf` fixtures use far-past/far-future dates; exact boundary semantics locked by Rust unit tests with explicit `now_unix_secs`.
- **Hand-rolled base64url + HS256:** no new core crate (step 8 freeze); JWT verify reuses shared `hmac_util` with webhook. `alg` must be HS256; `exp`/`nbf` with zero tolerance (jose default `clockTolerance`).
- **Serde shapes:** auth `email`/`name` serialize as explicit `null` when absent; helper `details` is skip-absent (activation 400 has no `details` field).

#### Step 27 decisions for future handoffs

- **Fixture counts:** `helper-payment` 22 + `helper-checkout` 8 (= +30 bound cases). Full corpus `executed` 256→286; `failed=0`.
- **Nil payment-method core:** `payment-method.ts` is pure orchestration (sync → capability guard → client call) — no extractable decision core; covered by new `payment-method.test.ts` characterization suite only.
- **Poll decision stays host:** `projectTopupProcessOutcome` covers status narrowing only; `preCredits === null` soft-succeed and `pollBalanceUntilIncreased` / `TOPUP_BALANCE_POLL_DELAYS_MS` remain in the TS shim (step 28 owns delay tables).
- **Characterization suites:** redesign assumed existing `*.test.ts` as conformance gate — only `payment.test.ts` existed; added `checkout.test.ts` + `payment-method.test.ts` before shim refactor (pass unmodified after rewire).
- **Skip-absent choices:** `accountId` on PI projection and timeout `message` on topup outcome omit when absent (JSON drop parity). `resolveReturnUrl` returns `undefined`/`None`; fixture harness coerces to `null` for JSON expect parity.
- **Shared `paymentIntentId` validator:** `validateAttachBusinessDetailsParams` is reused by `processTopupPaymentIntentCore` (identical frozen message) — naming follows attach; no separate topup-id validator.

#### Step 28 decisions for future handoffs

- **No TS extraction:** `pollBalanceUntilIncreased` and the delay tables are already standalone `@solvapay/server` exports — fixtures bind them directly (step-5/11 `withRetry` precedent). No `@solvapay/core` re-export shuffle; `@solvapay/react` imports untouched.
- **Nil auto-recharge core:** `get/save/disableAutoRechargeCore` are sync → capability guard → client-call orchestration (same shape as payment-method). Covered by extended `auto-recharge.test.ts` characterization only; boy-scout `return await` so client rejections hit `handleRouteError`.
- **Scenario-in-args fixture shape:** `baseline` + `observations[]` (`{ credits }` / `{ throw }`) + optional `delays` (`"topup"` / `"reconcile"` / `[ms...]` / omitted → reconcile). Observation records consumed delays + terminal `{ creditsAdded }` or `null` — delays recorded, never slept.
- **Poll semantics frozen:** strict `post.credits > baseline` (equal/decrease → continue); thrown `getBalance` errors swallowed; table exhaustion → `null`; one sleep **before every** poll including the first; default table is `BALANCE_RECONCILE_DELAYS_MS`.
- **Integer-emission gotcha:** `creditsAdded` whole numbers must serialize as JSON integers (`9600` not `9600.0`) for `serde_json::Value` deep-equality with TS fixtures (step-23 `serialize_whole_f64` precedent).
- **Fixture count:** `helper-balance-poll` 14 (= +14 bound cases). Full corpus `executed` 286→300; `failed=0`.

#### Step 29 decisions for future handoffs

- **Fixture counts:** `helper-purchase` 10 + `helper-renewal` 24 (= +34 bound cases). Full corpus `executed` 300→334; `failed=0`.
- **Shared `is_truthy`:** JS truthiness for JSON values (null/false/0/""/NaN falsy; objects/arrays truthy) lives in `purchase.rs` and is reused by renewal normalize for `reference` / `cancelledAt`.
- **Normalize returns `Result<Value, HelperErrorResult>`:** success is the unwrapped purchase object; errors include `details` on classify paths (unlike checkout/payment validators which omit `details`).
- **Dynamic cancel message:** missing `status` formats as `"undefined"` (JS template parity); `null` as `"null"`.
- **Characterization suite:** redesign assumed existing `*.test.ts` — only `purchase.test.ts` existed; added `renewal.test.ts` (24 cases, fake timers for 500ms settle) before shim refactor (pass unmodified after rewire).
- **Host stays:** auth, `x-solvapay-customer-ref` header, `ensureCustomer`/`getCustomer`, 500ms settle delay, `instanceof SolvaPayError`, `handleRouteError`, method-unavailable guards.

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

### Phase 5 — Paywall decision engine and MCP contracts — Not started

<!-- running per-step bullets accumulate here as each step lands -->

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

### Phase 6 — Node binding cutover, then edge/browser WASM — Not started

<!-- running per-step bullets accumulate here as each step lands -->

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

### Phase 7 — Python — Not started

<!-- running per-step bullets accumulate here as each step lands -->

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

### Phase 8 — Ruby — Not started

<!-- running per-step bullets accumulate here as each step lands -->

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

### Phase 9 — Rust public crate — Not started

<!-- running per-step bullets accumulate here as each step lands -->

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

### Phase 10 — Go (wazero + embedded WASM) — Not started

<!-- running per-step bullets accumulate here as each step lands -->

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

### Post-cutover — deletion and C ABI — Not started

<!-- running per-step bullets accumulate here as each step lands -->

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

## Open handoff items index

Mirrors redesign §13 "Unresolved implementation gates", plus blockers discovered mid-migration.

| Gate | Resolve by | Status | Owner |
| --- | --- | --- | --- |
| Exact WASM size / cold-start numeric budgets | Step 38 baseline | Open | SDK |
| Final npm optional-dependency layout + package names for prebuilds | Steps 36–37 | Open | SDK |
| Python package name on PyPI (`solvapay` vs scoped) and minimum CPython (abi3 floor) | Steps 40–42 | Open | SDK |
| Ruby gem name + versioning scheme; source-gem toolchain floor | Steps 43–45 | Open | SDK |
| Go module path naming (`github.com/solvapay/solvapay-go` vs vanity import) | Steps 49–51 | Open | SDK |
| Whether the Go WASM artifact is committed in-repo or attached to release tags | Before step 49 cutover | Open | SDK |
| WASM instance-pool sizing strategy for Go | Step 49 | Open | SDK |
| crates.io name reservation for `solvapay` (and whether internal crates are published) | Before step 46 | Open | SDK |
| Whether the shared tokio runtime in napi-rs is per-addon or per-process | Step 36 | Open | SDK |
| Process-payment OpenAPI discriminator fix — backend republish vs manifest overlay | Before step 15 cutover | Open | Backend + SDK |
| `includeCheckoutSession` OpenAPI republish | Before step 15 cutover | Open | Backend + SDK |
| Free-threaded CPython: `gil_used = false` from day one, or after an audit? | Step 40 | Open | SDK |
| Fuzz corpus seed strategy | Step 55 | Open | SDK |
| Whether UniFFI is ever used for a *sixth* language later | Only if needed | Open | SDK |
| Backend CI-published OpenAPI artifact for automated snapshot drift | Post–Step 1 / ongoing | Open | Backend |
| Hosted contract-test environment for CI shadow live runs | Post–step 25 | Open | Backend + SDK |

## Reusable handoff-entry template

Copy into each `### Phase N` subsection when opening a phase:

```markdown
### Phase N — <name> — <Status>

<!-- running per-step bullets accumulate here as each step lands -->
- Step X (<title>): <one-line what/why> — PR #___, "done when" verified: <how>

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …
```
