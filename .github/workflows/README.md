# GitHub Actions Workflows

Automated workflows for the SolvaPay SDK monorepo. Versioning and
publishing are driven end-to-end by
[Changesets](https://github.com/changesets/changesets) — **no
hand-rolled version bumps, no ad-hoc `npm dist-tag add` invocations**.
To cut a release, commit a `.changeset/*.md` file alongside your PR;
the workflows do the rest.

## CI gates (`.github/workflows/ci.yml`)

Triggered on `pull_request` to `main`/`dev` (and `workflow_dispatch`). There is no duplicate full-suite `push` trigger — required PR checks are the gate for commits entering those branches.

### Node binding / clean-install (Steps 36–39)

| Check name                                            | What it proves                                                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-binding (<triple>)`                             | Builds each §7.7 native target; in-tree `node --test` smoke on host-native legs (Node 22)                                                                                  |
| `node-binding (wasm32-wasip1-threads + FORCE_WASI)`   | In-tree WASI build + `NAPI_RS_FORCE_WASI=error` smoke                                                                                                                      |
| `node-binding artifact gate`                          | `napi artifacts` + `check-artifacts.mjs` 9/9; packs publish-shaped tarball bundle `server-clean-install-packages`                                                          |
| `node-binding conformance (Rust-only server/core)` | Workspace-linked `@solvapay/server` + `@solvapay/core` unit suites on Rust binding (Steps 52–53)                                                                             |
| `wasm-binding (Step 38 edge/browser)`                 | wasm-bindgen edge/browser budgets, symbol audit, Deno smoke (separate from napi WASI)                                                                                      |
| `node clean install (native, <target>, Node <major>)` | **Step 39:** fresh `npm install` of packed `.tgz` into an empty temp project + public `@solvapay/server` `verifyWebhook`; 8 targets × Node 22/24/26 |
| `node clean install (WASI, Node <major>)`             | **Step 39:** WASI-only packed install (`NAPI_RS_FORCE_WASI=error`, no `.node`); Node 22/24/26 on Linux x64                                                                 |

**Local entry points** (from repo root, after building host + WASI bindings and placing via `napi artifacts`):

```bash
# Pack (partial local bundle — CI requires all 9 targets)
node rust/bindings/node/scripts/prepare-clean-install-packages.mjs \
  --out-dir rust/bindings/node/clean-install-bundle \
  --targets darwin-arm64,wasm32-wasi --allow-partial

# Host-native clean install
node rust/bindings/node/scripts/clean-install-smoke.mjs \
  --bundle-dir rust/bindings/node/clean-install-bundle \
  --mode native --target darwin-arm64

# WASI-only clean install
node rust/bindings/node/scripts/clean-install-smoke.mjs \
  --bundle-dir rust/bindings/node/clean-install-bundle \
  --mode wasi --target wasm32-wasi
```

Success evidence line: `CLEAN_INSTALL_OK mode=… node=… os=… arch=… libc=… target=… event=evt_fixture_1`.

### `publish-preview.yml` — Preview Snapshot

**Trigger:** push to `dev` (or manual `workflow_dispatch`).

Every push to `dev` runs the full pre-publish gate:

1. `pnpm build:packages` — every publishable package builds to `dist/`.
2. `pnpm test` — unit tests for every workspace package.
3. `pnpm validate:fetch-runtime` — asserts `@solvapay/server/fetch` and
   `@solvapay/mcp/fetch` load cleanly in a bare Web-standards
   environment (no `node:`-prefixed imports, no leaked Node builtins).
4. `pnpm changeset version --snapshot preview` — stamps a
   `0.0.0-preview-<shortsha>` version on every package with a pending
   changeset (plus anything that depends on one).
5. `pnpm changeset publish --tag preview --no-git-tag` — publishes
   each snapshot to the `@preview` npm dist-tag.

Consumers install with:

```bash
pnpm add @solvapay/core@preview
```

### `publish.yml` — Stable Release

**Trigger:** push to `main` (or manual `workflow_dispatch`).

Uses [`changesets/action@v1`](https://github.com/changesets/action),
which runs in two distinct modes:

- **Release PR mode** — when `.changeset/` contains pending changesets,
  opens (or updates) a **"Version Packages"** PR that enumerates every
  accumulated change grouped by semver bump level. The PR body is
  auto-generated from the changeset files.
- **Publish mode** — when `.changeset/` is empty (i.e. the Release PR
  has just been merged and `changeset version` has already bumped
  `package.json`s + appended to `CHANGELOG.md`), publishes each
  bumped package to the `@latest` npm dist-tag and creates matching
  git tags (`@solvapay/core@1.1.0`, `@solvapay/mcp@0.2.0`, …).

Both modes run the same pre-publish gates as the preview workflow
(tests, build, `validate-fetch-runtime`).

## Release workflow summary

```
feature branch  ──▶  PR to `dev`  ──▶  merge ──▶  preview snapshot on npm
     │
     └── author ran `pnpm changeset` and committed .changeset/*.md

eventually:

`dev`  ──▶  PR to `main`  ──▶  merge ──▶  changesets/action opens
                                          "Version Packages" PR
"Version Packages" PR  ──▶  review  ──▶  merge  ──▶  stable @latest
                                                     publish + git tags
```

## Required Secrets

- **`NPM_TOKEN`** — automation token with publish permission for the
  `@solvapay` scope. Used by both workflows.
- **`GITHUB_TOKEN`** — auto-provided; used by `changesets/action` to
  open the Release PR.

Set the NPM token in **Repository Settings → Secrets and variables → Actions**.

## Quick Reference

| Action                   | How to trigger                                                                  |
| ------------------------ | ------------------------------------------------------------------------------- |
| Publish preview snapshot | Push to `dev`                                                                   |
| Cut stable release       | Push to `main` (auto-opens Version Packages PR), then merge the generated PR    |
| Write a changeset        | `pnpm changeset` (interactive)                                                  |
| Inspect pending releases | `pnpm changeset status --verbose`                                               |
| Verify fetch-runtime     | `pnpm validate:fetch-runtime` (or `pnpm tsx scripts/validate-fetch-runtime.ts`) |

## Troubleshooting

### Workflow fails with 401 Unauthorized

- Verify `NPM_TOKEN` is set and has publish permission on `@solvapay`.
- Tokens expire — regenerate if older than ~12 months.

### `validate:fetch-runtime` fails

- A new dep got pulled into `@solvapay/server/fetch` or `@solvapay/mcp/fetch`
  that pulls a `node:`-prefixed builtin. Remove the offending dep or
  gate it behind a runtime detector before importing.

### Deno gate fails with "minimum dependency date" / "minimumDependencyAge"

- Deno 2.9+ blocks npm packages published within 24h by default. The
  supabase-edge-mcp import maps must set `"minimumDependencyAge": 0`
  because the gate resolves mutable `@preview` tags.

### `changeset version --snapshot preview` publishes no packages

- No `.changeset/*.md` files are pending. Either (a) the PR missed a
  changeset (run `pnpm changeset` and commit), or (b) your change
  doesn't affect any published package.

### Version already exists on npm

- You can't re-publish the same version. Cut a fresh changeset so the
  next version bumps past the clash.

## See Also

- [`.changeset/README.md`](../../.changeset/README.md) — changeset file format
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — development workflow
- [`scripts/README.md`](../../scripts/README.md) — helper scripts (incl. `validate-fetch-runtime`)
