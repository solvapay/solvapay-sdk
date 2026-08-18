---
name: SDK test folder reorg
overview: Consolidate every SDK package's test files into a top-level __tests__/ folder that mirrors the src/ subfolder structure, matching the established pattern in server/mcp/mcp-core. A one-off codemod performs the git mv plus relative-import rewrites; vitest configs and server's explicit test-file lists are updated to match.
todos:
  - id: codemod
    content: "Write scripts/reorg-tests.mjs: enumerate src test files per package, compute mirrored __tests__ destinations (strip __tests__ segments), collision-check, rewrite relative import/mock specifiers via path.relative, git mv files"
    status: pending
  - id: fixtures
    content: Move create-solvapay src/types/mcp/__fixtures__ to __tests__/types/mcp/__fixtures__ (git mv) so import.meta.url resolution keeps working
    status: pending
  - id: run-codemod
    content: Run node scripts/reorg-tests.mjs and review git status for unexpected changes
    status: pending
  - id: vitest-configs
    content: Update vitest.config.ts include globs for cli, create-solvapay, init, next, mcp-core; trim dead src globs in core, server, mcp, react
    status: pending
  - id: server-scripts
    content: Repoint moved test paths in server/package.json test, test:unit, test:integration scripts
    status: pending
  - id: verify
    content: Run per-package tests, full pnpm test, pnpm build:packages, pnpm format:check; then delete the throwaway codemod script
    status: pending
isProject: false
---

# SDK test folder reorganization

## Target convention (confirmed)

- Every package keeps tests in a single top-level `__tests__/` folder.
- Inside `__tests__/`, files mirror the `src/` subfolder path, with any existing `__tests__` segment stripped. Examples:
  - `src/utils/format.test.ts` -> `__tests__/utils/format.test.ts`
  - `src/utils/__tests__/headers.test.ts` -> `__tests__/utils/headers.test.ts`
  - `src/mcp/views/__tests__/AppHeader.test.tsx` -> `__tests__/mcp/views/AppHeader.test.tsx`
  - `src/__tests__/useTopup.test.ts` -> `__tests__/useTopup.test.ts`
- `.spec.ts` naming is preserved (files relocate, no rename).
- Source imports use the established style: `../src/...` (root) / `../../src/...` (one level deep), etc.

## What already conforms (no file moves)

- `packages/mcp` — all 8 tests already in `__tests__/` (incl. mirrored `fetch/`, `express/`).
- `packages/server`, `packages/core`, `packages/mcp-core` — already have top-level `__tests__/`; only the stragglers below move in.

## Files to move (by package)

- `auth`: `src/adapter.contract.test.ts`, `src/auth0.test.ts`, `src/constants.test.ts` -> `__tests__/`.
- `cli`: `src/cli.test.ts` -> `__tests__/cli.test.ts`; `src/commands/init.test.ts` -> `__tests__/commands/init.test.ts`.
- `core`: `src/business-details.test.ts`, `src/index.test.ts` -> `__tests__/`.
- `create-solvapay`: `src/args.test.ts`, `src/cli.test.ts` -> `__tests__/`; `src/types/mcp/*.test.ts` (6) -> `__tests__/types/mcp/`; **also move** `src/types/mcp/__fixtures__/` -> `__tests__/types/mcp/__fixtures__/` (resolved at runtime via `import.meta.url`; mirroring keeps `../../../scripts/mcp` valid).
- `init`: all 8 `src/*.test.ts` -> `__tests__/` (flat, mirrors src root).
- `mcp-core`: `src/narrate.spec.ts` -> `__tests__/narrate.spec.ts`.
- `next`: `src/helpers/__tests__/{middleware,response-shape,usage}.test.ts` -> `__tests__/helpers/`.
- `react`: all ~100 tests under `src/**` (colocated `*.test.tsx?` + nested `src/**/__tests__/**` + `src/__tests__/**`) -> `__tests__/<mirrored path>`. The existing `__tests__/types-surface.test-d.ts` and `__tests__/tsconfig.types.json` stay.
- `react-supabase`: `src/supabase-adapter.test.ts` -> `__tests__/supabase-adapter.test.ts`.
- `server`: `src/__tests__/edge-exports.test.ts` -> `__tests__/edge-exports.test.ts`; `src/helpers/{auto-recharge,balance-poll,error,payment,purchase,usage}.test.ts` -> `__tests__/helpers/`.

## Codemod (one-off, throwaway `scripts/reorg-tests.mjs`)

For each package, for each test file under `src/` (extensions `.test.ts`, `.test.tsx`, `.spec.ts`, `.spec.tsx`):

1. Compute destination: path relative to `src/`, strip any `__tests__/` segment, prefix `__tests__/`.
2. Abort if two sources collide on one destination (safety check).
3. Rewrite every **relative** specifier in `import ... from`, `export ... from`, `import(...)`, `require(...)`, `vi.mock(...)`, `vi.doMock(...)`, `vi.importActual/importMock(...)`:
   - `newSpec = relative(newDir, resolve(oldDir, spec))`, normalized to POSIX with a leading `./`.
   - Targets that are themselves moved test files keep their relative path unchanged (both shift identically); targets in `src` re-base to `../src/...`. Bare/`@solvapay/*` specifiers are untouched.
   - Preserve original quote style (single quotes) and omit file extensions as in the originals.
4. `git mv` the file (preserve history); `git mv` the `create-solvapay/.../__fixtures__` dir.
   Run with `node scripts/reorg-tests.mjs`, verify `git status`, then delete the script (not committed).

## Config + script updates

- `cli/vitest.config.ts`: include `['__tests__/**/*.test.{ts,tsx}']`.
- `create-solvapay/vitest.config.ts`: include `['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts']`.
- `init/vitest.config.ts`: include `['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts']`.
- `next/vitest.config.ts`: include `['__tests__/**/*.test.{ts,tsx}']`.
- `mcp-core/vitest.config.ts`: add `'__tests__/**/*.spec.ts'` (needed for moved `narrate.spec.ts`).
- `core`, `server`, `mcp`, `react`: trim now-dead `src/**` test globs so include only targets `__tests__/**` (react keeps its `coverage` block).
- `auth`, `react-supabase`: no config today; vitest default discovery still finds `__tests__/**`, so leave as-is.
- `server/package.json`: repoint the explicit paths in `test`, `test:unit`, `test:integration` — `src/__tests__/edge-exports.test.ts` -> `__tests__/edge-exports.test.ts`, `src/helpers/payment.test.ts` -> `__tests__/helpers/payment.test.ts`, `src/helpers/usage.test.ts` -> `__tests__/helpers/usage.test.ts` (preserve the curated set; do not add/remove other files).

## tsconfig / lint (verify, expected no change)

- Most package tsconfigs use `include: ["src"]`, so moved tests naturally leave the tsc/build scope; `server` already excludes `__tests__`. Build is via tsup entrypoints, so dist is unaffected.
- `react` `test:types` uses `__tests__/tsconfig.types.json`, which includes only `types-surface.test-d.ts` + `../src` — unaffected by moved runtime tests.
- `eslint src` scripts stop linting tests (they no longer sit in `src`); matches the current `server` behavior — acceptable, no new lint breakage.

## Verification

1. `git status` shows only expected renames + the config/script edits.
2. `pnpm -F @solvapay/<pkg> test` for each touched package (react, server, next, init, cli, create-solvapay, mcp-core, core, auth, react-supabase).
3. `pnpm test` (full monorepo) and `pnpm build:packages` green.
4. `pnpm format:check` clean on rewritten files.
5. Delete `scripts/reorg-tests.mjs`.
