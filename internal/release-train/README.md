# `@solvapay/release-train`

Private Changesets sentinel. Its `version` is the lockstep release-train
version for Rust, Python, Ruby, and Go. It is never published to npm.

`pnpm changeset:version` runs `tools/repo/sync-release-train.ts`, which stamps
this version into the language manifests. Do not hand-edit those files.
