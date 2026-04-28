# Scripts

This directory contains utility scripts for the SolvaPay SDK monorepo.

Versioning + publishing now live under [Changesets](https://github.com/changesets/changesets) — run `pnpm changeset`, merge the generated "Version Packages" PR, and the GitHub Actions workflows under [`.github/workflows/`](../.github/workflows) handle the rest. Hand-rolled publish scripts (`tag-as-latest.ts`, `test-publish.ts`, `unpublish-preview.sh`, `verify-preview.sh`, `deprecate-version.sh`) have been removed in favour of `changesets/action`.

## Documentation Scripts

### `validate-doc-links.ts`

Validates that all markdown links in documentation files are valid and point to existing files.

**Usage:**

```bash
pnpm docs:validate-links
```

**What it does:**

- Scans all `.md` files in the `docs/` directory
- Validates relative file and directory links
- Reports broken links with file and line numbers
- Exits with error code 1 if broken links are found

See [`docs/documentation/DOC_LINK_VALIDATION.md`](../docs/documentation/DOC_LINK_VALIDATION.md) for detailed documentation.

## Release Gates

- `validate-fetch-runtime.ts` — Pre-publish gate ensuring `@solvapay/server/fetch` and `@solvapay/mcp/fetch` (the Web-standards subpath exports) still import cleanly on a bare Node `fetch`-only runtime (no `express`, no `node:http`, no `supabase-js`). Wired into [`publish-preview.yml`](../.github/workflows/publish-preview.yml) so a broken Web-standards build blocks the preview channel. Usage: `pnpm validate:fetch-runtime`
- `assert-stable-workspace-versions.mjs` — Pre-publish gate that fails if any non-`private`, non-changeset-ignored workspace `package.json` has a SemVer pre-release identifier (`-preview`, `-canary`, `-rc`, `-alpha`, `-beta`, `-next`, `-snapshot`) in its `version` field. Wired into [`publish.yml`](../.github/workflows/publish.yml) so `pnpm publish` never substitutes a leftover preview string into a freshly-published sibling's `dependencies` or `peerDependencies`. Usage: `node scripts/assert-stable-workspace-versions.mjs`
- `verify-npm-publishes.mjs` — Post-publish verification. Polls the npm registry until each freshly-published `name@version` resolves and, for stable releases, additionally rejects any manifest whose `dependencies` or `peerDependencies` reference a SolvaPay sibling at a pre-release version. Wired into both publish workflows. Usage: `node scripts/verify-npm-publishes.mjs --packages='[…]'`

## Dependency + Repository Management

- `check-dependency-health.ts` — `pnpm deps:check`
- `cleanup-for-public.sh` — one-off helper for preparing the repo for public release
- `setup-pre-commit-hook.sh` — sets up the doc-link pre-commit hook
- `create-missing-tag.sh` — legacy, kept for creating git tags manually (e.g. historical releases that predate changesets)
