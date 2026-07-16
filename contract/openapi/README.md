# OpenAPI contract artifacts (`/v1/sdk/*`)

Checked-in OpenAPI inputs for the Rust core SDK migration (Phase 0 / Step 1).

| File | Role |
| --- | --- |
| `sdk-v1.source.json` | Recorded backend OpenAPI **restricted to `/v1/sdk/*` paths**, schemas intact (unpruned). Offline CI input. |
| `sdk-v1.snapshot.json` | Derived deliverable: path-filtered, schemas pruned, dangling `$ref` placeholders added, keys canonicalized. |

`/v1/sdk/agents` is excluded (parity with `packages/server/scripts/generate-types.ts`). That exclusion is currently a no-op if the route is absent upstream.

## Refresh (dev)

Requires a reachable OpenAPI document (local backend by default):

```bash
# Local backend (http://localhost:3001/v1/openapi.json)
pnpm snapshot:openapi --from-url

# Or an explicit URL
pnpm snapshot:openapi --from-url https://api-dev.solvapay.com/v1/openapi.json

# Or a downloaded full/partial OpenAPI JSON file
pnpm snapshot:openapi --from-file /path/to/openapi.json
```

This rewrites both `sdk-v1.source.json` and `sdk-v1.snapshot.json` under `contract/openapi/`.

## Offline check (CI)

```bash
pnpm snapshot:openapi:check
```

Derives the snapshot from the committed source, diffs against the committed snapshot, and confirms double-derive is byte-identical. No network and no `localhost`.

## Shared pipeline

Filter / prune / placeholder / canonicalize live in `scripts/lib/openapi-pipeline.ts`. Both `scripts/snapshot-openapi.ts` and `packages/server/scripts/generate-types.ts` import that module so the two paths cannot drift.

## Backend artifact handoff

Today the backend publishes no OpenAPI CI artifact — the spec is only a live response. This repo therefore commits the recorded source. Automated drift detection against backend CI needs a published OpenAPI artifact from the backend repo; that is a backend-team handoff, not SDK step-1 work.
