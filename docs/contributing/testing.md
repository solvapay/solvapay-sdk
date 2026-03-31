# SDK testing guide (contributors)

This page is for contributors testing code inside the `solvapay-sdk` monorepo.

## Testing layers

- Unit tests: package-level behavior with isolated mocks/stubs
- Integration tests: end-to-end flows across adapters and HTTP handlers
- Example validation: verify runnable examples stay in sync with package APIs

## Stub mode

Use stub mode for deterministic local and CI testing without real API credentials.

```ts
import { createSolvaPay } from '@solvapay/server'

// No API key => stub mode
const solvaPay = createSolvaPay()
```

You can also inject a custom stub client when you need tighter control over limits,
storage, or artificial delay behavior.

## Recommended patterns

- Create a fresh client in `beforeEach` to keep tests isolated
- Keep free-tier limits small in tests (for example `1-5`) to exercise paywall paths quickly
- Assert structured paywall error fields (not only message text)
- Use in-memory storage by default for speed and reliability

## What to test

- purchase checks and limit checks
- customer resolution and creation paths
- paywall errors and checkout URL generation
- usage event tracking behavior
- framework adapters (`http`, `next`, and `mcp`)

## Local commands

```bash
pnpm test
pnpm -F @solvapay/server test
pnpm -F @solvapay/react test
```

## CI expectations

Before opening a PR, make sure:

- all relevant package tests pass
- docs links are valid (`pnpm docs:validate-links`)
- any new behavior has coverage in unit or integration tests

## Where to read next

- `CONTRIBUTING.md` for contributor workflow
- `examples/` for runnable integration references
- `packages/*/README.md` for package-specific usage constraints
