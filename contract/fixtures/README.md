# Golden fixtures

JSON behavioral fixtures for the Rust core SDK migration (Phase 0 / Steps 3–7).

Each fixture is replayed by the TypeScript harness in `scripts/lib/fixture-harness.ts` against the current `@solvapay/server` SDK. Later phases reuse the same files in Rust / Python / Ruby / Go runners.

## Format (§5.3)

```json
{
  "suite": "webhook-verification",
  "case": "accept",
  "input": {
    "fn": "verifyWebhook",
    "args": {},
    "clock": "2026-07-01T00:00:00Z",
    "rngSeed": 42
  },
  "wire": {
    "request": { "method": "POST", "path": "/v1/sdk/...", "headers": {}, "body": {} },
    "response": { "status": 200, "body": {} }
  },
  "expect": {
    "result": {}
  }
}
```

| Field | Role |
| --- | --- |
| `suite` / `case` | Identity; directory layout mirrors suite names |
| `input.fn` | Registry key → SDK binding(s) |
| `input.args` | Arguments passed to the binding |
| `input.clock` | ISO-8601 UTC; harness patches `Date.now` |
| `input.rngSeed` | Seed for deterministic `Math.random` (idempotency keys) |
| `wire` | Optional mock-transport block for client methods |
| `expect.result` / `expect.error` | Exactly one; error asserts `name` + byte-exact `message` (+ `status` when set) |

`expect.error.kind` / `expect.error.code` are Rust-era taxonomy fields carried for later runners; the TS harness does not invent or assert them.

## Run

```bash
# Build packages first (harness imports @solvapay/server dist)
pnpm build:packages

# Full contract suite (OpenAPI + manifest + fixtures)
pnpm test:contract

# Fixture discovery + replay only
pnpm exec vitest run scripts/contract-fixtures.test.ts
```

## Webhook verification (Step 4 / §6.1)

Shared clock `2026-07-01T00:00:00Z` (epoch `1782864000`), secret `whsec_test_fixture_secret`. Every webhook fixture is replayed against **both** Node (`node:crypto`, sync) and Edge (Web Crypto, async) `verifyWebhook` bindings registered under `input.fn: "verifyWebhook"`.

| Path | Axis |
| --- | --- |
| `webhook-verification/accept.json` | Happy path HMAC accept |
| `webhook-verification/accept-extra-comma-parts.json` | Extra `,v0=...` parts ignored (first `t=` / `v1=` win) |
| `webhook-verification/accept-boundary-past-299s.json` | `t = now - 299` accept |
| `webhook-verification/accept-boundary-future-299s.json` | `t = now + 299` accept |
| `webhook-verification/accept-boundary-300s.json` | `t = now - 300` accept (`age > 300` is the reject) |
| `webhook-verification/missing-signature.json` | `missing_signature` |
| `webhook-verification/malformed-signature-*.json` | `malformed_signature` (no parts / missing `v1` / missing `t` / non-numeric `t` / empty `v1`) |
| `webhook-verification/timestamp-too-old.json` | `timestamp_too_old` (`now - 301`) |
| `webhook-verification/timestamp-too-old-future-301s.json` | `timestamp_too_old` (`now + 301`; age uses `Math.abs`) |
| `webhook-verification/invalid-signature-*.json` | `invalid_signature` (wrong HMAC / non-hex `v1` / length mismatch) |
| `webhook-verification/invalid-payload-*.json` | `invalid_payload` (non-JSON body / empty body, valid HMAC) |

## Client sample (Step 3)

| Path | Proves |
| --- | --- |
| `client/create-payment-intent-success.json` | Mock transport + seeded RNG idempotency key |

Steps 5–7 own the full fixture sets for retries, paywall, and all 36 client methods.
