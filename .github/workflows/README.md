# GitHub Actions Workflows

Automated workflows for the SolvaPay SDK monorepo. Versioning and
publishing are driven end-to-end by
[Changesets](https://github.com/changesets/changesets) — **no
hand-rolled version bumps, no ad-hoc `npm dist-tag add` invocations**.
To cut a release, commit a `.changeset/*.md` file alongside your PR;
the workflows do the rest.

## CI gates (`.github/workflows/ci.yml`)

Triggered on `pull_request` to `main`/`dev` (and `workflow_dispatch`). There is no duplicate full-suite `push` trigger — required PR checks are the gate for commits entering those branches.

The authoritative list of expanded check names (including every matrix cell) and the redesign §13 gate each enforces lives in [`contract/required-checks.yaml`](../../contract/required-checks.yaml). Drift is gated by `pnpm checks:required`. To print the `main` branch-protection payload: `node tools/repo/apply-branch-protection.mjs` (`--apply` is maintainer-opt-in).

### Node binding / clean-install (Steps 36–39)

Local entry points (from repo root, after building the host native binding and placing via `napi artifacts`):

```bash
# Pack (partial local bundle — CI requires all 8 native targets)
node sdks/node-native/scripts/prepare-clean-install-packages.mjs \
  --out-dir sdks/node-native/clean-install-bundle \
  --targets darwin-arm64 --allow-partial

# Host-native clean install
node sdks/node-native/scripts/clean-install-smoke.mjs \
  --bundle-dir sdks/node-native/clean-install-bundle \
  --mode native --target darwin-arm64
```

Success evidence line: `CLEAN_INSTALL_OK mode=… node=… os=… arch=… libc=… target=… event=evt_fixture_1`.

### `ci.yml` — PR gate

**Trigger:** pull request into `main` or `dev`.

Runs `deps:check`, `lint`, `build:packages`, `test`, and the **Deno
gate** (`pnpm --filter @example/supabase-edge-mcp validate:workspace`).
The Deno gate type-checks `examples/typescript/supabase-edge-mcp` under a real Deno
binary against the **workspace source** of the `@solvapay/*` packages,
so a feature branch proves its own SDK change still works for the
canonical Supabase Edge consumer before it merges. See
[`examples/typescript/supabase-edge-mcp/README.md`](../../examples/typescript/supabase-edge-mcp/README.md)
for how `deno.workspace.json` resolves workspace source.

### `publish-preview.yml` — Preview Snapshot

**Trigger:** manual `workflow_dispatch` only. Dispatch defaults to `dry_run=true`: the pre-publish gates still run, then `changeset status` + `pnpm -r publish --dry-run` (no `NPM_TOKEN`); snapshot version/publish/verify and the post-publish Deno gate are skipped. Dispatch with `dry_run=false` to cut a real `@preview` snapshot. `workflow_dispatch` inputs resolve against the default branch.

A real `@preview` dispatch runs the full pre-publish gate:

1. `pnpm build:packages` — every publishable package builds to `dist/`.
2. `pnpm test` — unit tests for every workspace package.
3. `pnpm validate:fetch-runtime` — asserts `@solvapay/server/fetch` and
   `@solvapay/mcp/fetch` load cleanly in a bare Web-standards
   environment (no `node:`-prefixed imports, no leaked Node builtins).
4. `validate:workspace` — the Deno gate, against workspace source.
5. `pnpm changeset version --snapshot preview` — stamps a
   `0.0.0-preview-<shortsha>` version on every package with a pending
   changeset (plus anything that depends on one).
6. `pnpm changeset publish --tag preview --no-git-tag` — publishes
   each snapshot to the `@preview` npm dist-tag.
7. `tools/repo/verify-npm-publishes.mjs` — confirms every package
   Changesets claimed to ship is actually fetchable from the registry.
8. `validate` — a **post-publish** re-run of the Deno gate, this time
   against the `@preview` tag the run just moved.

Step 8 is deliberately after the publish. It is the only check that
exercises the assembled npm tarballs (their published `exports` maps and
peer ranges) rather than workspace `dist/`, so it earns its place — but
it must not gate the publish. It used to: a publish that broke the
example froze the very tag the gate read, so every subsequent run failed
on stale input and the run that would have fixed it could never get past
its own gate. `@preview` sat 8 days stale in August 2026 for exactly
this reason. The workspace gate at step 4 is the blocking one because it
checks the code actually being shipped and has no such feedback loop.

Consumers install with:

```bash
pnpm add @solvapay/core@preview
```

### `publish.yml` — Stable Release

**Trigger:** push to `main` (or manual `workflow_dispatch`). Manual dispatch defaults to `dry_run=true`: the pre-publish gates still run, then `changeset status` + `pnpm -r publish --dry-run` (no `NPM_TOKEN`, no GitHub App token); `changesets/action` is skipped. Push to `main`, or dispatch with `dry_run=false`, takes the real Version-PR / publish path. `workflow_dispatch` inputs resolve against the default branch, so a dry-run dispatch of this input is a post-merge action until the workflow lands on `main`.

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
(tests, build, `validate-fetch-runtime`, and the `validate:workspace`
Deno gate).

This workflow has no dist-tag-pinned Deno gate. It ships `@latest`, so a
`@preview` gate would validate an artifact the run did not produce, and a
`@latest` gate would validate the previous release. Worth revisiting once
`0.3.0` reaches `@latest`.

## Lockstep train (Rust / Python / Ruby / Go)

`@solvapay/release-train` is the version source of truth. A PR that
touches `core/**` or a non-TypeScript SDK must add a changeset for it.
`pnpm changeset:version` stamps that version into the language manifests.

- **Tier A:** `workflow_dispatch` `publish.yml` with `dry_run=true` prints the
  four tags and fails if any already exist on `origin`.
- **Rehearsal:** run `push-rehearsal-tags.yml`. Tags are
  `rehearsal/solvapay-<lang>-v*`. Those workflows publish to TestPyPI,
  GitHub Packages, `solvapay-go-rehearsal`, and a local Cargo registry,
  then install-smoke. `rehearsal-npm.yml` snapshot-publishes to Verdaccio.
- **Production language tags** are not created by automation yet. That is a
  deliberate one-step follow-up after rehearsals pass.

See [`docs/publishing.mdx`](../../docs/publishing.mdx),
[`docs/contributing/language-previews.md`](../../docs/contributing/language-previews.md),
and
[`docs/contributing/release-sandbox.md`](../../docs/contributing/release-sandbox.md).

## Release workflow summary

```
feature branch  ──▶  PR to `dev`  ──▶  merge ──▶  (no automatic npm snapshot)
     │
     └── author ran `pnpm changeset` and committed .changeset/*.md
     └── optional: dispatch `publish-preview.yml` (`dry_run=false`) for `@preview`

eventually:

`dev`  ──▶  PR to `main`  ──▶  merge ──▶  changesets/action opens
                                          "Version Packages" PR
"Version Packages" PR  ──▶  review  ──▶  merge  ──▶  stable @latest
                                                     npm publish + git tags
                                                     (language tags: Phase 3)
```

## Required Secrets

- **`NPM_TOKEN`** — automation token with publish permission for the
  `@solvapay` scope. Used by both workflows.
- **`GITHUB_TOKEN`** — auto-provided; used by `changesets/action` to
  open the Release PR.

Set the NPM token in **Repository Settings → Secrets and variables → Actions**.

## Quick Reference

| Action                       | How to trigger                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Publish preview snapshot     | Dispatch `publish-preview.yml` with `dry_run=false`                                |
| Cut stable release           | Push to `main` (auto-opens Version Packages PR), then merge the generated PR       |
| Write a changeset            | `pnpm changeset` (interactive)                                                     |
| Inspect pending releases     | `pnpm changeset status --verbose`                                                  |
| Local npm publish dry-run    | `pnpm release:dryrun` (gates + `pnpm -r publish --dry-run`, no `NPM_TOKEN`)        |
| Local npm + language dry-run | `pnpm dryrun` (`release:dryrun` then `preview --dry-run --accept-partial`)         |
| Verify fetch-runtime         | `pnpm validate:fetch-runtime` (or `pnpm tsx tools/repo/validate-fetch-runtime.ts`) |
| Run the Deno gate            | `pnpm --filter @example/supabase-edge-mcp validate:workspace`                      |

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
  because the post-publish gate resolves mutable `@preview` tags.

### Deno gate fails with a cascade of `TS2307` / `TS7031` implicit-any errors

- That shape of failure is a resolution problem, not a type problem.
  `validate:workspace` resolves `@solvapay/*` through pnpm symlinks into
  `sdks/typescript/*`, which lands outside `node_modules` — so Deno stops
  mapping the `./chunk-XYZ.js` specifiers tsup writes into its `.d.ts`
  files onto their `.d.ts` siblings. `deno.workspace.json` must keep
  `"unstable": ["sloppy-imports"]` (extension probing restores the
  mapping), `"nodeModulesDir": "manual"`, and must stay at the example
  root so Deno finds the pnpm-populated `node_modules`. Run
  `pnpm build:packages` first — the gate reads `dist/`.

### Deno gate fails only on a publish workflow, not on the PR

- The pre-publish gate and the PR gate both run `validate:workspace`, so
  a divergence means the merge commit differs from what CI saw. Rerun
  `pnpm --filter @example/supabase-edge-mcp validate:workspace` locally
  on the merged branch.
- If the _post-publish_ `validate` step is the one failing, the newly
  published tarballs are broken (bad `exports` map or peer range), not
  the source. The publish already happened; fix forward with a new
  changeset. Locally, reproduce with `deno check --reload=npm: …` — Deno
  caches npm metadata and will otherwise resolve a stale `@preview`.

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
- [`tools/README.md`](../../tools/README.md) — helper scripts (incl. `validate-fetch-runtime`)
