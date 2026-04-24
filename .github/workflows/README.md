# GitHub Actions Workflows

Automated workflows for the SolvaPay SDK monorepo. Versioning and
publishing are driven end-to-end by
[Changesets](https://github.com/changesets/changesets) — **no
hand-rolled version bumps, no ad-hoc `npm dist-tag add` invocations**.
To cut a release, commit a `.changeset/*.md` file alongside your PR;
the workflows do the rest.

## Workflows

### `publish-preview.yml` — Preview Snapshot

**Trigger:** push to `dev` (or manual `workflow_dispatch`).

Every push to `dev` runs the full pre-publish gate:

1. `pnpm test` — unit tests for every workspace package.
2. `pnpm build:packages` — every publishable package builds to `dist/`.
3. `pnpm validate:fetch-runtime` — asserts `@solvapay/fetch` and
   `@solvapay/mcp-fetch` load cleanly in a bare Web-standards
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

| Action                   | How to trigger                                                                 |
| ------------------------ | ------------------------------------------------------------------------------ |
| Publish preview snapshot | Push to `dev`                                                                  |
| Cut stable release       | Push to `main` (auto-opens Version Packages PR), then merge the generated PR   |
| Write a changeset        | `pnpm changeset` (interactive)                                                 |
| Inspect pending releases | `pnpm changeset status --verbose`                                              |
| Verify fetch-runtime     | `pnpm validate:fetch-runtime` (or `pnpm tsx scripts/validate-fetch-runtime.ts`) |

## Troubleshooting

### Workflow fails with 401 Unauthorized

- Verify `NPM_TOKEN` is set and has publish permission on `@solvapay`.
- Tokens expire — regenerate if older than ~12 months.

### `validate:fetch-runtime` fails

- A new dep got pulled into `@solvapay/fetch` or `@solvapay/mcp-fetch`
  that pulls a `node:`-prefixed builtin. Remove the offending dep or
  gate it behind a runtime detector before importing.

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
