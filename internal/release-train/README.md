# `@solvapay/release-train`

Private Changesets sentinel. Its `version` is the unified SDK surface version
for npm group members plus Rust, Python, Ruby, and Go. It is never published
to npm.

Author changesets against this package. `pnpm changeset:version` runs
`tools/repo/sync-release-train.ts`, which stamps this version into the
language manifests. Do not hand-edit those files.
