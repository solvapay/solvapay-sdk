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

## Real-backend integration (`@solvapay/server`)

These suites hit a live platform. Point them at the provider-app proxy on
`:3010` — not identity-service on `:3001`.

```bash
# packages/server/.env
USE_REAL_BACKEND=true
SOLVAPAY_SECRET_KEY=sk_sandbox_...
SOLVAPAY_API_BASE_URL=http://localhost:3010
STRIPE_TEST_SECRET_KEY=sk_test_...   # payment suite only
```

```bash
pnpm --filter @solvapay/server test:integration
pnpm --filter @solvapay/server test:integration:payment
```

### Stripe webhook E2E

`ENABLE_WEBHOOK_TESTS=true` turns on the payment-suite case that confirms a
test card, waits for the Stripe webhook to book credits, then exercises a
protected handler.

**Preferred (ngrok, no Stripe CLI):** run the platform with `ngrok.yml` so
Stripe delivers to `https://api.<subdomain>.ngrok.app/v1/webhooks/stripe`.
Do not also run `stripe listen` — that duplicates every event.

```bash
# from ../platform, with ngrok.yml configured
pnpm run dev

# from packages/server
ENABLE_WEBHOOK_TESTS=true pnpm test:integration:payment
```

**Fallback (no tunnels):** forward with the Stripe CLI to payment-service.

```bash
stripe listen --forward-to localhost:3003/v1/webhooks/stripe
ENABLE_WEBHOOK_TESTS=true pnpm test:integration:payment
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
