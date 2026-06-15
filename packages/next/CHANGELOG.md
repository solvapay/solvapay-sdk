# @solvapay/next

## 1.2.0

### Minor Changes

- 2de7fd8: Add Auth0 identity adapters across `@solvapay/auth`, `@solvapay/react`, and `@solvapay/next` (`createAuth0AuthMiddleware`), plus a `next-auth0` scaffolder template. The Next.js middleware now strips client-supplied identity headers (`x-user-id`, `authorization`) before forwarding a verified session identity downstream.

### Patch Changes

- Updated dependencies [2de7fd8]
- Updated dependencies [c2a1169]
- Updated dependencies [7a03c7f]
  - @solvapay/auth@1.1.0
  - @solvapay/server@1.2.1
  - @solvapay/core@1.1.0

## 1.1.0

### Minor Changes

- 254498f: Export `processTopupPaymentIntent` from `@solvapay/next` so top-up payment intents can be processed through a dedicated server helper.

### Patch Changes

- Updated dependencies [254498f]
  - @solvapay/server@1.2.0

## 1.0.13

### Patch Changes

- Updated dependencies [26423fb]
  - @solvapay/server@1.1.1

## 1.0.12

### Patch Changes

- Updated dependencies [f0ee414]
- Updated dependencies [b53abcb]
- Updated dependencies [b53abcb]
  - @solvapay/server@1.1.0

## 1.0.11

### Patch Changes

- Updated dependencies [8dd8638]
  - @solvapay/server@1.0.12

## 1.0.10

### Patch Changes

- Updated dependencies [40db2c4]
  - @solvapay/core@1.0.9
  - @solvapay/server@1.0.11

## 1.0.9

### Patch Changes

- 4b3de6a: Resync stable manifests so dependents pin to stable `@solvapay/core` and `@solvapay/auth` instead of the leftover `1.0.8-preview.10` references that the previous release accidentally baked into `@solvapay/server@1.0.9`, `@solvapay/next@1.0.8`, `@solvapay/mcp-core@0.2.1`, and `@solvapay/mcp@0.2.1`.

  The root cause was that `core`, `auth`, `solvapay` (CLI), and `react-supabase` had pre-release `1.0.8-preview.X` strings sitting in their `package.json` `version` fields on `main` (leftovers from the pre-changesets preview workflow that the migration commit never reset). Because no changeset had touched those four since the migration, changesets-action never bumped them, and `pnpm publish` substituted every `workspace:*` reference in the recently-released siblings with that literal preview string.

  This changeset:
  - Resets `core`, `auth`, `solvapay`, and `react-supabase` to the last actually-published stable (`1.0.7`) so the patch bumps below land on `1.0.8`.
  - Forces a patch bump on `server`, `next`, `mcp-core`, and `mcp` so they re-publish with their workspace dep references substituted from the now-stable `1.0.8` siblings.

  The publish workflow has also been hardened to reject any workspace package that carries a pre-release version identifier on `main` before invoking `changesets/action`, and `scripts/verify-npm-publishes.mjs` now checks each freshly-published manifest for `dependencies` / `peerDependencies` values that resolve to pre-release identifiers — both of which would have caught this regression.

- Updated dependencies [4b3de6a]
  - @solvapay/core@1.0.8
  - @solvapay/auth@1.0.8
  - @solvapay/server@1.0.10

## 1.0.8

### Patch Changes

- Updated dependencies [0938625]
  - @solvapay/server@1.0.9
