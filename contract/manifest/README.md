# SDK contract manifest

Checked-in public-API catalog for the Rust core SDK migration (Phase 0 / Step 2).

| File                | Role                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `sdk-contract.yaml` | Canonical catalog of operations, top-level exports, core helpers, facade entry points, error templates, defaults, and per-language names. |

Together with [`../openapi/`](../openapi/), this is one of the two generation inputs. OpenAPI owns wire DTOs; the manifest owns non-wire behavior (normalization, idempotency, message templates, overlays, sync matrix, idiomatic names).

## Validate (dev)

```bash
# Schema + coverage / collision / name-correctness checks
pnpm manifest:validate
```

## Offline check (CI)

```bash
pnpm manifest:check
```

Runs the validate checks, then cross-checks every operation route and non-overlay DTO ref against `contract/openapi/sdk-v1.snapshot.json`. No network and no `localhost`.

## Shared schema

Zod schema, `deriveNames`, and coverage helpers live in `scripts/lib/manifest-schema.ts`. The CLI is `scripts/manifest.ts`.

## Name overrides

Manual per-language names are allowed **only** via the `nameOverrides` block (reserved words, facade idioms, error class casing). Emitters must not hard-code renames.

Go callable-surface methods take `ctx context.Context` as the first parameter (`defaults.goContextFirstParam`). That parameter is catalogued for the IR — emitters must not invent it later.

## Backend / OpenAPI drift

Route presence is gated against the checked-in OpenAPI snapshot. When the backend adds or renames an SDK route, refresh the OpenAPI artifacts (`pnpm snapshot:openapi`) and update this manifest in the same change.
