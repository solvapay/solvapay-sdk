# @solvapay/core

## 1.1.1

### Patch Changes

- 349777e: Financial boundary hardening: backend `display.*` blocks are the source of truth for credit and currency rendering.
  - **`@solvapay/core`**: conversion-contract e2e extended to pin backend display formulas against the core reference.
  - **`@solvapay/react`**: `TransportBalanceResult` and `BalanceStatus` accept optional `display` from the balance API; negative `adjustBalance` schedules a grace refetch; usage demo refetches after debit.
  - **`@solvapay/server`**: `AutoRechargeConfig`, balance, and credit-debit types document backend-computed `display` blocks and `autoRecharge.triggered` as charge-initiated (not credits booked inline).

## 1.1.0

### Minor Changes

- 7a03c7f: Credit → fiat display helpers (`creditsToDisplayMinorUnits`, `minorUnitsPerMajor`, `isZeroDecimalCurrency`) now live in `@solvapay/core` so Next.js client components can import them without pulling the Node-only `@solvapay/mcp-core` server bundle. `@solvapay/mcp-core` re-exports the same symbols for backward compatibility.

## 1.0.9

### Patch Changes

- 40db2c4: Release-bot validation bump. The publish workflow ([`.github/workflows/publish.yml`](.github/workflows/publish.yml)) now mints a 60-minute installation token from the `solvapay-release-bot` GitHub App via `actions/create-github-app-token@v2` so `changesets/action` can open the "Version Packages" PR without tripping the org's `can_approve_pull_request_reviews: false` policy on the default `GITHUB_TOKEN`. This patch exists to drive a real end-to-end run through the new credential path; no code changes ship with it.

## 1.0.8

### Patch Changes

- 4b3de6a: Resync stable manifests so dependents pin to stable `@solvapay/core` and `@solvapay/auth` instead of the leftover `1.0.8-preview.10` references that the previous release accidentally baked into `@solvapay/server@1.0.9`, `@solvapay/next@1.0.8`, `@solvapay/mcp-core@0.2.1`, and `@solvapay/mcp@0.2.1`.

  The root cause was that `core`, `auth`, `solvapay` (CLI), and `react-supabase` had pre-release `1.0.8-preview.X` strings sitting in their `package.json` `version` fields on `main` (leftovers from the pre-changesets preview workflow that the migration commit never reset). Because no changeset had touched those four since the migration, changesets-action never bumped them, and `pnpm publish` substituted every `workspace:*` reference in the recently-released siblings with that literal preview string.

  This changeset:
  - Resets `core`, `auth`, `solvapay`, and `react-supabase` to the last actually-published stable (`1.0.7`) so the patch bumps below land on `1.0.8`.
  - Forces a patch bump on `server`, `next`, `mcp-core`, and `mcp` so they re-publish with their workspace dep references substituted from the now-stable `1.0.8` siblings.

  The publish workflow has also been hardened to reject any workspace package that carries a pre-release version identifier on `main` before invoking `changesets/action`, and `scripts/verify-npm-publishes.mjs` now checks each freshly-published manifest for `dependencies` / `peerDependencies` values that resolve to pre-release identifiers — both of which would have caught this regression.
