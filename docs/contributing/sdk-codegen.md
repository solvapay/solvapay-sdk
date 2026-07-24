# SDK codegen workflow

How to regenerate SolvaPay’s five language surfaces from the OpenAPI snapshot and
contract manifest. This is the day-to-day runbook; architecture rationale lives
in [`rust-core-sdk-redesign-v2.md`](./rust-core-sdk-redesign-v2.md) (§5.6 / §5.7).

## Mental model

```text
Backend OpenAPI ──► snapshot (committed) ──┐
                                           ├──► pnpm gen (dto-gen) ──► 5 surfaces + glue
SDK contract manifest (reviewed) ──────────┘
```

| Artifact                                | Role                                                    | Who edits                               |
| --------------------------------------- | ------------------------------------------------------- | --------------------------------------- |
| `contract/openapi/sdk-v1.snapshot.json` | Filtered `/v1/sdk/*` wire contract                      | Regenerated from live backend or source |
| `contract/manifest/sdk-contract.yaml`   | Public API catalog, overlays, bindings, docs, defaults  | Humans (reviewed diff)                  |
| Generated outputs                       | DTOs, facades, shims, parity suites, native marshalling | **Only** `pnpm gen`                     |

**Principle:** automate mechanical toil; keep curated decisions (names, prose docs,
behavioral fixtures, sync/async intent) human-owned in the manifest.

## Commands (cheat sheet)

Run from the repo root (`solvapay-sdk/`).

| Command                                                    | What it does                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm snapshot:openapi --from-url`                         | Fetch live OpenAPI → rewrite source + snapshot (needs `localhost:3001`)     |
| `pnpm snapshot:openapi:check`                              | Offline: re-derive snapshot from source, fail on drift                      |
| `pnpm gen:scaffold operation <id> --method <M> --path <p>` | Insert `operations:` (+ optional `bindings:`) stub from OpenAPI DTOs        |
| `pnpm gen:bindings` / `pnpm gen:bindings --fix`            | Suggest or insert missing `bindings:` for orphan operations                 |
| `pnpm gen`                                                 | Regenerate **all** dto-gen outputs (canonical flag set in `scripts/gen.ts`) |
| `pnpm gen:check`                                           | Same as `gen`, then `git diff` against HEAD — CI drift gate                 |
| `pnpm gen:all`                                             | Live snapshot (if backend up) → `gen` → `manifest:check` → `parity:check`   |
| `pnpm manifest:check`                                      | Schema + semantics + OpenAPI cross-check + binding reconciliation           |
| `pnpm parity:check`                                        | Cross-language signature parity                                             |

There is **no** need to copy a 30-flag `cargo run -p dto-gen -- …` line. CI and
humans both call `pnpm gen` / `pnpm gen:check`.

## Prerequisites

- **Node / pnpm** — for the TS scripts above
- **Rust toolchain** — `pnpm gen` runs `cargo run -p dto-gen` from `rust/`
- **Live backend** (optional) — only for refreshing the OpenAPI snapshot:
  `http://localhost:3001/v1/openapi.json`

Activate git hooks after clone/install (`pnpm install` runs `prepare` → husky):

| Hook         | Behavior                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `pre-commit` | If `sdk-contract.yaml` or the OpenAPI snapshot is staged → `pnpm gen` and re-stage generated paths |
| `pre-push`   | `pnpm gen:check` + `manifest:check` + `parity:check`                                               |

CI’s `pnpm gen:check` remains the authoritative drift gate; hooks are local DX.

---

## Workflow A — Add a wire operation (new HTTP route)

Use this when the backend gained a `/v1/sdk/*` route that should appear on all
SDK clients.

### 1. Refresh the OpenAPI snapshot

```bash
# Backend must be serving OpenAPI locally
pnpm snapshot:openapi --from-url http://localhost:3001/v1/openapi.json
```

Confirm the new path exists under `contract/openapi/sdk-v1.snapshot.json`.

Without a live backend, land the snapshot update from the platform CI artifact /
recorded source (`pnpm snapshot:openapi --from-file …`) instead.

### 2. Scaffold the manifest entry

```bash
pnpm gen:scaffold operation myNewOp \
  --method POST \
  --path /v1/sdk/my-new-op
```

This derives:

- `request` / `response` schema refs from the snapshot
- path-param → `params` (string) and body → `params` ref
- all five language `names:` via `deriveNames`
- a `docs:` block (OpenAPI description used as `summary` when present; otherwise a TODO)
- default `sync:` matrix
- a `bindings:` stub (unless `--no-bindings`) with `clientAwait` / `clientSplit`

### 3. Human review (the curated diff)

Edit `contract/manifest/sdk-contract.yaml`:

- Replace TODO docs with real prose (`docs.summary` / `params` / `returns`), **or**
  omit `docs:` entirely for a routed op — dto-gen falls back to the OpenAPI
  operation `description` (then `summary`). Manifest `docs:` always wins when set.
- Adjust `nameOverrides` only if a language collides with a reserved word.
- Confirm `overlays:`, `idempotency`, and error templates.
- Review the scaffolded `bindings:` (`core` path, `serialize`, `dtoType`,
  `clientCallArgs`). Fix anything the heuristic got wrong.

### 4. Close binding reconciliation

If scaffold skipped bindings, or you added the operation by hand:

```bash
pnpm gen:bindings --fix   # inserts bindings: + SHIM_JS_NAMES
```

Or inspect first with `pnpm gen:bindings` (suggest-only).

### 5. Regenerate and verify

```bash
pnpm gen
pnpm manifest:check
pnpm parity:check
```

Or in one shot: `pnpm gen:all` (also refreshes the snapshot when the backend is up).

### 6. Fixtures and core

- Add/update `contract/fixtures/…` behavioral goldens for the new op.
- Implement the Rust transport/core method named in `bindings.*.core`.
- Commit the manifest **and** every regenerated file (`pnpm gen:check` must be green).

---

## Workflow B — Add a binding for an existing catalog op

When `manifest:check` reports
`Bindings: orphan catalog entry operation.<id> has no binding linker`:

```bash
pnpm gen:bindings --fix
pnpm gen
pnpm manifest:check
```

Review the inserted `bindings:` block (especially `core` and `call.serialize`)
before committing. Descriptors are derived from catalog params/route — not yet
from Rust AST (that is a later optional phase).

---

## Workflow C — Overlay / docs / defaults only

No new route:

1. Edit `contract/manifest/sdk-contract.yaml` (`overlays:`, `docs:`, `defaults:`, …).
2. `pnpm gen`
3. `pnpm manifest:check`

Historical one-shot backfills (do **not** use for new work):

- `pnpm exec tsx scripts/populate-manifest-params.ts`
- `pnpm exec tsx scripts/populate-manifest-docs.ts`

---

## Workflow D — OpenAPI-only type refresh (TS `generated.ts`)

`packages/server/src/types/generated.ts` is produced by the server package’s
OpenAPI → TypeScript path (separate from dto-gen facades):

```bash
# Live backend required
pnpm --filter @solvapay/server generate:types
```

Then still run the SDK surface pipeline if wire shapes affect clients:

```bash
pnpm snapshot:openapi --from-url
pnpm gen
```

---

## What `pnpm gen` regenerates

Canonical paths are listed in `scripts/gen.ts` (`DTO_GEN_ARGS` + `GENERATED_PATHS`).
High-level groups:

| Group                | Examples                                                                        |
| -------------------- | ------------------------------------------------------------------------------- |
| Rust DTOs            | `rust/crates/solvapay-dto/src/{schemas,routes,overlays,error_templates,lib}.rs` |
| TS overlays + client | `packages/server/src/types/{overlays,client}.generated.d.ts`                    |
| TS marshalling       | `packages/server/src/{native,wasm}.ts`                                          |
| TS parity            | `packages/server/src/__generated__/signature-parity.generated.test.ts`          |
| Binding dump         | `contract/manifest/binding-symbols.snapshot.json`                               |
| Node / Wasm shims    | `rust/bindings/{node,wasm}/src/{args,decisions,payload_builders,*_client}.rs`   |
| Python               | PyO3 shims, `_native.py`, `__init__.pyi`, parity test                           |
| Ruby                 | Magnus shims, `_native.rb`, `client.rb`, RBS, parity test                       |
| Rust facade          | `client_generated.rs`, `blocking_generated.rs`, parity test                     |
| Go                   | WASI guest shims, `client_generated.go`, parity test                            |

Hand-editing any of these fails CI (`@generated` header gate + `pnpm gen:check`).

### C ABI note

`rust/bindings/c/` still uses a hand-maintained `dispatch.rs` allowlist. New ops
do **not** appear in C until the deferred `Toolchain::C` emitter lands.

---

## Docs: authorship and OpenAPI fallback

| Entry point kind                      | Doc source                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| Routed `operations:`                  | Manifest `docs:` if present; else OpenAPI operation `description` / `summary` |
| `topLevel` / `coreHelpers` / `facade` | Manifest `docs:` only (required for coverage)                                 |

Coverage gate: every catalogued entry point must end up with a non-empty
`docs.summary` in the IR (`cargo test -p dto-gen --lib doc_coverage` and the
named CI step). Emitters render that one model into TSDoc / docstring / YARD /
godoc / rustdoc.

---

## Gates and failure modes

| Symptom                                                | Fix                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| CI `solvapay-dto regen drift` / `pnpm gen:check` fails | `pnpm gen` and commit outputs                                              |
| `orphan catalog entry … no binding linker`             | `pnpm gen:bindings --fix` then `pnpm gen`                                  |
| `doc-comment coverage: missing … docs.summary`         | Add manifest `docs:` or ensure OpenAPI has a description for routed ops    |
| `OpenAPI cross-check failed`                           | Align `route` / `request` / `response` / overlays with the snapshot        |
| Snapshot check fails offline                           | `pnpm snapshot:openapi:check` — re-derive from committed source            |
| Pre-push hook too slow                                 | Hooks are convenience; you can skip locally, but CI still runs `gen:check` |

---

## Script map

| Path                              | Responsibility                                        |
| --------------------------------- | ----------------------------------------------------- |
| `scripts/gen.ts`                  | **Only** place that lists dto-gen flags + drift paths |
| `scripts/gen-all.ts`              | Full local pipeline                                   |
| `scripts/gen-scaffold.ts`         | Manifest operation (+ bindings) scaffolder            |
| `scripts/gen-bindings.ts`         | Orphan binding suggest/fix                            |
| `scripts/lib/manifest-edit.ts`    | Surgical YAML block edits                             |
| `scripts/lib/manifest-schema.ts`  | Zod schema, `deriveNames`, reconciliation             |
| `scripts/lib/openapi-pipeline.ts` | Filter/prune/canonicalize OpenAPI                     |
| `scripts/snapshot-openapi.ts`     | Snapshot write / check                                |
| `scripts/manifest.ts`             | `manifest:validate` / `manifest:check` CLI            |
| `rust/tools/dto-gen/`             | IR lower + emitters                                   |

---

## What stays manual by design

- Per-language name overrides / reserved-word escapes
- Prose documentation quality (beyond OpenAPI fallback)
- Behavioral golden fixtures under `contract/fixtures/`
- Sync/async and idempotency intent in the manifest
- Rust core/transport implementation behind `bindings.*.core`
- C ABI allowlist (`dispatch.rs`) until a C emitter exists

The reviewed manifest (and fixture) diff remains the forcing function; codegen
removes boilerplate around it, not the review.
