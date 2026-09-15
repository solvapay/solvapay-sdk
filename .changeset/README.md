# Changesets

Versioning is owned by [Changesets](https://github.com/changesets/changesets).

## Core SDK surface

Target **`@solvapay/release-train`** only. The `fixed` group in `config.json`
fans that bump to `@solvapay/core`, `@solvapay/server`, `@solvapay/mcp`,
`@solvapay/mcp-core`, `@solvapay/server-native`, and `@solvapay/server-wasm`.
`pnpm gen` writes `.changeset/core-surface.md` from the contract snapshots
against the last `vX.Y.Z` tag. A hand-written sentinel changeset can raise
the bump. Do not name a group member in frontmatter.

## Independent packages

`@solvapay/react`, `@solvapay/next`, `@solvapay/auth`,
`@solvapay/react-supabase`, `solvapay` (CLI), `create-solvapay`, and
`@solvapay/init` stay on their own versions. Name those packages directly.

## Workflow

- Run `pnpm changeset` for user-visible changes (sentinel for the core
  surface, the package name for independents).
- Dispatch `.github/workflows/publish-preview.yml` with `dry_run=false` to
  publish a `@preview` snapshot. Merges to `dev` do not publish.
- On merges to `main`, `changesets/action` opens / updates a "Version
  Packages" PR; merging that PR publishes stable releases and pushes `v<version>`.
