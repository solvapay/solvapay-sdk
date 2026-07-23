# Rust Core SDK migration map

Living **state / progress / handoff** layer for the Rust core SDK redesign. Companion to the architecture/spec doc:

- **Spec / architecture:** [`rust-core-sdk-redesign-v2.md`](./rust-core-sdk-redesign-v2.md) — what to build and why
- **This map:** where each of the 55 steps stands, and what each phase handed off

Session workflow (redesign §14): pick the next incomplete step in redesign §9 → implement only that step → prove its "done when" → update **this map** (status + handoff bullets). At each phase close, finalize that phase's handoff entry before opening the next phase's first PR.

**Current progress (2026-07-23):** Steps 1–38 **Done**; Step **37R Done** (a–e); Step **38R Done** (a–g); Step 39 **In progress** (local host-native + WASI clean-install green; awaiting full CI matrix); Step **39G-a/b/c Done** (§15 notes 40–42); Steps **40–42 Done** — Phase 7 **closed** (§15 notes 43–45); Steps **43–45 Done** — Phase 8 **closed** (§15 notes 46–48); Steps **46–48 Done** — Phase 9 **closed** (§15 notes 49/53); Step **18T Done** — shared IR doc model + TSDoc + coverage CI gate (§15 note 50); Step **42T Done** — Python `.pyi` + `py.typed` + `mypy`/`pyright`/`ruff` strictness + docstring coverage (§15 note 51); Step **45T Done** — Ruby YARD + `steep==2.0.0` / `rubocop==1.88.2` strictness (§15 note 52); Step **47 Done** — generated Rust facade + blocking twins + signature-parity + Phase 0 fixture conformance + rustdoc. Phase 6 closes when Step 39 CI is green. Phase 6G **closed**. Strict-typing retrofit track closed for TS/Python/Ruby; Rust rustdoc column closed. **Next:** Step 49 (scaffold wazero binding).

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
| 18T | Doc-comment generation — shared infra + TS (retrofit) | Phase 2 | Done | — | Manifest `docs:` catalog; IR `IrDocModel` + lowering (`docs.params` wins over inline `params[].doc`); surface-agnostic `check_doc_coverage` + CI gate; TSDoc (`summary`/`@param`/`@returns`) on `client.generated.d.ts`; drift + `@generated` + idempotence gates green; RED→GREEN on manifest/lower/coverage/emit tests | [Strict typing & doc comments](#strict-typing--doc-comments--retrofit) |
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
| 30 | Helpers: usage / limits / plans | Phase 4 | Done | — | `helper-usage` (12) + `helper-limits` (5) + `helper-plans` (3) green in TS harness + Rust `fixture-runner` (`executed=354 passed=354 failed=0`; was 334); RED stubs → unit `failed=11` + fixture `failed=15`; usage/limits/plans characterization + core unit tests green; step-8 gates + §15 note 22 | [Phase 4](#phase-4--route-helper-cores) |
| 31 | Helpers: merchant / product / error | Phase 4 | Done | — | `helper-error` (10) + `helper-product` (3) green in TS harness + Rust `fixture-runner` (`executed=367 passed=367 failed=0`; was 354); RED stubs → unit `failed=8` + fixture `failed=8`; merchant/product/error characterization + core unit tests green; step-8 gates + §15 note 23 | [Phase 4](#phase-4--route-helper-cores) |
| 32 | Paywall decision core | Phase 5 | Done | — | `paywall/decision/` (16) green in TS harness + Rust `fixture-runner` (`executed=383 passed=383 failed=0`; was 367); RED stubs → unit `failed=11` + fixture `failed=13`; paywall characterization + core unit tests green; step-8 gates + §15 note 24 | [Phase 5](#phase-5--paywall-decision-engine-and-mcp-contracts) |
| 33 | Client payload shapes | Phase 5 | Done | — | `paywall/client-payload` (9, was 4) green in TS harness + Rust fixture-runner (`executed=392 passed=392 failed=0`; was 383); RED stub → unit `failed=5` + fixture `failed=9`; step-8 gates + §15 note 25 | [Phase 5](#phase-5--paywall-decision-engine-and-mcp-contracts) |
| 34 | MCP payload builders | Phase 5 | Done | — | Dual-binding TS green (`mcp-core` + `server` `paywallToolResult`) + Rust `mcp/*` 19/19 + full corpus `executed=411 passed=411 failed=0` (was 392); step-8 gates + §15 note 26 | [Phase 5](#phase-5--paywall-decision-engine-and-mcp-contracts) |
| 35 | MCP names + descriptors | Phase 5 | Done | — | Descriptor fixtures `mcp/{tool-names,derive-icons,descriptors,prompts}` (20) + prior `mcp/` 19 → 39; TS harness + Rust fixture-runner `executed=431 passed=431 failed=0` (was 411); RED characterization + unit suite first; step-8 gates + §15 note 27 | [Phase 5](#phase-5--paywall-decision-engine-and-mcp-contracts) |
| 36 | Scaffold napi-rs | Phase 6 | Done | — | `cargo test -p solvapay-node` + `node --test` smoke + `NAPI_RS_FORCE_WASI=error` + `check-artifacts.mjs` hard-fail; CI `node-binding` matrix (§7.7) + WASI + artifact gate | [Phase 6](#phase-6--node-binding-cutover-then-edgebrowser-wasm) |
| 37 | Wire conditional exports | Phase 6 | Done (narrow scope; superseded by 37R) | — | `test:unit:rust` + `test:unit:ts` green (329 each); `NAPI_RS_FORCE_WASI=true` verify smoke; CI `node-binding-conformance`; `@solvapay/server` optionalDependency on `@solvapay/server-native` | [Phase 6](#phase-6--node-binding-cutover-then-edgebrowser-wasm) |
| 37R | Full-surface Node napi cutover | Phase 6 | Done | — | Per confirmed sub-step (37R-a…e, §15 notes 32–37): (a–d) ✅ NativeClient + sync helper/paywall/retry + core/MCP builders; (e) ✅ both-flags server/core/mcp-core + contract, `node-binding-delegation` grep gate, clean-install beyond `verifyWebhook`, `shadow:selftest` IDENTICAL; React unmodified throughout | [Phase 6](#phase-6--node-binding-cutover-then-edgebrowser-wasm) |
| 38 | Edge/browser WASM cutover | Phase 6 | Done | — | CI `wasm-binding`: artifact drift + feature exclusivity + symbol audit + budgets + edge unit (70×2) + 18/18 edge corpus rust/ts + Deno smoke + fetch-runtime; browser gzip 6531 / cold ~12.7ms | [Phase 6](#phase-6--node-binding-cutover-then-edgebrowser-wasm) |
| 38R | Full-surface edge WASM cutover | Phase 6 | Done | — | Per sub-step (38R-a…g, §15 note 38): `WasmClient` (36 Groups A–C over `FetchTransport`) + sync decision/paywall/retry/core/MCP envelopes via `initSync`; edge installs WASM dispatch in `edge.ts`; browser public-safe subset + opt-in `warmBrowserCoreWasm`; `callWasm`/`callWasmSync`/`verifyWebhookWasm` delegation markers; server 366×2 / mcp-core 108×2 / core 117 / React 1083; Deno edge smoke (async webhook + sync dispatch); symbol audit + budgets re-recorded | [Phase 6](#phase-6--node-binding-cutover-then-edgebrowser-wasm) |
| 39 | Clean-install smoke tests | Phase 6 | In progress | — | Local: `CLEAN_INSTALL_OK` native darwin-arm64 + WASI on Node 26; CI jobs `node clean install (native, <target>, Node <major>)` ×24 + `node clean install (WASI, Node <major>)` ×3 (pending green) | [Phase 6](#phase-6--node-binding-cutover-then-edgebrowser-wasm) |
| 39G-a | Binding-boundary IR + manifest `bindings:` section | Phase 6G | Done | — | `pnpm manifest:check` green (schema + reconciliation); `cargo test -p dto-gen` green (parse/lower/idempotence); `binding-symbols.snapshot.json` committed + CI drift via `dto-gen --dump-bindings`; 102 symbols enumerated from 37R/38R shims; no shim emission | [Phase 6G](#phase-6g--binding-glue-generator) |
| 39G-b | Rust shim emitters (napi + wasm) + retrofit proof | Phase 6G | Done | — | Regenerated node + wasm shims diff-clean below `@generated` header (8 files); `cargo test -p dto-gen` golden + unit green; `cargo test -p solvapay-node` 22/22 on generated shims; CI regen-drift + `@generated` header gate cover the eight shim paths; both-flag suites unchanged (behavioral proof) | [Phase 6G](#phase-6g--binding-glue-generator) |
| 39G-c | Native-side marshalling emitters (TS) | Phase 6G | Done | — | Regenerated `native.ts` / `wasm.ts` diff-clean below `@generated` header; `emit_bindings_ts.rs` + chrome asset; `cargo test -p dto-gen` golden + unit green; CI regen-drift + `@generated` header gate cover both paths; server 366×2 / core 117×2 / mcp-core 108×2; `pnpm delegation:check` OK (inventory unchanged); six `payloadBuilders` `emitOrder` values aligned to public TS union order | [Phase 6G](#phase-6g--binding-glue-generator) |
| 40 | Scaffold PyO3/maturin | Phase 7 | Done | — | `cargo test -p solvapay-python` + pytest smoke (async+blocking) + `python_shim_golden` + CI `python-binding` matrix + `check-wheels.py` | [Phase 7](#phase-7--python) |
| 41 | Generate the Python facade (+ generated binding glue, §5.7) | Phase 7 | Done | — | `python_shim_golden` + `native_py_golden` + `python_parity_golden`; `cargo test -p solvapay-python`; facade/envelope pytest; CI regen-drift covers python shims + `_native.py` + parity suite (§15 note 44) | [Phase 7](#phase-7--python) |
| 42 | Live contract tests + publish (Python) | Phase 7 | Done | — | Offline `pytest` contract suite green (535 fixtures + 36-op coverage); fresh-venv wheel install; `shadow-python.yml` dispatch-only live path; `publish-python.yml` TestPyPI-default + OIDC; §7.7 skew guard | [Phase 7](#phase-7--python) |
| 42T | Python strict typing + doc comments (retrofit) | Phase 7 | Done | — | `emit_pyi_py` + committed `__init__.pyi` + `py.typed`; `mypy==1.17.1 --strict` + `pyright==1.1.411` strict + `ruff==0.12.4` green on public stubs in `python-binding` smoke; docstrings from IR `IrDocModel` (18T); regen-drift + `@generated` header cover `__init__.pyi`; `pyi_py_golden` + emitter coverage tests green | [Strict typing & doc comments](#strict-typing--doc-comments--retrofit) |
| 43 | Scaffold Magnus/rb-sys | Phase 8 | Done | — | `cargo test -p solvapay` + minitest smoke + CI `ruby-binding` native-host matrix + `check-gems.rb`; `Toolchain::Ruby` hello-world emitter + `ruby_shim_golden` (§15 note 46) | [Phase 8](#phase-8--ruby) |
| 44 | Generate the Ruby facade (+ generated binding glue, §5.7) | Phase 8 | Done | — | Full Groups A–C sync client + decisions/payload builders; generated `_native.rb` / `client.rb` / `helpers.generated.rb` / RBS / signature-parity; `SolvaPay.create` / `payable` / `gate`; 535 shared offline fixtures + 36-operation success/error guard; dto-gen goldens + CI regen-drift (§15 note 47) | [Phase 8](#phase-8--ruby) |
| 45 | Live contract tests + publish (Ruby) | Phase 8 | Done | — | Load-time skew guard; `scripts/live_contract.rb` + `shadow-ruby.yml` (dispatch-only); `publish-ruby.yml` OIDC dry-run-default + version stamp; rb-sys-dock remains deferred (§15 note 48) | [Phase 8](#phase-8--ruby) |
| 45T | Ruby strict typing + doc comments (retrofit) | Phase 8 | Done | — | YARD on generated `client.rb` / `helpers.generated.rb` from IR `IrDocModel` (18T); `emit_rbs_rb` extended for `NativeDispatch` + facade internals; pinned `steep==2.0.0` + `rubocop==1.88.2` + `rbs==4.0.3` green in `ruby-binding` full leg; `ruby_doc_coverage` + goldens + regen-drift green; no Sorbet | [Strict typing & doc comments](#strict-typing--doc-comments--retrofit) |
| 46 | Scaffold the `solvapay` facade crate | Phase 9 | Done | — | `cargo test -p solvapay` + `hello_world` mock round-trip + `--features blocking` compile/test; CI explicit blocking step; workspace `solvapay-ruby` rename frees crates.io name (§15 note 49) | [Phase 9](#phase-9--rust-public-crate) |
| 47 | Generate Rust facade signatures + signature-parity suite | Phase 9 | Done | — | `emit_client_rs` / `emit_parity_suite_rs` → `client_generated.rs` + `blocking_generated.rs` + `signature_parity_generated.rs`; 36 ops + rustdoc; Phase 0 fixture conformance via facade `Client`; CI regen-drift + `@generated` + `cargo doc -p solvapay` | [Phase 9](#phase-9--rust-public-crate) |
| 48 | crates.io publish + docs.rs + live contract tests | Phase 9 | Done | — | `publish-rust.yml` + `shadow-rust.yml` + `tools/live-contract` + tested `examples/rust/get-merchant` + crates.io graph flip (`publish=true` + version/path) + docs.rs cfg CI gate (§15 note 53) | [Phase 9](#phase-9--rust-public-crate) |
| 49 | Scaffold wazero binding | Phase 10 | Not started | — | — | [Phase 10](#phase-10--go-wazero--embedded-wasm) |
| 50 | Generate the Go facade + signature-parity suite (+ generated binding glue, §5.7) | Phase 10 | Not started | — | — | [Phase 10](#phase-10--go-wazero--embedded-wasm) |
| 51 | Live contract tests + go module release wiring | Phase 10 | Not started | — | — | [Phase 10](#phase-10--go-wazero--embedded-wasm) |
| 52 | Delete superseded TS in `@solvapay/core` | Post-cutover | Not started | — | — | [Post-cutover](#post-cutover--deletion-and-c-abi) |
| 53 | Delete superseded TS in `@solvapay/server` | Post-cutover | Not started | — | — | [Post-cutover](#post-cutover--deletion-and-c-abi) |
| 54 | Publish the optional C ABI | Post-cutover | Not started | — | — | [Post-cutover](#post-cutover--deletion-and-c-abi) |
| 55 | Promote all compatibility gates | Post-cutover | Not started | — | — | [Post-cutover](#post-cutover--deletion-and-c-abi) |
| MA-0 | Shared MCP-authoring conformance fixtures + adapter contract | MCP-authoring track | Not started | — | — | [MCP-authoring](#mcp-authoring-adapters--per-language) |
| MA-Py | `solvapay-mcp` (Python) over `mcp`/FastMCP | MCP-authoring track | Not started | — | — | [MCP-authoring](#mcp-authoring-adapters--per-language) |
| MA-Rb | `solvapay-mcp` (Ruby) over the Ruby MCP SDK | MCP-authoring track | Not started | — | — | [MCP-authoring](#mcp-authoring-adapters--per-language) |
| MA-Go | `solvapay-mcp` (Go) over the Go MCP SDK | MCP-authoring track | Not started | — | — | [MCP-authoring](#mcp-authoring-adapters--per-language) |
| MA-Rs | `solvapay-mcp` (Rust) over `rmcp` | MCP-authoring track | Not started | — | — | [MCP-authoring](#mcp-authoring-adapters--per-language) |

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
- Step 18T (Doc-comment generation — shared infra + TS): see [Strict typing & doc comments — retrofit](#strict-typing--doc-comments--retrofit); Phase 2 retrofit obligation for D19/TS closed; remaining surfaces stay on 42T/45T/47/50. Landed: manifest `docs:` (70 entry points), IR `IrDocModel`, `check_doc_coverage` + CI gate, TSDoc on `client.generated.d.ts`; §15 note 50

#### Step 17 decisions for future handoffs

- **Single surface:** Core returns / folds into `SdkError`; bindings convert once via `sdk_error_to_observation` (or language-native equivalent) — never a second taxonomy. Transport is `SdkError::Transport` only (step 19+).
- **Templates live in the manifest:** operation `errors.default` / `cases` already frozen; step 17 added webhook/paywall/transport message strings. dto-gen emits `solvapay-dto::error_templates`; `solvapay-core` depends on `solvapay-dto` for webhook message constants.
- **Fixtures:** `constructSdkError` builds variants for golden checks; TS asserts `name`/`message`/`status` only (`kind`/`code` are Rust-era); Transport uses stable codes `retryable` / `non_retryable`.

#### Step 18T decisions for future handoffs

- **Manifest `docs:` is the authored source** for entry-point summaries/params/returns (no OpenAPI operation-description linkage yet) — §15 note 50. IR shape stays forward-compatible for a later OpenAPI fallback.
- **`docs.params.<name>` wins** over inline `params[].doc` when both exist.
- **Coverage is surface-agnostic** (`check_doc_coverage` on all `ir.entry_points`); emitters only add a language column. Reuse from 42T/45T/47/50.

**Phase-close handoff:**
- **What was done:** `dto-gen` → `solvapay-dto` (wire schemas, routes, overlays, error templates); `SdkError` in core; TS `client.generated.d.ts` + parity/signature-parity gates; Step 18T shared IR doc model + TSDoc + doc-comment coverage CI gate (D19 reference surface).
- **Why:** Single generated contract for Rust transport and multi-language facades; no hand-duplicated DTOs, error strings, or per-language doc comments.
- **Decisions to document:** Step 15–18 + 18T bullets; `ProcessPaymentResult` untagged enum; overlay catalog in manifest; manifest `docs:` as entry-point doc source (§15 note 50). New §10.3 / §13 gate: doc-comment coverage (shared infra + TS green; Python/Ruby/Rust/Go still open). Deviations: §13 OpenAPI gates (`includeCheckoutSession`, process-payment discriminator) still open — worked around via overlays/untagged. Deferred: backend republish for those gates; OpenAPI-operation-description → IR docs fallback.
- **Pointers:** redesign §2.5, §2.8, §5.1, §5.6, D19; `contract/manifest/sdk-contract.yaml`; §15 notes 10–12, **50**.

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

### Phase 4 — Route helper cores — Done

- **Step 26 (Helpers: customer / auth / activation):** `solvapay-core::{auth_resolution, customer_sync, activation, helper_error, hmac_util}`; TS pure extracts in `@solvapay/core` (`customer-sync`, `activation`) rewired into `paywall.ensureCustomer` / helpers; golden fixtures under `contract/fixtures/helper-*`; fixture-runner bindings. Auth TS runtime stays on `getAuthenticatedUserCore` (fixtures synthesize `Request` + env patch). RED: wrong-default auth stub → `failed=24`; GREEN: full corpus `executed=256 passed=256 failed=0`. §15 note 18.
- **Step 27 (Helpers: payment / payment-method / checkout):** `solvapay-core::{payment, checkout}`; TS pure extracts in `@solvapay/core` (`payment`, `checkout`) rewired into server shims; golden fixtures `helper-payment` (22) + `helper-checkout` (8); fixture-runner bindings. Characterization suites added for previously untested `checkout.ts` / `payment-method.ts`. RED: wrong-default stubs → unit `failed=11` + fixture `failed=17`; GREEN: `executed=286 passed=286 failed=0`. §15 note 19.
- **Step 28 (Helpers: auto-recharge / balance-poll):** `solvapay-core::balance_poll` (tables + `BalancePollPolicy` + `evaluate_balance_observation`); no TS extract — fixtures bind `@solvapay/server` `pollBalanceUntilIncreased` directly (withRetry precedent); golden fixtures `helper-balance-poll` (14); fixture-runner host adapter. Auto-recharge nil decision core; characterization suite extended. RED: wrong empty tables + evaluate `None` → unit `failed=3` + fixture `failed=12`; GREEN: `executed=300 passed=300 failed=0`. §15 note 20.
- **Step 29 (Helpers: purchase / renewal):** `solvapay-core::{purchase, renewal}`; TS pure extracts in `@solvapay/core` (`purchase`, `renewal`) rewired into server shims; golden fixtures `helper-purchase` (10) + `helper-renewal` (24); fixture-runner bindings. Characterization suite added for previously untested `renewal.ts`. RED: wrong-default stubs → unit `failed=23`; GREEN: `executed=334 passed=334 failed=0`. §15 note 21.
- **Step 30 (Helpers: usage / limits / plans):** `solvapay-core::{usage, limits, plans}` + shared `serde_util::serialize_whole_f64`; TS pure extracts in `@solvapay/core` (`usage`, `limits`, `plans`) rewired into server shims; golden fixtures `helper-usage` (12) + `helper-limits` (5) + `helper-plans` (3); fixture-runner bindings. Characterization suites added/extended for `limits.ts` / `plans.ts` / `getUsageCore`. RED: wrong-default stubs → unit `failed=11` + fixture `failed=15`; GREEN: `executed=354 passed=354 failed=0`. §15 note 22.
- **Step 31 (Helpers: merchant / product / error):** `solvapay-core::{route_error, product}`; TS pure extracts in `@solvapay/core` (`error`, `product`) rewired into server shims; golden fixtures `helper-error` (10) + `helper-product` (3); fixture-runner bindings. Merchant nil decision core; characterization suites added/extended for `merchant.ts` / `product.ts` / `error.ts`. RED: wrong-default stubs → unit `failed=8` + fixture `failed=8`; GREEN: `executed=367 passed=367 failed=0`. §15 note 23.

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

#### Step 30 decisions for future handoffs

- **Fixture counts:** `helper-usage` 12 + `helper-limits` 5 + `helper-plans` 3 (= +20 bound cases). Full corpus `executed` 334→354; `failed=0`.
- **Extract vs nil-core split:** `projectUsageSnapshot` is the real usage core; `trackUsageCore` stays TS-only (auth → ensureCustomer → trackUsage orchestration). Limits/plans extract only query validation; auth/HTTP/config/capability guards stay host.
- **Frozen `productRef` message:** limits/plans use `'Missing required parameter: productRef'` (no `is required` suffix) — do **not** reuse `validateCheckoutSessionParams`.
- **percentUsed gotchas:** `Math.round((used/total)*10000)/100` with `Math.min(100, …)` / `Math.max(0, remaining)`; `total === 0` → `percentUsed: null` and `remaining: 0`. Whole-valued numerics must emit JSON integers via shared `serde_util::serialize_whole_f64` (step-23/28 precedent). Inputs are non-negative so `f64::round` agrees with JS half-up; one half-up unit case locked (`1/20000` → `0.01`).
- **Characterization gap filled:** redesign assumed existing `*.test.ts` — only `usage.test.ts` (trackUsage) existed; added `limits.test.ts` + `plans.test.ts` and extended `usage.test.ts` for `getUsageCore` before shim refactor (pass unmodified after rewire).
- **Host stays:** auth, `ensureCustomer`, `apiClient.checkLimits` / `listPlans`, config-missing / method-unavailable guards, `plans ?? []` fallback.

#### Step 31 decisions for future handoffs

- **Fixture counts:** `helper-error` 10 + `helper-product` 3 (= +13 bound cases). Full corpus `executed` 354→367; `failed=0`.
- **Extract vs nil-core split:** `mapRouteError` / `isErrorResult` are the real error cores; `validateGetProductParams` is the only product extract. `merchant.ts` stays TS-only (config → capability guard → client-call orchestration, same class as payment-method / auto-recharge).
- **Host narrowing:** `handleRouteError` keeps `console.error` + `instanceof SolvaPayError` / `instanceof Error` → `RouteErrorKind`; pure `mapRouteError` maps kind/message/status only.
- **`details` always present on map paths:** reuse `HelperErrorResult::with_details`; product 400 uses `without_details` (skip-absent parity with activation/plans).
- **Frozen `productRef` message:** same string as limits/plans (`'Missing required parameter: productRef'`) — separate validator (do not reuse checkout).
- **Characterization gap filled:** redesign assumed existing `*.test.ts` — only `error.test.ts` (3 cases) existed; extended it and added `merchant.test.ts` + `product.test.ts` before/after shim refactor (pass unmodified after rewire).

**Phase-close handoff:**
- **What was done:** Decision/normalization cores for all Phase 4 route helpers (steps 26–31) live in `solvapay-core` + `@solvapay/core` pure extracts; TS shims keep Request/auth/HTTP/console; golden fixtures + characterization suites green; full bound corpus `executed=367 failed=0`.
- **Why:** Phase 4 closes helper cores before Phase 5 paywall/MCP and Phase 6 napi cutover; host shims stay thin until bindings replace them.
- **Decisions to document:** Steps 26–31 decision bullets; nil-core helpers (payment-method, auto-recharge, merchant, trackUsage) stay TS-only; shared `HelperErrorResult` skip-absent. Deviations: none vs redesign intent. Deferred: napi cutover (step 37) for literal "tests pass against the binding".
- **Pointers:** redesign §9 steps 26–31, §15 notes 18–23; `contract/fixtures/helper-*`; `solvapay-core::{auth_resolution, customer_sync, activation, payment, checkout, balance_poll, purchase, renewal, usage, limits, plans, route_error, product}`.

### Phase 5 — Paywall decision engine and MCP contracts — Done

- **Step 32 (Paywall decision core):** `solvapay-core::paywall_decision` + TS pure extract in `@solvapay/core` (`paywall-decision`) rewired into `SolvaPayPaywall.decide()`; golden fixtures `paywall/decision` (16); fixture-runner bindings. Characterization extended for cache decrement/evict/block-once + gate edges. RED: wrong-default stubs → unit `failed=11` + fixture `failed=13`; GREEN: `executed=383 passed=383 failed=0`. §15 note 24.
- **Step 33 (Client payload shapes):** `solvapay-core::paywall_payload` (`paywall_client_payload`); golden fixtures `paywall/client-payload` (9, was 4); fixture-runner binding. No TS extract — binds `@solvapay/server` export directly. RED: wrong-default stub → unit `failed=5` + fixture `failed=9`; GREEN: `executed=392 passed=392 failed=0`. §15 note 25.
- **Step 34 (MCP payload builders):** `solvapay-core::mcp` (`paywall_tool_result` + `make_response_result` / `assert_response_result`); golden fixtures `mcp/` (19); dual-binding TS harness (`mcp-core` + `server` `formatGate`) proves identical payloads; fixture-runner bindings; manifest `errors.mcp.messages.rawHandlerReturn` → `error_templates::mcp`. GREEN: `executed=411 passed=411 failed=0`. §15 note 26.
- **Step 35 (MCP names + descriptors):** `solvapay-core::mcp::{tool_names,descriptors}` + TS pure extract `@solvapay/mcp-core` `descriptor-metadata` rewired into `buildSolvaPayDescriptors` / `buildSolvaPayPrompts`; golden fixtures `mcp/tool-names` (2) + `derive-icons` (4) + `descriptors` (5) + `prompts` (9) = +20; fixture-runner bindings. Characterization extended before extract. GREEN: `executed=431 passed=431 failed=0`. §15 note 27.

#### Step 32 decisions for future handoffs

- **Fixture counts:** `paywall/decision` 16 (= +16 bound cases). Full corpus `executed` 367→383; `failed=0`.
- **What moved vs stayed:** Pure cores — `resolveProductRef`, `evaluateCachedLimits`, `evaluateFreshLimits`, `decidePaywallOutcome` (+ `resolveFallbackGateLimits`). Host stays — `ensureCustomer` / deduplicator, limitsCache Map/TTL/timestamps, `apiClient.checkLimits`, `trackUsage` on gate, `generateRequestId`, `runAllow`/`protect` plumbing.
- **Gate reuse:** Rust `decide_paywall_outcome` calls in-crate `build_paywall_gate` (step 14). TS injects `buildGate: buildPaywallGate` at the package boundary so `@solvapay/core` does not depend on `@solvapay/server` (gate + paywall-state remain server-side until a later extract).
- **Cache semantics in core:** Evaluators return flags (`evict` / `shouldCache`) + decremented `remaining`; host mutates the Map. Zero-remaining cache entry blocks exactly one follow-up then evicts.
- **Fallback limits:** `plan: ''`, `remaining: 0`, skip-absent `checkoutUrl` (`!== undefined` / `Option` presence including empty string).
- **Integer emission:** Whole-number `remaining` via shared `serde_util::serialize_whole_f64` (steps 23/28/30 precedent).
- **Characterization gap filled:** Extended `paywall.unit.test.ts` `decide()` coverage for cache hit remaining=1/0, fresh remaining=1, no-checkoutUrl gate, full payment gate (pass unmodified after rewire).

#### Step 33 decisions for future handoffs

- **Fixture counts:** `paywall/client-payload` 9 (was 4; +5 field-presence axes). Full corpus `executed` 383→392; `failed=0`.
- **No TS extract:** `paywallErrorToClientPayload` stays a standalone `@solvapay/server` export; TS harness + Rust fixture-runner both bind it (withRetry / step-28 precedent). Production TS untouched.
- **Related shapes out of scope:** generic 500 `{ success: false, error }` bodies in `handleHttpError` / `handleNextError` stay host Response plumbing (step-31 `handleRouteError` class).
- **Input type:** reuses step-14 `PaywallGate` / `PaywallGateKind` (exact `PaywallStructuredContent` shape).
- **Payment branch asymmetry:** never emits `plans` / `confirmationUrl` even when present on the input gate.
- **Presence semantics:** `confirmationUrl: ""` is emitted (`!== undefined`, not `||` truthiness); input JSON `null` on raw Value options ≡ absent (pinned divergence, steps 13/14).

#### Step 34 decisions for future handoffs

- **Fixture counts:** `mcp/` 19 (`paywall-tool-result` 7 + `response-envelope` 7 + `assert-response-envelope` 5). Full corpus `executed` 392→411; `failed=0`.
- **Dual-binding proof:** `paywallToolResult` registered twice — `id: 'mcp-core'` → `paywallToolResult(PaywallError)` and `id: 'server'` → `McpAdapter.formatGate` — same `expect.result` (step-4 node/edge precedent).
- **Two additive public exports:** `McpAdapter` from `@solvapay/server`; `makeResponseResult` / `assertResponseResult` from `@solvapay/mcp-core` (adapter-internal helpers — not merchant-facing `@solvapay/mcp` entry). Root `devDependency` `@solvapay/mcp-core: workspace:*`.
- **No TS extract:** production builders stay in place; fixtures bind existing exports (step-33 / withRetry precedent).
- **Typed-gate pin:** Rust input is step-14 `PaywallGate` (unknown extra fields out of contract).
- **`message === gate.message` pin:** every paywall-tool-result fixture keeps narration and `structuredContent.message` identical so both bindings agree (`formatGate` always uses `gate.message`).
- **Envelope skip-absent:** `options` omitted when `None`; `emittedBlocks` omitted when empty (`[]` → key absent); `options` is raw-`Value` passthrough.
- **Manifest freeze:** `errors.mcp.messages.rawHandlerReturn` → `solvapay_dto::error_templates::mcp::RAW_HANDLER_RETURN`; dto-gen + Zod schema extended.
- **Payment vs activation asymmetry does not apply:** unlike step 33, MCP `structuredContent` is the gate verbatim (balance / productDetails / plans / confirmationUrl all ride through).

#### Step 35 decisions for future handoffs

- **Fixture counts:** `mcp/` 39 (= prior 19 + `tool-names` 2 + `derive-icons` 4 + `descriptors` 5 + `prompts` 9). Full corpus `executed` 411→431; `failed=0`.
- **What moved vs stayed:** Pure cores — `MCP_TOOL_NAMES`, `TOOL_FOR_VIEW`/`VIEW_FOR_TOOL`, `deriveIcons`, tool/prompt descriptor metadata, prompt user-message text, `validatePublicBaseUrl`. Stays TS — handlers, zod `inputSchema`, `readHtml`/fs/`crypto.randomUUID()`, `buildBootstrapPayload`, CSP/`mergeCsp`, narration, resources.
- **Single-source rewire:** TS extract `descriptor-metadata.ts`; `buildSolvaPayDescriptors` / `buildSolvaPayPrompts` attach schemas + handlers onto metadata by name so registration order / descriptions / annotations stay one table.
- **Ordering gotcha:** deep equality asserts registration order — intent tools (filtered by `views`) → 8 transport tools → `activate_plan`. Empty `views` drops intent tools only; transport + `activate_plan` still emit.
- **Skip-absent:** omit `title` / `icons` when absent; annotations serialize only set flags (`openWorldHint` always + per-tool); `deriveIcons` `undefined` → fixture `null`.
- **No manifest change:** frozen `publicBaseUrl` message stays a local const (not an `errors.mcp` template) — no new HTTP operations.

**Phase-close handoff** (Phase 5 complete — step 35 last):
- **What was done:** Ported paywall decision cores (32), client 402 payload shapes (33), MCP paywall/envelope builders (34), and MCP tool-name/descriptor/prompt metadata (35) into `solvapay-core` with golden fixtures proving TS↔Rust byte parity.
- **Why:** Phase 5 closes the last pure decision/contract surface before Phase 6 napi cutover; MCP adapters keep host wiring while core owns names + descriptor metadata.
- **Decisions to document:** Steps 32–35 decision bullets; dual-binding for `paywallToolResult`; TS extract for decision + descriptors (not for client-payload / envelope); skip-absent / ordering / `isError: false` pins. Deviations: none vs redesign intent. Deferred: napi binding of these cores (step 37).
- **Pointers:** redesign §9 steps 32–35, §15 notes 24–27; `contract/fixtures/{paywall,mcp}/`; `solvapay-core::{paywall_decision,paywall_payload,mcp}`.

### Phase 6 — Node binding cutover, then edge/browser WASM — In progress

<!-- running per-step bullets accumulate here as each step lands -->
- Step 36 (Scaffold napi-rs): `rust/bindings/node` (`solvapay-node` cdylib) with `napiVersion` + `verifyWebhook` smoke over `solvapay-core`; per-target `npm/<triple>/` optionalDependency layout (`@solvapay/server-native`); WASI `wasm32-wasip1-threads` fallback; `scripts/check-artifacts.mjs` hard gate; CI `node-binding` / `node-binding-wasi` / `node-binding-artifacts` — "done when" verified: native require-smoke + `NAPI_RS_FORCE_WASI=error` + artifact gate fail-on-missing; §15 note 28
- Step 37 (Wire conditional exports): Node `verifyWebhook` dispatches via `SOLVAPAY_IMPL` through `@solvapay/server-native` (`webhook-native.ts` + `createRequire`); TS body retained as `verifyWebhookTs`; `edge.ts` untouched at this step; `pnpm-workspace` includes `rust/bindings/*`; CI `node-binding-conformance` runs `test:unit:rust` then `test:unit:ts` — "done when" verified: 329/329 green both flags + WASI-forced smoke
- Step 38 (Edge/browser WASM cutover): `@solvapay/server-wasm` (wasm-bindgen) with `edge`/`browser` profiles; edge `verifyWebhook` defaults to WASM (`webhook-wasm.ts`); Web Crypto retained as `SOLVAPAY_IMPL=ts` rollback; CI `wasm-binding`; Deno smoke + §7.8 budgets recorded — "done when" verified: symbol audit, budgets `--check`, 70 edge unit tests ×2, 18/18 edge corpus rust/ts, Deno mcp-core smoke
- Step 39 (Clean-install smoke tests): publish-shaped tarball bundle from Step 36 artifacts (`prepare-clean-install-packages.mjs` → artifact `server-clean-install-packages`); fresh `npm install` into empty temp + public `@solvapay/server` `verifyWebhook` with `SOLVAPAY_IMPL=rust`; native isolation (no WASI pkg) vs WASI isolation (`NAPI_RS_FORCE_WASI=error`, no `.node`); CI `node-clean-install-native` (8 targets × Node 22/24/26) + `node-clean-install-wasi` (×3); local GREEN on darwin-arm64 + WASI — "done when" pending full remote matrix green
- Step 37R patch plan (2026-07-21): confirmed sub-steps 37R-a…e, JSON-envelope async boundary, per-surface `SOLVAPAY_IMPL` via `native.ts`, `node-binding-delegation` gate design — write-backs in redesign §9 / §10.3 / §13 / §15 note 32 + this map's Step 37R decisions
- Step 37R-a (Binding foundation + client Group A): napi `NativeClient` over `ReqwestTransport` + JSON-envelope helpers; `packages/server/src/native.ts` loader/dispatch; Group A per-method dispatch in `client.ts` (dynamic import keeps edge free of `node:module`); `test:unit:rust` + `test:unit:ts` 351/351; §15 note 33
- Step 37R-b (Client Groups B + C): 26 more `#[napi] async fn` methods + `split_path_refs`; `NativeClientMethod` / `client.ts` dispatch for all 36; fetch-mocked characterization suites pinned to `SOLVAPAY_IMPL=ts`; `test:unit:rust` + `test:unit:ts` 353/353; §15 note 34
- Step 37R-c (Helper decision cores + paywall + retry): sync JSON-envelope `#[napi]` fns over existing `solvapay_core` decisions; `run_envelope_sync` + `decisions.rs`; `callNativeSync` + `native-decisions.ts` (install API keeps edge free of `node:module`); `withRetry` delegates only `retryNextDelayMs`; harness rewired to server wrappers; `test:unit:rust`/`ts` 359/359; `test:contract` 1178 both flags; §15 note 35
- Step 37R-d (`@solvapay/core` pure logic + MCP builders): sync JSON-envelope `#[napi]` fns in `payload_builders.rs` over `business_details` / `credit_display` / `seller_identity` / `mcp`; shared `args.rs`; per-package `installNativeCoreApi` / `installNativeMcpApi` (no static `node:module`); `McpAdapter.formatGate` dual-binds `paywallToolResult` via install; React stays on TS via `@solvapay/core/business-details`; `test:contract` 1178 both flags; §15 note 36
- Step 37R-e (Conformance + gates): `node-binding-delegation` grep gate (`scripts/check-delegation.ts` + `contract/delegation-allowlist.json` + CI job); widened `node-binding-conformance` (server+core+mcp-core unit + contract both flags + React); clean-install extended (`buildPaywallGate` + host-native `getCustomer` stub; WASI sync-only); shadow TS driver pins `SOLVAPAY_IMPL=ts`; `NativeClient` cfg'd out of WASI; §15 note 37
- Step 38R (Full-surface edge WASM cutover): edge mirror of 37R over `@solvapay/server-wasm`. `WasmClient` (`rust/bindings/wasm/src/wasm_client.rs`, `Rc<SolvaPayClient>` over `FetchTransport`) exposes all 36 Groups A–C async methods; sync `decisions.rs` + `payload_builders.rs` mirror the napi bindings via `#[wasm_bindgen(js_name=…)]`; `packages/server/src/wasm.ts` generalizes `webhook-wasm.ts` (`callWasm` / `callWasmSync` / `ensureWasmReadySync` / `resolveEdgeImpl` + envelope reconstruct); `client.ts` dispatches edge→WASM / Node→napi via runtime split + dynamic import; `edge.ts` installs decision/core/MCP WASM dispatch + publishes the ambient sync API + fire-and-forget warm-up; `native-decisions`/`native-core`/`native-mcp` `shouldAttempt` now gate purely on install (edge-safe); browser profile ships the public-safe subset (business-details / credit-display / seller-identity) with opt-in `@solvapay/core/browser-wasm` `warmBrowserCoreWasm`; delegation gate learns `callWasm`/`callWasmSync`/`verifyWebhookWasm`; budgets re-recorded (browser gzip 63633 / edge 298838, both lazy/opt-in) — "done when" verified: server 366×2, mcp-core 108×2, core 117 (incl. browser warm-up), React 1083 unmodified, `pnpm delegation:check` OK, browser symbol audit + `budgets --check` OK, Deno edge smoke async webhook + sync dispatch + ambient mcp-core; §15 note 38

**Phase-close criteria:** Phase 6 closes when Step 39's CI matrix is green (**Steps 37R and 38R are done**).

#### Step 36 decisions for future handoffs

- **Provisional package name:** `@solvapay/server-native` (binaryName `server-native`); per-target packages `@solvapay/server-native-<platform>` + `@solvapay/server-native-wasm32-wasi` (`cpu: ["wasm32"]`). Until first publish, `optionalDependencies` use `file:./npm/<triple>` so `npm ci` stays in sync without a registry. Do **not** use `npm ci --omit=optional` for local WASI builds — it also omits `@napi-rs/wasm-tools-*` platform binaries and `napi build --target wasm32-wasip1-threads` then fails with `Failed to copy artifact`. Wired into `@solvapay/server` in step 37.
- **Tokio runtime:** napi-rs built-in shared runtime via `napi` feature `tokio_rt` — **per-addon** (not per-process). Safe under Node `worker_threads` (each addon instance owns its runtime). Sync smoke / step-37 `verifyWebhook` do not exercise it; later async client methods will.
- **`NAPI_RS_FORCE_WASI`:** CLI ≥3.7 treats only `true` / `error` as force; `1` / `0` / `false` do **not** force WASI. CI and local WASI smoke use `NAPI_RS_FORCE_WASI=error` (binding) / `true` (server conformance smoke).
- **Error conversion:** single layer in `error.rs` — `WebhookError` → `BindingError` → `Error<&'static str>` so JS `Error.code` is the snake_case webhook code (`napi_create_error` maps status → code). FFI edges wrapped in `catch_unwind` (§7.6).
- **Artifact gate:** napi CLI warns-and-continues on missing prebuilds; `scripts/check-artifacts.mjs` hard-fails if any §7.7 `npm/<triple>/` dir lacks its `.node`/`.wasm`.
- **MSRV:** napi 3.10.x MSRV is 1.88; workspace stays on pinned `1.96.0` (no bump).

#### Step 37 decisions for future handoffs

- **Flag semantics (`SOLVAPAY_IMPL`):** `ts` forces TypeScript `node:crypto`; `rust` forces the napi binding and surfaces a load error if missing; unset prefers rust when `createRequire('@solvapay/server-native')` succeeds, else silent TS fallback. Read per-call (no process-lifetime freeze of the flag).
- **Sync load:** Node `verifyWebhook` stays synchronous — load via `createRequire(import.meta.url)` (tsup Node bundle uses `shims: true` so CJS gets a real `import.meta.url`). Vitest `vi.mock` does **not** intercept `createRequire`; unit routing tests inject via `setWebhookBindingForTests`.
- **Message parity:** native throws keep the frozen `solvapay_dto::error_templates::webhook` strings; adapter `JSON.parse`s the success string and rewraps thrown `Error` as `SolvaPayError(err.message)` so existing `.type` / `toThrowError(SolvaPayError)` assertions stay valid.
- **Edge stayed TS in this step:** Step 37 left `edge.ts` on Web Crypto. **Step 38 moved edge webhook to WASM**; the rest of the edge surface (client/factory/paywall/helpers/fetch) remains TypeScript. `edge.ts` must still never import `webhook-native` / `@solvapay/server-native`.
- **Workspace / optionalDependency:** `pnpm-workspace.yaml` includes `rust/bindings/*`; `@solvapay/server` declares `"@solvapay/server-native": "workspace:*"` under `optionalDependencies`; tsup Node externals include `@solvapay/server-native` + `node:module` (`sideEffects: false` unchanged).
- **Scope:** only Node sync `verifyWebhook` cut over this step; full-surface napi cutover stays later.
- **Superseded scope (2026-07-21):** the narrow "verifyWebhook only" scope is superseded by **Step 37R** (redesign §9, §15 note 31). The flag semantics, `createRequire` loader pattern, optionalDependency layout, and `node-binding-conformance` gate all carry forward into 37R; nothing landed in Step 37 is reverted.

#### Step 38 decisions for future handoffs

- **Package:** `@solvapay/server-wasm` at `rust/bindings/wasm/` (mirrors `@solvapay/server-native`). Committed `pkg/{edge,browser}/` + `pnpm build` only checks presence; regenerate with `pnpm build:wasm` (Rust + wasm-bindgen-cli **0.2.126** + npm `binaryen@131.0.0`).
- **Profiles:** `edge` = `solvapay-core/webhook-verify` → exports `wasmVersion` + `verifyWebhook(body, signature, secret, nowUnixSecs: number)`; `browser` = `solvapay-core/browser` → `wasmVersion` only. Exactly one feature required (`compile_error` otherwise).
- **Loaders:** shared `wasm-bindgen --target web` glue; wrappers in `runtime/{node,deno,workerd,web,browser-web,browser-node}.js`. Export order: `deno` / `workerd` / `worker` / `edge-light` / `browser` / `node` before `import`/`default`.
- **Init:** lazy `ready()` Promise cached once; workerd uses `initSync({ module })` from `.wasm` import; Node edge uses `fs.readFileSync` + async `init`.
- **Flag / rollback:** edge reads `SOLVAPAY_IMPL` via guarded `globalThis.process` / `Deno.env` (never `node:process` in the edge graph). unset/`rust` → WASM; `ts` → Web Crypto helper until Step 53.
- **Async public / sync inner:** public `verifyWebhook` stays `Promise<WebhookEvent>`; WASM call is sync after `ready()`.
- **Errors:** JS `Error.code` (snake_case) → `SolvaPayError(message, { code })`; malformed binding JSON → `internal_error`.
- **Symbol audit:** `scripts/check-browser-symbols.mjs` — allowlist `wasmVersion`; deny webhook/API-key names; `cargo tree` excludes transport/reqwest/tokio.
- **Budgets:** `budgets.json` — browser gzip **6531**, cold-start median ~**12.7 ms**; edge diagnostic gzip **34157** / ~**14.2 ms**; `--check` enforces >10% fail; `--record` only for intentional baseline updates.
- **Deno:** `packages/mcp-core/scripts/deno-edge-smoke.mjs` with `--allow-read=packages,rust/bindings/wasm,node_modules` (Deno **2.7.4** in CI).
- **Deferred:** full edge/client wasm-bindgen surface; browser `client-public` API methods; deleting Web Crypto (Step 53); Node napi fixture-clock injection (contract harness still needs `SOLVAPAY_IMPL=ts` for node+edge dual binding).

#### Step 39 decisions for future handoffs

- **Package-bundle format:** immutable CI artifact `server-clean-install-packages` with `manifest.json` (`schemaVersion: 1`, package → `{ tarball, sha256, version }`). Built once in `node-binding-artifacts` after `check-artifacts.mjs` 9/9.
- **Publish-shaped loader:** pack staging rewrites `@solvapay/server-native` `optionalDependencies` from `file:npm/…` to exact version pins matching the binding version — same shape a future `napi prepublish` / release path should emit. Do not keep a test-only manifest transform.
- **Facade call:** consumer imports `@solvapay/server` only and calls sync `verifyWebhook({ body, signature, secret })` with `SOLVAPAY_IMPL=rust` + `NAPI_RS_ENFORCE_VERSION_CHECK=1`. Missing native binding is fatal (proves Step 37 facade→binding path).
- **Native / WASI isolation:** native consumer deps include exactly one platform target tarball and must not install `@solvapay/server-native-wasm32-wasi`; WASI consumer deps include only the WASI target, force `NAPI_RS_FORCE_WASI=error`, and assert zero `.node` files under the temp project. Edge/browser `@solvapay/server-wasm` is a dependency of the facade but is not the webhook path under test.
- **Runner / Node matrix:** 8 native targets × Node 22/24/26 on `ubuntu-24.04` / `ubuntu-24.04-arm` / Alpine-via-Docker musl / `macos-15` / `macos-15-intel` / `windows-latest` / `windows-11-arm`; WASI ×3 on `ubuntu-24.04`. `fail-fast: false`, no `continue-on-error`.
- **Install tool:** always `npm install --ignore-scripts --no-audit --no-fund` (WASI adds `--cpu wasm32 --force`). Never `pnpm`, never `npm ci`, never workspace paths.
- **Shared metadata:** `rust/bindings/node/scripts/targets.mjs` is the single list consumed by artifact check, packer, installer, and (by comment) the CI matrix.
- **Deferred release-pipeline work:** wiring `prepare-clean-install-packages.mjs` (or equivalent) into `publish.yml` / `napi prepublish`; publishing the nine platform packages to npm; converting source `optionalDependencies` from `file:` to registry versions at first publish.
- **Branch-protection interpretation:** workflow is PR-triggered (`pull_request` to `main`/`dev`); required checks on those jobs are the “green on main” gate — do not re-enable duplicate full `push` CI solely for Step 39.

#### Step 37R decisions for future handoffs

- **Binding async surface:** `#[napi] async fn` on `NativeClient` → JS `Promise` on per-addon `tokio_rt`. Every binding method (async client + sync pure-logic) uses a JSON-envelope `String` boundary `{"ok":true,"value":…}` | `{"ok":false,"error":<SdkError JSON>}` (≤1 encode; avoids napi-rs #3022 Promise-rejection pitfall; preserves `PaywallError` gate payload). TS `native.ts` reconstructs frozen error classes byte-identically. **No cancellation surface** — no public `AbortSignal`; dropped Promises do not cancel Rust futures (task runs to completion as today). See redesign §15 note 32.
- **Per-surface `SOLVAPAY_IMPL` rollback:** generalized `packages/server/src/native.ts` (supersedes `webhook-native.ts` pattern): `resolveImpl(surface)` reads `SOLVAPAY_IMPL` per call (`ts` / `rust` / unset→prefer-rust-silent-TS-fallback); each public method becomes `resolveImpl(surface)==='rust' ? <native delegate> : <retained TS body>`. Test seams `setNativeBindingForTests` / `setNativeClientForTests` / `resetNativeCache`.
- **Clean-install smoke extension:** **Resolved (37R-e)** — see Step 37R-e decisions (`buildPaywallGate` + host-native `getCustomer`; WASI sync-only).
- **Sub-step breakdown as confirmed by the patch plan:** five steps kept with three amendments — (A1) 37R-a absorbs async-runtime + error-envelope + client-construction + Group A proof; (A2) JSON-envelope boundary for all surfaces; (A3) server `*Core` route helpers stay TS orchestration (decisions delegated via `@solvapay/core`) and are allowlisted as `host-orchestration-decisions-delegated`. Full scope + done-when in redesign §9 Step 37R / §15 note 32.

#### Step 37R-a decisions for future handoffs

- **Envelope helpers:** `ok_envelope` / `err_envelope` / `internal_error_envelope` in `rust/bindings/node/src/error.rs`; domain errors never throw from async client methods — only panic prep maps to `SdkError::Transport` envelopes. Webhook sync path still throws (`BindingError` → JS `Error.code`).
- **NativeClient:** constructor `(apiKey, apiBaseUrl?)` → `ReqwestTransport` + `ClientShell` + `SolvaPayClient`; ten Group A `#[napi] async fn` methods take/return one JSON string. `updateCustomer` args are `{ customerRef, ...body }` (Rust splits path vs body). Regenerated `index.d.ts` committed.
- **`cargo test -p solvapay-node`:** async/`tokio_rt` pulls N-API symbols that fail to link in standalone test binaries — workspace `rust/.cargo/config.toml` sets `-Wl,-undefined,dynamic_lookup` for apple-darwin (napi-rs#1005). Pure construction tested via `build_solvapay_client` (not the napi `Result` constructor).
- **TS loader:** `packages/server/src/native.ts` owns `resolveImpl` / `loadNativeBinding` / `getNativeClient` / `callNative` + envelope reconstructor (`Api`→`SolvaPayError`, `Paywall`→`PaywallError`+gate as `structuredContent`, `Transport`/`Webhook`→`SolvaPayError`). `webhook-native.ts` is a thin shim. `client.ts` uses **dynamic** `import('./native')` after a Node-only guard so `edge.ts` never statically pulls `node:module`; tsup edge externals include `./native` + `node:module`.
- **No TS re-normalization on rust path:** dispatch returns envelope `value` verbatim (Rust already applies Group A mapping). Fetch-mocked suites that characterize the TS body (`create-customer.unit.test.ts`, `credits-usage` assignCredits) force `SOLVAPAY_IMPL=ts`. Group A rust HTTP byte-parity remains in `client_group_a_fixtures.rs`; server unit rust-flag coverage uses `setNativeClientForTests` (same seam as Step 37 webhook).
- **Gates:** `cargo test -p solvapay-node` green; `test:unit:rust` + `test:unit:ts` 351 each; `node --test` smoke green; next is **37R-b**.

#### Step 37R-b decisions for future handoffs

- **Mechanical extension of 37R-a:** no new HTTP/normalization — reuses `solvapay-transport::SolvaPayClient` Group B/C methods (wire parity already in `client_group_b_fixtures` / `client_group_c_fixtures`).
- **`split_path_refs`:** one Rust helper extracts ordered path keys (`productRef` / `planRef` / `customerRef`) from the combined args JSON and returns the remaining body `Value`; used by `updateCustomer` + product/plan multi-arg methods (replaces one-off `parse_update_customer_args`).
- **Delete void → null envelope:** `deleteProduct` / `deletePlan` return `Result<(), _>` → `ok_envelope(&())` → `{"ok":true,"value":null}`; TS rust path returns that `null` verbatim (TS fallback stays `void`/`undefined`).
- **TS characterization pin:** fetch-mocked suites that assert the retained TS body (`bootstrap-mcp`, `credits-usage`, `client-topup`, `client-error`, `multi-currency-plans`, `create-customer`) force `SOLVAPAY_IMPL=ts` so `test:unit:rust` does not load the real binding for those paths.
- **Gates:** `cargo test -p solvapay-node` green; `test:unit:rust` + `test:unit:ts` 353 each; `node --test` smoke green; step-8 fmt/clippy/no-unwrap/wasm green; next is **37R-c**.

#### Step 37R-c decisions for future handoffs

- **Sync JSON-envelope surface:** `run_envelope_sync` in `error.rs` + top-level `#[napi]` sync fns in `decisions.rs` (siblings of `verifyWebhook`, not throw-style). Args/results are one JSON string; domain failures rarely appear (pure cores return values / null / HelperErrorResult as the envelope **value**); parse/panic → Transport envelope.
- **Delegation site = `@solvapay/server` (Node):** `native-decisions.ts` wraps `@solvapay/core` extracts + paywall/retry. Core TS bodies stay as portable fallback until 38R / Step 52. `*Core` helpers stay orchestration; they import decisions from `native-decisions`.
- **Edge-safe install API:** `native-decisions` never statically imports `./native` / `node:module`. Node `index.ts` + `vitest.setup.ts` call `installNativeDecisionApi({ callNativeSync, resolveImpl })`; edge never installs → always TS fallback. Public `paywall-state` / `paywall-gate` re-export wrappers; pure bodies live in `*-ts.ts`.
- **`withRetry` next_delay-only:** napi `retryNextDelayMs` over `RetryPolicy::next_delay`; host keeps `sleep` / `shouldRetry` / `onRetry` / error coercion. Exhaustion is `null` delay (same as Rust policy).
- **Harness:** `createDefaultRegistry` binds 37R-c surfaces to server wrappers (ambient `SOLVAPAY_IMPL`). Client + webhook bindings force `SOLVAPAY_IMPL=ts` so ambient rust still exercises mocked fetch / `Date.now` clock injection.
- **Gates:** `cargo test -p solvapay-node` (18); `test:unit:rust`/`ts` 359 each; `pnpm test:contract` 1178 both flags; helper/paywall/retry fixtures green under rust; edge-exports free of static `./native`; next is **37R-d**.

#### Step 37R-d decisions for future handoffs

- **Per-package install-gated delegation:** `@solvapay/core` (`native-core.ts`) and `@solvapay/mcp-core` (`native-mcp.ts`) own their own `installNative*Api({ callNativeSync, resolveImpl })` so package exports delegate without a static `node:module` / `@solvapay/server-native` import — required for React/browser and Deno/edge graphs, and for the eventual 37R-e `node-binding-delegation` grep gate.
- **Who installs:** Node `@solvapay/server` `index.ts` installs core + `McpAdapter.formatGate` native, and **publishes** `Symbol.for('solvapay.nativeSyncApi')` so `@solvapay/mcp-core` can pick up napi dispatch without a hard server→mcp-core import (avoids the production cycle and the `createRequire` CJS/ESM dual-instance trap). `@solvapay/mcp` Node entry also calls `installNativeMcpApi` via `native-install.ts`. Fixture harness + package vitest setups install explicitly. mcp-core remains a server **devDependency** for vitest.
- **Const tables stay TS identity:** `BUSINESS_COUNTRY_OPTIONS`, `SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE`, `MCP_TOOL_NAMES`, `TOOL_FOR_VIEW` / `VIEW_FOR_TOOL` keep `as const` / Record exports for types; fixture-visible accessors (`getBusinessCountryOptions`, `getSellerTaxIdentifierDisplayLabelByType`, `getMcpToolNamesTable`, `mcpViewMaps`) are the delegated surfaces.
- **Dual-binding `paywallToolResult`:** mcp-core async wrapper + server `McpAdapter.formatGate` share the same napi fn; formatGate uses an install callback (no static `./native` import) so factory→edge stays free of `node:module`.
- **React unmodified:** `@solvapay/core/business-details` still re-exports pure TS bodies; React never calls `installNativeCoreApi` → always TS fallback.
- **Assert / Error name parity:** `assertResponseResult` rust Transport errors are rethrown as plain `Error` in the TS wrapper so fixtures expecting `name: "Error"` stay green.
- **Gates:** `cargo test -p solvapay-node` (22); server `test:unit:rust`/`ts` 359 each; core 114/114; mcp-core 107/107; `pnpm test:contract` 1178 both flags; React 1083 unmodified; next is **37R-e**.
- **Open handoff:** clean-install smoke extension beyond `verifyWebhook` — **Resolved (37R-e)**.

#### Step 37R-e decisions for future handoffs

- **Delegation gate design:** enumerate value exports of `@solvapay/server` + `@solvapay/core` via TS compiler API; follow re-export chains to the definition file only (never scan package `index.ts` alone — install wiring false-positives); require marker or allowlist. Allowlist reasons: `section-8-exclusion`, `host-orchestration-decisions-delegated`, `type-guard-or-const`, `binding-infra`, `portable-ts-fallback`. Root script `pnpm delegation:check`; CI job `node-binding-delegation`.
- **Extended clean-install call list:** `verifyWebhook` + sync `buildPaywallGate` (payment-minimal golden) + async `getCustomer` via in-process `node:http` stub (`client-smoke-fixture.mjs`). Host-native exercises all three; WASI exercises sync only.
- **WASI omits NativeClient:** `native_client.rs` is `#![cfg(not(target_arch = "wasm32"))]` — no `ReqwestTransport` on wasm32. Sync decision / payload / webhook surfaces remain on WASI. Documented as intentional until a WASI transport lands.
- **Shadow TS pin:** `installTsDriverSession` forces `SOLVAPAY_IMPL=ts` for the session (restored on teardown) so fetch-based wire capture still works after 37R client cutover; rust driver stays on the Rust CLI.
- **Both-flags CI:** `node-binding-conformance` runs server + core + mcp-core `test:unit:rust|ts`, `pnpm test:contract` both flags, and React unmodified.
- **Gates:** `pnpm delegation:check` OK; server 359×2; core 114×2; mcp-core 107×2; contract 1181×2; React 1083; clean-install native+WASI `CLEAN_INSTALL_OK`; `pnpm shadow:selftest` 19/19; next is **Step 39 CI matrix**.

#### Step 38R decisions for future handoffs

- **Edge transport client is `Rc`, not `Arc`:** `build_solvapay_client` returns `Rc<SolvaPayClient>` — the fetch-backed client is `!Send`/`!Sync` on wasm32 (single-threaded event loop), and `Arc<!Send+!Sync>` trips `clippy::arc_with_non_send_sync`. `WasmClient` is `#![cfg(all(feature = "edge", target_arch = "wasm32"))]` (no `ReqwestTransport` / no native target), mirroring 37R-e's WASI-omits-NativeClient split.
- **One JSON-envelope boundary, shared with napi:** every `WasmClient` async method + every sync `decisions.rs` / `payload_builders.rs` fn takes one JSON-args string and returns one envelope string (`{"ok":true,"value":…}` | `{"ok":false,"error":<SdkError JSON>}`). `wasm.ts` reconstructs `SolvaPayError` / `PaywallError` byte-identically (same reconstructor shape as `native.ts`). `run_envelope_sync` maps `Result` directly (no `catch_unwind` — wasm32 is `panic=abort`).
- **`error.rs` webhook-throw path is `edge`-gated:** `BindingError` + `js_sys` imports moved from `#[cfg(feature = "webhook-verify")]` to `#[cfg(feature = "edge")]` (the wasm crate has no `webhook-verify` feature of its own; `edge` drives it). async `run_envelope` is `#[cfg(all(feature = "edge", target_arch = "wasm32"))]` (only `WasmClient` calls it).
- **`wasm.ts` supersedes `webhook-wasm.ts`:** generalized adapter owns `loadWasmBinding` (async `ready()`), `ensureWasmReadySync` (Node edge `readFileSync`+`initSync`; workerd/Deno `initSync`; generic edge-light throws → warm via `ready()`), `getWasmClient`, `callWasm`, `callWasmSync`, `resolveEdgeImpl(surface)`, test seams (`setWasmClientForTests` / `setWasmBindingForTests` / `resetWasmCache` / `isWasmClientOverrideActive`), and `publishWasmSyncApi` / `warmWasm`. `webhook-wasm.ts` is a thin re-export shim.
- **Runtime split in `client.ts`:** `dispatchClient` does `await import('./wasm')` then routes edge (`!isNodeRuntime()` or a test WASM-client override) → `callWasm`, Node → `await import('./native')` → `callNative`. Both bundles keep both dynamic specifiers guarded; tsup edge build externalizes `./native` + `./webhook-native` + `node:module` so the edge graph never statically pulls napi. Unit tests force the edge path under Node via `setWasmClientForTests` + `SOLVAPAY_IMPL=rust`.
- **Install-is-the-gate (edge-safe):** removed the `process.versions.node` check from `native-decisions` / `native-core` / `native-mcp` `dispatchSync`; they now gate purely on install + `resolveImpl(surface)==='rust'`. `edge.ts` installs decision/core/MCP WASM dispatch (via `callWasmSync` + `resolveEdgeImpl`), publishes `Symbol.for('solvapay.nativeSyncApi')` for mcp-core (Deno resolves it to the edge graph), and fires `warmWasm()` so first sync use can `initSync`.
- **Browser profile = public-safe pure logic only:** `payload_builders.rs` splits a public-safe subset (business-details / credit-display / seller-identity) compiled under **both** profiles from an `edge`-only MCP subset, so the browser bundle never ships secret-adjacent MCP symbols. `browser-web.js` enumerates exports explicitly (not `export *`) for the symbol audit. Opt-in warm-up lives in `@solvapay/core/browser-wasm` (`warmBrowserCoreWasm`) — NOT imported by the core main entry, so React defaults to TS; eager main-thread cost is ~1.8 KB (the `browser-wasm.js` glue), the ~63 KB WASM is fetched only when an app opts in.
- **Delegation gate + budgets:** `DELEGATION_MARKERS` gains `callWasm` / `callWasmSync` / `verifyWebhookWasm` (superset — most shared definition files still carry `dispatchClient` / `dispatchSync` that fan out to both bindings). `budgets.json` re-recorded with rationale notes: browser gzip 6531→63633 (public-safe data + serde), edge diagnostic 34157→298838 (full transport client + all sync envelopes); both lazy/opt-in, off any main-thread critical path.
- **Workers edge detect:** `isNodeRuntime()` must treat Cloudflare Workers (`navigator.userAgent === 'Cloudflare-Workers'`) and Vercel `EdgeRuntime` as edge even under `nodejs_compat` (which exposes `process.versions.node`). Shared `client.ts` builds the napi specifier as a non-literal (`['./','native'].join('')`) so wrangler/esbuild rebundling of `edge.js` cannot statically pull `./native`.
- **Workerd smoke fixture:** `rust/bindings/wasm/scripts/workerd-edge-smoke/` — `wrangler dev --local` worker importing built `edge.js`; exercises `verifyWebhook` + sync `buildPaywallGate`/`paywallErrorToClientPayload` (`initSync`) + `validateBusinessDetails` + async `getMerchant` (stub fetch). Run both `SOLVAPAY_IMPL=rust` and `ts`.
- **Gates:** server `test:unit:rust`/`ts` 366 each; mcp-core 108×2; core 117 (incl. `warmBrowserCoreWasm` TS↔WASM flip); React 1083 unmodified; `pnpm delegation:check` OK; `check-browser-symbols.mjs` + `measure-wasm.mjs --check` OK; Deno edge smoke green (async webhook + `classifyPaywallState`/`buildPaywallGate` sync dispatch + ambient `getMcpToolNamesTable`); workerd smoke green; clean-install orchestrator unit 10/10; next is **Step 39 CI matrix**.

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** … (complete after Step 39 CI matrix is green — Steps 37R + 38R already done: napi scaffold + Node webhook cutover + full-surface napi delegation + full-surface edge WASM cutover + clean-install harness + conformance gates)
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §7.7, §7.8, §9, §10.3, D9, Notes 28–37; diagrams updated: Phase 6 `EXP → SMOKE` (unchanged)

### Phase 6G — Binding-glue generator — In progress

<!-- running per-step bullets accumulate here as each step lands -->
- Step 39G-a (Binding-boundary IR + manifest `bindings:`): ✅ Zod `bindings:` (102 symbols) + `BindingDef` / `Ir.binding_symbols` / `lower_bindings.rs`; bidirectional `assertBindingReconciliation` (catalog linkers + shim `js_name` inventory − infra allowlist + unique cores); `dto-gen --dump-bindings` → `contract/manifest/binding-symbols.snapshot.json` + CI drift; host-injected (`hostInjected`) + `splitPathRefs` shape closed (§15 note 40) — "done when" verified: `pnpm manifest:check`, `cargo test -p dto-gen`, snapshot idempotent, no `rust/bindings/**` changes
- Step 39G-b (Rust shim emitters napi + wasm + retrofit proof): ✅ `emit_bindings_rs.rs` + enriched `bindings:` emit fields (`artifact`/`emitOrder`/`section`/`doc`/`extract`/`call`/`verbatimBody`/`dtoType`/…); shared `Toolchain` body-emitter; chrome assets in `binding-emit.snapshot.json`; regenerate eight shims with `@generated` header only delta; golden test proves body byte-identity; CI regen-drift + `@generated` gate cover shims (§15 note 41) — "done when" verified: header-only `git diff` on shims, `cargo test -p dto-gen` + `solvapay-node` green, both-flag suites unmodified
- Step 39G-c (Native-side marshalling emitters TS): ✅ `emit_bindings_ts.rs` + `native-ts-emit.snapshot.json` chrome; IR-derived `*ClientMethod` / `*SyncMethod` unions (`decisions` then `payloadBuilders`, MCP group comments); `--native-ts-out` / `--wasm-ts-out`; regenerate two files with `@generated` header only delta; golden `native_ts_golden.rs`; CI regen-drift + `@generated` gate cover both paths; six credit-display/seller-identity `emitOrder` values aligned to TS union order (§15 note 42) — "done when" verified: header-only `git diff` on `native.ts`/`wasm.ts`, `cargo test -p dto-gen` + both-flag server/core/mcp-core green, `pnpm delegation:check` OK

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** §5.7 binding-glue pipeline end-to-end — IR `bindings:` (39G-a) → Rust napi/wasm shim emitters (39G-b) → TS `native.ts`/`wasm.ts` marshalling emitters (39G-c), each proven byte-identical below `@generated` against the hand-written 37R/38R cutover. Forward-applied immediately to Python (Phase 7) and Ruby (Phase 8).
- **Why:** Stop hand-mirroring every new core fn across toolchains; add-a-symbol is a manifest edit + regen.
- **Decisions to document:** D16 JSON-envelope universal ABI + generated glue; D17 manifest `bindings:` descriptor reconciled with catalog; §10.3 gates for regen drift/idempotence/hand-edit, catalog reconciliation, retrofit byte-identical; host-injected/`splitPathRefs` declaration shape closed at 39G-a; proc-macro auto-derive deferred. Deviations: six `payloadBuilders` `emitOrder` values reordered to match public TS union order (mechanical). Deferred: none material for 6G itself.
- **Pointers:** §5.7, Phase 6G, §12 D16–D17, §13 binding-boundary gates, §15 notes 39–42; diagrams updated: §5.2 (`GEN → GLUE` branch)

### Phase 7 — Python — Done

<!-- running per-step bullets accumulate here as each step lands -->
- Step 40 (Scaffold PyO3/maturin): `rust/bindings/python` + maturin `solvapay` abi3-py39; tokio via `pyo3-async-runtimes`; hello-world sync webhook + async/blocking `get_merchant`; §5.7 Python column emits allowlisted `client.rs`; CI wheel matrix + artifact gate — "done when" verified: unit + pytest smoke + golden + local abi3 wheel import (§15 note 43)
- Step 41 (Generate the Python facade + binding glue): full Groups A–C client (async + blocking) + sync decisions/payload builders; generated `_native.py`; idiomatic `create_solvapay`/`payable`/`gate`; signature-parity suite; CI regen-drift (§15 note 44)
- Step 42 (Live contract tests + publish): offline golden-fixture replay suite under `tests/contract/` (stub HTTP backend + `_verify_webhook_at` + host adapters); 36-op coverage guard; `scripts/live_contract.py` + `.github/workflows/shadow-python.yml` (dispatch-only); `.github/workflows/publish-python.yml` (maturin matrix + check-wheels + TestPyPI default / gated PyPI OIDC); §7.7 version stamp + load-time skew guard — "done when" verified: `pytest -q` 596 green in fresh venv incl. 535 fixtures; wheel install clean locally (§15 note 45)
- **Retrofit:** Step **42T Done** — strict typing (`.pyi` + `py.typed`, `mypy --strict` + `pyright` + `ruff`) and docstring coverage from the shared IR doc model (reuses 18T infra). Remaining Phase 7 cross-cut: runnable example under `examples/python/` (Step 42 deliverable / D20) — tracked separately; not reopening Steps 40–42.

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** Full PyO3/maturin Python surface (Steps 40–41) plus Step 42 offline contract conformance + release-train PyPI wiring. Offline suite is the green CI gate; live backend runs stay `workflow_dispatch` (same posture as TS shadow).
- **Why:** Close Phase 7 with a third fixture consumer (TS + Rust fixture-runner + Python) and a publish path that stamps release-train version + core SHA without folding into the npm Changesets workflow.
- **Decisions to document:** (1) Live Python contract mirrors shadow — offline fixtures in CI; hosted env still open. (2) PyPI publish is a separate OIDC workflow; TestPyPI is the default dry-run. (3) Facade↔native version mismatch is a load-time `SolvaPayError` (`code=version_skew`). (4) Test-only exports `_verify_webhook_at`, `SolvaPayClient._for_fixtures`, `_resolve_authenticated_user`, `_construct_sdk_error` stay off the idiomatic facade. New §10.3 / §13 rows for the Python contract suite + PyPI Trusted Publishing.
- **Pointers:** §7.7, Phase 7, §10.3 Python contract suite, §13 PyPI OIDC gate, §15 note 45; diagrams unchanged (no new GEN branch).

### Phase 8 — Ruby — Closed

<!-- running per-step bullets accumulate here as each step lands -->
- Step 43 (Scaffold Magnus/rb-sys): `rust/bindings/ruby` gem (`solvapay`, Ruby ≥3.0) + Magnus cdylib crate named `solvapay` (rb-sys ExtensionTask artifact); binding-owned tokio + GVL release (`without_gvl`); hello-world sync webhook + `get_merchant`; `Toolchain::Ruby` + `--ruby-bindings-out`; CI `ruby-binding` native-host matrix + `check-gems.rb` — "done when" verified: unit + smoke + golden (§15 note 46). rb-sys-dock cross-compile deferred (dock images ship Ruby 4.0 / incomplete 3.3 toolchains vs Magnus 0.7).
- Step 44 (Generate the Ruby facade + binding glue): full Groups A–C sync client (36 methods, all GVL-releasing) + decisions (42) + payload builders (23); generated `_native.rb` / public `client.rb` / `helpers.generated.rb` / `sig/solvapay.rbs` / signature-parity suite; idiomatic `SolvaPay.create` / `payable` / `gate` with true Mutex/ConditionVariable customer single-flight (60s success cache) + 10s limits cache; offline `test/contract/` replay through a TCP stub (535 fixtures + 36-operation success/error guard); CI regen-drift covers all Ruby generated paths; `cargo test -p dto-gen`, `cargo test -p solvapay --lib`, `cargo clippy -p dto-gen -p solvapay --all-targets -- -D warnings`, `bundle exec rake test`, and `bundle exec rbs validate` green (§15 note 47)
- Step 45 (Live contract tests + publish): load-time facade↔native skew guard (`SolvaPay._check_version_skew`); stdlib `scripts/live_contract.rb` (requirable `SolvaPay::LiveContract` pure helpers + guarded `main`); `.github/workflows/shadow-ruby.yml` (dispatch-only); `.github/workflows/publish-ruby.yml` (native-host platform matrix + source gem, `check-gems.rb`, dry-run local `gem install` default, OIDC `gem push` gated by `publish_to_rubygems` / `solvapay-ruby-v*` tag); §7.7 `version.rb` + `SOLVAPAY_RELEASE_VERSION`/`SOLVAPAY_CORE_SHA` stamping. rb-sys-dock cross-compile remains deferred (§15 note 48).
- **Retrofit:** Step **45T Done** — strict typing (`steep==2.0.0 check` + `rubocop==1.88.2` against generated RBS/facade; no Sorbet) and YARD coverage from the shared IR doc model (reuses 18T infra / `doc_render`). Remaining Phase 8 cross-cut: runnable example under `examples/ruby/` (Step 45 deliverable / D20) — tracked separately; not reopening Steps 43–45.

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** Steps 43–45 delivered the Magnus/rb-sys gem scaffold, full §5.7 generated facade + offline contract suite, then live contract driver + RubyGems publish train (OIDC Trusted Publishing, dry-run default).
- **Why:** Close Phase 8 so Ruby matches Python/TS reliability posture (offline golden CI gate + dispatch-only live shadow + release-train publish with version stamp + skew guard) before the Rust facade crate (Step 46).
- **Decisions to document:** gem + crate name `solvapay`; native-host `rake native gem` CI until `rbsys 0.9.128` / Magnus 0.7 dock images align; live driver uses public keyword `Client` (no `_blocking` twins); RubyGems dry-run = build + `check-gems.rb` + local `gem install` (no TestPyPI equivalent); real push gated; deferred: rb-sys-dock cross-compile.
- **Pointers:** §7.7, Phase 8, §10.3 Ruby contract/RubyGems rows, §15 notes 46–48; diagrams unchanged

### Phase 9 — Rust public crate — Closed

<!-- running per-step bullets accumulate here as each step lands -->
- Step 46 (Scaffold `solvapay` facade crate): `rust/crates/solvapay` — curated re-exports, `Config` / `Client::new` / `Client::with_transport`, `get_merchant` delegation, §2.4 `gate` / `payable` / `Allow::track_*` (core-owned decisions + host limits/customer cache), optional `blocking` feature (native-only `blocking::BlockingClient`); `tests/hello_world.rs` mock round-trip; CI `cargo build/test -p solvapay --features blocking`; Ruby workspace crate renamed `solvapay-ruby` (`[lib] name = "solvapay"`) so the public facade owns package name `solvapay`; path-only `publish = false` until Step 48 crates.io graph (§15 note 49).
- Step 47 (Generate Rust facade signatures + signature-parity suite): `emit_client_rs` / `emit_parity_suite_rs` emit all 36 catalogued client ops as async `Client` methods + `blocking::BlockingClient` twins with rustdoc from `render_entry_doc_lines`; committed `client_generated.rs` / `blocking_generated.rs` / `tests/signature_parity_generated.rs`; Phase 0 client fixtures replay through facade `Client` (`tests/fixture_conformance.rs`); hand-written `get_merchant` removed; CI regen-drift + `@generated` + `cargo doc -p solvapay --no-deps`.
- Step 48 (crates.io publish + docs.rs + live contract): flipped `solvapay-dto` → `solvapay-core` → `solvapay-transport` → `solvapay` to `publish = true` with `version` + `path` deps + shared workspace package metadata; `rust/tools/live-contract` (pure helpers + env-gated bin) + `shadow-rust.yml` (dispatch-only); `publish-rust.yml` (stamp version/core SHA, dry-run default, gated OIDC Trusted Publishing publish in dep order); tested `examples/rust/get-merchant` (`run(...)` + mock transport); CI packageability graph check + `cargo publish -p solvapay-dto --dry-run`, docs.rs `RUSTDOCFLAGS=--cfg docsrs` doc build, example build+test (§15 note 53).
- **Cross-cutting deliverables (redesign §5.6/§9/D19–D20):** generated `pub` signatures carry rustdoc doc comments from the shared IR doc model (renders on docs.rs) ✅ Step 47; runnable, tested example under `examples/rust/` ✅ Step 48. (Rust is statically typed, so no dynamic-language strictness gate applies.)

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** Steps 46–48 delivered the public `solvapay` facade crate (async + optional blocking), generated 36-op surface + signature-parity + offline fixture conformance, then crates.io publish train + docs.rs cfg gate + live contract driver + tested `examples/rust/get-merchant`.
- **Why:** Close Phase 9 so Rust matches Python/Ruby reliability posture (offline golden CI gate + dispatch-only live shadow + release-train publish with version stamp) before Go wazero (Step 49).
- **Decisions to document:** publish all four crates (dto/core/transport/facade) with version+path deps — no skew guard (single compiled crate); crates.io dry-run default; real publish gated by `publish_to_crates_io` / `solvapay-rust-v*` + Trusted Publishing OIDC (`rust-lang/crates-io-auth-action`); leaf `solvapay-dto` dry-run verifies in CI before first index upload; dependents resolve from crates.io after first publish. Deferred: maintainer name reservation + Trusted Publisher registration; hosted contract env for non-dispatch live CI.
- **Pointers:** §7.7, Phase 9, §10.3 Rust example / crates.io rows, §15 notes 49/53; diagrams unchanged

### Phase 10 — Go (wazero + embedded WASM) — Not started

<!-- running per-step bullets accumulate here as each step lands -->
- **Cross-cutting deliverables (redesign §5.6/§9/D19–D20):** generated Go signatures carry godoc doc comments from the shared IR doc model; Step 51 ships a runnable, tested example under `examples/go/`. (Go is statically typed, so no dynamic-language strictness gate applies.)

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

### MCP-authoring adapters — per-language — Not started

Post-cutover future track (redesign §9, "MCP-authoring adapters"): layer-3 hand-written `registerPayable` / `ctx.respond` adapters over each language's own MCP SDK, on top of the shared layer-2 Rust decision core. Not part of steps 1–55.

<!-- running per-step bullets accumulate here as each step lands -->
- Step MA-0 (<title>): <one-line what/why> — PR #___, "done when" verified: <how>

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

### Strict typing & doc comments — retrofit — Closed (TS/Python/Ruby)

Cross-cutting track for the two requirements that landed in the redesign as spec/decisions/gates (redesign §5.6, D18/D19, §10.3) after the TS/Python/Ruby surfaces already shipped: dynamic-language strict typing on the generated surface (D18) and language-native doc comments on every generated signature from one shared IR doc model (D19). Lettered step ids keep steps 1–55 intact (same convention as `37R` / `6G`); each retrofit step sits inline at the end of its own phase and does **not** reopen the numbered steps. Forward surfaces (Rust/Go) carry doc comments as inline amendments to Steps 47/50 — see Phase 9/10.

<!-- running per-step bullets accumulate here as each step lands -->
- Step 18T (Doc-comment generation — shared infra + TS): landed shared IR doc model + coverage checker/CI gate in `dto-gen`; authored manifest `docs:` for every catalogued entry point; emit TSDoc on `client.generated.d.ts` — "done when" verified: coverage gate green; regen idempotence + committed-output drift + `@generated` header gate hold; `pnpm test:types` green; §15 note 50 (manifest `docs:` as authored source)
- Step 42T (Python strict typing + doc comments): ✅ landed `emit_pyi_py` → `__init__.pyi` (JSON-string boundary, async/`_blocking` twins, IR docstrings) + `py.typed`; hardened `facade.pyi` (`ApiClient` Protocol, `ParamSpec` `payable`, no `Any`); pinned `mypy==1.17.1` / `pyright==1.1.411` / `ruff==0.12.4` in `python-binding` smoke against public stubs; CI regen-drift + `@generated` cover `__init__.pyi` — "done when" verified: type-strictness + doc-comment coverage gates green; §15 note 51
- Step 45T (Ruby strict typing + doc comments): ✅ landed YARD via `render_yard` on generated `client.rb` / `helpers.generated.rb`; extended `emit_rbs_rb` (`NativeDispatch` + facade internals + binding-arg helper params); pinned `steep==2.0.0` / `rubocop==1.88.2` / `rbs==4.0.3` in `ruby-binding` full leg; `ruby_doc_coverage` green — "done when" verified: type-strictness + doc-comment coverage gates green; §15 note 52. (Note: 18T shared infra was already landed when 45T started — map previously understated that.)
- Forward (not retrofits): Rust rustdoc via Step 47 and Go godoc via Step 50, both reusing the Step 18T shared doc model (no strictness gate — statically typed).

**Phase-close handoff** (TS/Python/Ruby columns closed; Rust/Go forward):
- **What was done (18T):** Shared `IrDocModel` + `check_doc_coverage` + CI gate in `dto-gen`; manifest `docs:` authored for all catalogued entry points; TSDoc on `client.generated.d.ts`; manual verification green (idempotence, coverage bite, hand-edit/`@generated` bite, TS language-service hover, `test:types`).
- **What was done (42T):** Python emitter column + D18 strictness gate — generated `__init__.pyi` + `py.typed`; facade stubs hardened (no public `Any`); `mypy`/`pyright`/`ruff` pinned and CI-gated; IR docstrings on every catalogued operation twin.
- **What was done (45T):** Ruby emitter column + D18 strictness gate — YARD on generated client/helpers; generated RBS expanded for steep; `steep`/`rubocop`/`rbs` pinned and CI-gated; hand-authored YARD on idiomatic facade helpers.
- **Why:** D18/D19 — strictest static contract for dynamic-language consumers; shared IR docs so LSP hover matches across TS/Python/Ruby.
- **Decisions to document:** Manifest `docs:` as authored source — §15 note 50; Python JSON-string boundary — §15 note 51; Ruby no Sorbet + steep 2 / rbs 4 / YARD `@return` mapping — §15 note 52; pinned toolchain versions in §13. Forward: rustdoc (47), godoc (50).
- **Pointers:** §12 D18/D19, §5.6, §10.3; §15 notes 50–52; migration map rows 18T/42T/45T.

## Open handoff items index

Mirrors redesign §13 "Unresolved implementation gates", plus blockers discovered mid-migration.

| Gate | Resolve by | Status | Owner |
| --- | --- | --- | --- |
| Exact WASM size / cold-start numeric budgets | Step 38 baseline; re-recorded step 38R | **Resolved (step 38; re-recorded 38R):** `rust/bindings/wasm/budgets.json` — after the full-surface cutover browser gzip **63633 B** / cold ~13.3 ms (public-safe subset + serde) and edge diagnostic **298838 B** / ~16.4 ms (full transport client + all sync envelopes); both lazy/opt-in with rationale notes; >10% needs approval | SDK |
| Final npm optional-dependency layout + package names for prebuilds | Steps 36–37 | **Resolved (step 37):** `@solvapay/server-native` + per-target `@solvapay/server-native-<platform>` + `-wasm32-wasi`; `@solvapay/server` optionalDependency `workspace:*` on `@solvapay/server-native` | SDK |
| Python package name on PyPI (`solvapay` vs scoped) and minimum CPython (abi3 floor) | Steps 40–42 | **Resolved (step 40):** `solvapay` + `abi3-py39` | SDK |
| Ruby gem name + versioning scheme; source-gem toolchain floor | Steps 43–45 | **Resolved (step 43/45):** gem + crate name `solvapay`; Ruby ≥3.0; release-train via `SOLVAPAY_RELEASE_VERSION` / `SOLVAPAY_CORE_SHA` (`version` / `native_build_info`); load-time skew guard in `lib/solvapay.rb` | SDK |
| rb-sys-dock cross-compile vs native-host gem builds | Step 45 | **Open (deferred):** current `rbsys/*:0.9.128` images expose Ruby 4.0 host + incomplete 3.3 toolchains; Magnus 0.7 fails inside dock. CI/publish build platform gems on native runners (`rake native gem`); revisit dock when images/Magnus align | SDK |
| Go module path naming (`github.com/solvapay/solvapay-go` vs vanity import) | Steps 49–51 | Open | SDK |
| Whether the Go WASM artifact is committed in-repo or attached to release tags | Before step 49 cutover | Open | SDK |
| WASM instance-pool sizing strategy for Go | Step 49 | Open | SDK |
| crates.io name reservation for `solvapay` (and whether internal crates are published) | Before step 46 / Step 48 | **Resolved (step 48):** publish all four crates (`solvapay-dto` → `solvapay-core` → `solvapay-transport` → `solvapay`) with `version` + `path` deps; no skew guard. Maintainer must still reserve the four names on crates.io before the first real publish | SDK |
| Whether the shared tokio runtime in napi-rs is per-addon or per-process | Step 36 | **Resolved (step 36):** per-addon via napi `tokio_rt` (see Step 36 decisions / §15 note 28) | SDK |
| 37R binding async surface (Promise conversion, error mapping, cancellation for napi async methods) | Step 37R patch plan / 37R-a | **Resolved (37R patch plan):** JSON-envelope + Promise via `tokio_rt`; no cancellation (see Step 37R decisions / §15 note 32) | SDK |
| 37R per-surface `SOLVAPAY_IMPL` rollback semantics (independent flag reads per cut-over surface) | Step 37R patch plan / 37R-a | **Resolved (37R patch plan):** per-call `resolveImpl(surface)` in `native.ts` (see Step 37R decisions / §15 note 32) | SDK |
| 37R clean-install smoke extension beyond `verifyWebhook` | Step 37R-e | **Resolved (37R-e):** `buildPaywallGate` + host-native `getCustomer` stub; WASI sync-only (see Step 37R-e decisions / §15 note 37) | SDK |
| Process-payment OpenAPI discriminator fix — backend republish vs manifest overlay | Before step 15 cutover | Open | Backend + SDK |
| `includeCheckoutSession` OpenAPI republish | Before step 15 cutover | Open | Backend + SDK |
| Free-threaded CPython: `gil_used = false` from day one, or after an audit? | Step 40 | **Resolved (step 40):** default thread-safe module; no `gil_used` opt-out (§15 note 43) | SDK |
| Fuzz corpus seed strategy | Step 55 | Open | SDK |
| Whether UniFFI is ever used for a *sixth* language later | Only if needed | Open | SDK |
| Binding-boundary descriptor shape for host-injected args (`nowMs`/clock/RNG) + path-ref splits | Step 39G-a | **Resolved (39G-a):** `hostInjected: bool` on args + ordered `splitPathRefs: string[]` on the symbol (§15 note 40) | SDK |
| Whether a later proc-macro auto-derives binding-boundary descriptors from Rust core signatures | Deferred (post-Phase 6G) | Open | SDK |
| Backend CI-published OpenAPI artifact for automated snapshot drift | Post–Step 1 / ongoing | Open | Backend |
| Hosted contract-test environment for CI shadow live runs | Post–step 25 | Open — TS `shadow.yml` + Python `shadow-python.yml` + Ruby `shadow-ruby.yml` + Rust `shadow-rust.yml` are `workflow_dispatch`-only until a shared sandbox/contract env + secrets exist; offline golden fixtures (TS + Python Step 42 + Ruby Step 44 + Rust Step 47) remain the green CI gate | Backend + SDK |
| RubyGems publish workflow + Trusted Publishing / API key env | Step 45 | **Resolved (step 45):** `.github/workflows/publish-ruby.yml` — native-host platform matrix + source gem + `check-gems.rb` + OIDC (`rubygems/configure-rubygems-credentials`); dry-run default = local `gem install`; real `gem push` gated by `publish_to_rubygems=true` / `solvapay-ruby-v*` tag. Maintainer must still register the Trusted Publisher on RubyGems.org once. | SDK |
| crates.io publish workflow + Trusted Publishing / API key env | Step 48 | **Resolved (step 48):** `.github/workflows/publish-rust.yml` — stamps release-train version + core SHA, dry-run default (`cargo publish --dry-run` + graph check), real publish via OIDC (`rust-lang/crates-io-auth-action`) gated by `publish_to_crates_io=true` / `solvapay-rust-v*` tag (topo order dto→core→transport→facade). Maintainer must still reserve names + register Trusted Publishers on crates.io once. | SDK |
| MCP-authoring parity scope + `solvapay-mcp-<lang>` package naming | Before the MCP-authoring track | Open | SDK |
| Dynamic-language type-strictness gate + pinned toolchain (redesign §5.6, D18) | Owned by Steps 42T (Python) / 45T (Ruby) | **Resolved (42T + 45T):** Python `mypy==1.17.1 --strict` + `pyright==1.1.411` + `ruff==0.12.4` (§15 note 51); Ruby `steep==2.0.0` + `rubocop==1.88.2` (+ `rbs==4.0.3`) against generated RBS/facade (§15 note 52). No Sorbet. | SDK |
| Doc-comment coverage on generated signatures (redesign §5.6/§5.1, D19) | Owned by Steps 42T/45T (+ Step 18T for TS + shared infra, Step 47 Rust, Step 50 Go) | **Partial (18T + 42T + 45T + 47 Done for TS/Python/Ruby/Rust):** shared IR + TSDoc (18T); Python docstrings (42T, §15 note 51); Ruby YARD (45T, §15 note 52); Rust rustdoc on generated facade (47). Still open: Go in Step 50 | SDK |
| Per-language examples workstream + `examples/ → examples/typescript/` relocation (redesign §9 "Examples", D20) | Steps 42/45/48/51 (per-language example); relocation PR before/with them | **Partial (Rust ✅ Step 48):** `examples/rust/get-merchant` runnable + mock-transport tested + CI build+test. Still open: Python/Ruby/Go examples + relocate current examples under `examples/typescript/` | SDK |

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
