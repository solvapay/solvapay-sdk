# GitHub Actions Workflows

Automated workflows for the SolvaPay SDK monorepo. Versioning and
publishing are driven end-to-end by
[Changesets](https://github.com/changesets/changesets) — **no
hand-rolled version bumps, no ad-hoc `npm dist-tag add` invocations**.
To cut a release, commit a `.changeset/*.md` file alongside your PR;
the workflows do the rest.

**The release spec lives in
[`docs/contributing/release-and-publishing.md`](../../docs/contributing/release-and-publishing.md)**
— channels, per-ecosystem registries, every pre-publish gate, credential and
trusted-publisher setup. This file covers per-workflow notes and
troubleshooting only.

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

**Trigger:** manual `workflow_dispatch` only, defaulting to `dry_run=true`. It
is the single preview entry point for all five ecosystems: npm `@preview`, the
eight native platform packages, and (with `include_languages=true`) the four
rehearsal language tags. Step-by-step:
[release-and-publishing.md](../../docs/contributing/release-and-publishing.md#preview).

Two ordering facts worth knowing when editing this file:

- The release-train sentinel is read into a step output **before**
  `changeset version --snapshot`, because `privatePackages: { version: true }`
  rewrites that file to `0.0.0-preview-<sha>` and `parseSemver` accepts only
  strict `X.Y.Z`.
- The post-publish Deno gate (`validate`, against the `@preview` tarballs) runs
  last, after the registry verification.

The post-publish position is deliberate. It is the only check that
exercises the assembled npm tarballs (their published `exports` maps and
peer ranges) rather than workspace `dist/`, so it earns its place — but
it must not gate the publish. It used to: a publish that broke the
example froze the very tag the gate read, so every subsequent run failed
on stale input and the run that would have fixed it could never get past
its own gate. `@preview` sat 8 days stale in August 2026 for exactly
this reason. The pre-publish `validate:workspace` gate is the blocking one
because it checks the code actually being shipped and has no such feedback loop.

Consumers install with:

```bash
pnpm add @solvapay/core@preview
```

### `publish.yml` — Stable Release

**Trigger:** push to `main`, or manual `workflow_dispatch` (defaults to
`dry_run=true`). Full path and gate order:
[release-and-publishing.md](../../docs/contributing/release-and-publishing.md#production).

Three jobs: `detect` (`publish_leg` when `.changeset/` is empty of pending
`*.md`; `native_leg` also when a dry-run sets `force_native`) → `native-build`
(`native_leg` only) → `release`. The `release` job runs with
`if: ${{ !cancelled() && needs.detect.result == 'success' && needs.native-build.result != 'failure' }}`
so the Version-Packages-PR leg still runs when the native matrix is skipped, but
a failed `detect` cannot skip the native steps and Gate A.

[`changesets/action@v1`](https://github.com/changesets/action) has two modes and
the job serves both:

- **Release PR mode** — `.changeset/` has pending changesets: open or update the
  **"Version Packages"** PR.
- **Publish mode** — `.changeset/` is empty because that PR just merged:
  publish each bumped package to `@latest` and create matching git tags
  (`@solvapay/core@1.1.0`, `@solvapay/mcp@0.2.0`, …).

Publish mode is also why the whole native path can run _before_
`changesets/action`: the version bump has already landed at checkout, so
`prepare-native-publish.ts` reads the final loader version.

This workflow has no dist-tag-pinned Deno gate. It ships `@latest`, so a
`@preview` gate would validate an artifact the run did not produce, and a
`@latest` gate would validate the previous release.

### `native-build.yml` — reusable native matrix

`workflow_call` only, no `workflow_dispatch`. Holds the 8-target napi matrix and
uploads `bindings-<rustTriple>` artifacts for `publish.yml` and
`publish-preview.yml` to place with `napi artifacts`.

Do **not** add it to `PUBLISH_WORKFLOW_FILES` in
[`tools/repo/lib/release-dryrun.ts`](../../tools/repo/lib/release-dryrun.ts) —
it has no `workflow_dispatch`, so `workflowHasDryRunDefault` would fail it.
`ci.yml` still keeps its own copy of this matrix; migrating it would rename every
required check, so it is a separate coordinated change.

## Lockstep train (Rust / Python / Ruby / Go)

`@solvapay/release-train` is the version source of truth, and a PR touching
`core/**` or a non-TypeScript SDK must add a changeset for it. Channel matrix,
version grammars and the `vars.RELEASE_PROD_*` rollout switches:
[release-and-publishing.md](../../docs/contributing/release-and-publishing.md).
Tag-push mechanics: [`docs/contributing/production-release.md`](../../docs/contributing/production-release.md).
Preview runbook: [`docs/contributing/language-previews.md`](../../docs/contributing/language-previews.md).
Sandbox fork: [`docs/contributing/release-sandbox.md`](../../docs/contributing/release-sandbox.md).

## Release workflow summary

```
feature branch  ──▶  PR to `dev`  ──▶  merge ──▶  nothing publishes
     │                                            (no trigger on `dev` at all)
     └── author ran `pnpm changeset` and committed .changeset/*.md
     └── optional: dispatch `publish-preview.yml` (`dry_run=false`)
         ──▶ npm @preview + 8 native platform packages
         ──▶ 4 rehearsal language tags (include_languages=true)

eventually:

`dev`  ──▶  PR to `main`  ──▶  merge ──▶  changesets/action opens
                                          "Version Packages" PR
"Version Packages" PR  ──▶  review  ──▶  merge  ──▶  8 native platform
                                                     packages, then stable
                                                     @latest + git tags, then
                                                     production language tags
                                                     (per vars.RELEASE_PROD_*)
```

## Credentials

Every secret, repository variable and trusted publisher — what it is for, where
to create it, and the exact field values for each registry's form — is in
[release-and-publishing.md](../../docs/contributing/release-and-publishing.md#credentials).

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

### `check-release-dryrun --assert-no-local-paths` fails on a publish run

- The loader's `optionalDependencies` are still `file:npm/*`, which means
  `prepare-native-publish.ts` did not run, ran before the version bump, or
  no-op'd. Do not skip this gate — publishing past it ships a loader whose
  `optionalDependencies` point at paths that do not exist on a consumer's
  machine, and every other gate passes.

### `verify-native-platform-publishes.ts` reports missing packages

- A partial platform publish. The script probes each of the eight at the
  loader's exact version with a 10-minute retry window, so a plain propagation
  delay resolves itself. If it still fails, re-run the job:
  `publish-native-platform-packages.ts` skips versions already on npm, so the
  retry only pushes the ones that failed.

### A language publish fails OIDC auth with an unhelpful error

- Check that the trusted-publisher entry's **Environment** field is empty. None
  of `publish-python.yml`, `publish-ruby.yml` or `publish-rust.yml` declares an
  `environment:`, so a configured environment makes the OIDC claim mismatch and
  the error does not name the cause.

## See Also

- [`docs/contributing/release-and-publishing.md`](../../docs/contributing/release-and-publishing.md) — the release spec
- [`.changeset/README.md`](../../.changeset/README.md) — changeset file format
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — development workflow
- [`tools/README.md`](../../tools/README.md) — helper scripts (incl. `validate-fetch-runtime`)
