# OpenAPI contract artifacts (`/v1/sdk/*`)

Checked-in OpenAPI inputs for the Rust core SDK migration (Phase 0 / Step 1).

| File                   | Role                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `sdk-v1.source.json`   | Recorded backend OpenAPI **restricted to `/v1/sdk/*` paths**, schemas intact (unpruned). Offline CI input.  |
| `sdk-v1.snapshot.json` | Derived deliverable: path-filtered, schemas pruned, dangling `$ref` placeholders added, keys canonicalized. |

`/v1/sdk/agents` is excluded. That exclusion is currently a no-op if the route is absent upstream.

`sdks/typescript/server/src/types/generated.ts` is generated from the committed snapshot (`pnpm gen`), not from a live fetch. There is no second OpenAPI source of truth.

## Refresh (dev)

A single identity/gateway URL is **not** a merged OpenAPI document. Refresh from the five local service ports:

```bash
# Merge each service in contract/openapi/local-stack.yaml
pnpm snapshot:openapi --from-stack

# Or a downloaded full/partial OpenAPI JSON file
pnpm snapshot:openapi --from-file /path/to/openapi.json
```

This rewrites both `sdk-v1.source.json` and `sdk-v1.snapshot.json` under `contract/openapi/`. Then run `pnpm gen` so Rust DTOs, language facades, and `generated.ts` follow the snapshot.

## Offline check (CI)

```bash
pnpm snapshot:openapi:check
```

Derives the snapshot from the committed source, diffs against the committed snapshot, and confirms double-derive is byte-identical. No network and no `localhost`.

## Stack-aware drift (when a local stack is running)

```bash
pnpm snapshot:openapi:check --from-stack
```

Merges the running stack, derives the snapshot, and fails on any diff against the committed file. Keep this off CI; use it locally (and in `pnpm gen:all` via the write path) so platform contract changes cannot rot the snapshot silently.

## Shared pipeline

Filter / prune / placeholder / canonicalize live in `tools/codegen/lib/openapi-pipeline.ts`. `tools/codegen/snapshot-openapi.ts` is the writer; `generate-types.ts` consumes the committed snapshot.

## Backend artifact handoff

Today the backend publishes no OpenAPI CI artifact — the spec is only a live response. This repo therefore commits the recorded source. The durable fix is a backend-published OpenAPI artifact (the five service specs, or a merged `/v1/sdk/*` document) that SDK CI can diff against the committed snapshot without a running stack. Until that handoff exists, `--from-stack` / `--check --from-stack` is the only way to catch platform drift.
