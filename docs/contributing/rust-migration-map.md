# Rust Core SDK migration map

Living **state / progress / handoff** layer for the Rust core SDK redesign. Companion to the architecture/spec doc:

- **Spec / architecture:** [`rust-core-sdk-redesign-v2.md`](./rust-core-sdk-redesign-v2.md) — what to build and why
- **This map:** where each of the 55 steps stands, and what each phase handed off

Session workflow (redesign §14): pick the next incomplete step in redesign §9 → implement only that step → prove its "done when" → update **this map** (status + handoff bullets). At each phase close, finalize that phase's handoff entry before opening the next phase's first PR.

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
| 2 | SDK contract manifest | Phase 0 | Not started | — | — | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 3 | Fixture harness | Phase 0 | Not started | — | — | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 4 | Webhook-signature fixtures | Phase 0 | Not started | — | — | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 5 | Retry-schedule fixtures | Phase 0 | Not started | — | — | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 6 | Paywall fixtures | Phase 0 | Not started | — | — | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 7 | Client request/response fixtures | Phase 0 | Not started | — | — | [Phase 0](#phase-0--contract-freeze-and-golden-fixtures) |
| 8 | Scaffold cargo workspace | Phase 1 | Not started | — | — | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 9 | Business details | Phase 1 | Not started | — | — | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 10 | Credit display + seller identity | Phase 1 | Not started | — | — | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 11 | Retry policy engine | Phase 1 | Not started | — | — | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 12 | Webhook verification | Phase 1 | Not started | — | — | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 13 | Paywall state | Phase 1 | Not started | — | — | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 14 | Paywall gate | Phase 1 | Not started | — | — | [Phase 1](#phase-1--pure-dependency-free-logic) |
| 15 | Rust DTO generator | Phase 2 | Not started | — | — | [Phase 2](#phase-2--generated-dtos-and-error-model) |
| 16 | SDK-only overlays | Phase 2 | Not started | — | — | [Phase 2](#phase-2--generated-dtos-and-error-model) |
| 17 | Error model | Phase 2 | Not started | — | — | [Phase 2](#phase-2--generated-dtos-and-error-model) |
| 18 | TS declarations + parity check | Phase 2 | Not started | — | — | [Phase 2](#phase-2--generated-dtos-and-error-model) |
| 19 | Native transport | Phase 3 | Not started | — | — | [Phase 3](#phase-3--http-client-core) |
| 20 | WASM Fetch transport | Phase 3 | Not started | — | — | [Phase 3](#phase-3--http-client-core) |
| 21 | Client shell | Phase 3 | Not started | — | — | [Phase 3](#phase-3--http-client-core) |
| 22 | Client methods, group A | Phase 3 | Not started | — | — | [Phase 3](#phase-3--http-client-core) |
| 23 | Client methods, group B | Phase 3 | Not started | — | — | [Phase 3](#phase-3--http-client-core) |
| 24 | Client methods, group C | Phase 3 | Not started | — | — | [Phase 3](#phase-3--http-client-core) |
| 25 | Shadow-mode harness | Phase 3 | Not started | — | — | [Phase 3](#phase-3--http-client-core) |
| 26 | Helpers: customer / auth / activation | Phase 4 | Not started | — | — | [Phase 4](#phase-4--route-helper-cores) |
| 27 | Helpers: payment / payment-method / checkout | Phase 4 | Not started | — | — | [Phase 4](#phase-4--route-helper-cores) |
| 28 | Helpers: auto-recharge / balance-poll | Phase 4 | Not started | — | — | [Phase 4](#phase-4--route-helper-cores) |
| 29 | Helpers: purchase / renewal | Phase 4 | Not started | — | — | [Phase 4](#phase-4--route-helper-cores) |
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

### Phase 0 — Contract freeze and golden fixtures — In progress

<!-- running per-step bullets accumulate here as each step lands -->
- Step 1 (OpenAPI snapshot + regen script): Checked in path-filtered source + derived snapshot, shared `scripts/lib/openapi-pipeline.ts`, `scripts/snapshot-openapi.ts` (`--from-url` / `--from-file` / `--check`), `pnpm test:contract`, offline CI gates; `generate-types.ts` imports the shared pipeline — "done when" verified: `pnpm snapshot:openapi:check` zero diff + idempotent; contract tests green

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

#### Step 1 decisions for future handoffs

- **CI input:** backend publishes no OpenAPI artifact today → committed `contract/openapi/sdk-v1.source.json` is the offline CI input; CI never hits a live server.
- **Shared pipeline:** filter/prune/placeholder logic is one module used by both the snapshot script and `generate-types.ts`.
- **Determinism:** snapshot serialization recursively sorts object keys, preserves array order, 2-space indent, trailing newline (no new deps).
- **`/v1/sdk/agents` exclusion** kept for parity with `generate-types.ts`; currently a no-op if the route is absent upstream.
- **Open dependency:** automated drift vs backend CI needs a backend-published OpenAPI artifact (flag for backend team). See open-items index.
- **`contract/` is the Phase 0 contract-freeze root.** Step 2 → `contract/manifest/`; steps 3–7 → `contract/fixtures/`.

### Phase 1 — Pure, dependency-free logic — Not started

<!-- running per-step bullets accumulate here as each step lands -->

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

### Phase 2 — Generated DTOs and error model — Not started

<!-- running per-step bullets accumulate here as each step lands -->

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

### Phase 3 — HTTP client core — Not started

<!-- running per-step bullets accumulate here as each step lands -->

**Phase-close handoff** (filled when the last step's "done when" is verified):
- **What was done:** …
- **Why:** …
- **Decisions to document:** … (new §13 gates: …; deviations: …; deferred: …)
- **Pointers:** §12 D__, §13 gate(s) __, §15 note __; diagrams updated: …

### Phase 4 — Route helper cores — Not started

<!-- running per-step bullets accumulate here as each step lands -->

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
