# Golden fixtures

JSON behavioral fixtures for the Rust core SDK migration (Phase 0 / Steps 3–7, plus Phase 1 business-details / credit-display / seller-identity / retry-schedule).

Each fixture is replayed by the TypeScript harness in `scripts/lib/fixture-harness.ts` against `@solvapay/server` and `@solvapay/core`. The Rust `fixture-runner` replays bound suites against `solvapay-core` (retry schedules use a host-side adapter that records callback/sleep observations without sleeping); unbound suites are skipped.

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

| Field                            | Role                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `suite` / `case`                 | Identity; directory layout mirrors suite names                                 |
| `input.fn`                       | Registry key → SDK binding(s)                                                  |
| `input.args`                     | Arguments passed to the binding                                                |
| `input.clock`                    | ISO-8601 UTC; harness patches `Date.now`                                       |
| `input.rngSeed`                  | Seed for deterministic `Math.random` (idempotency keys)                        |
| `wire`                           | Optional mock-transport block for client methods                               |
| `expect.result` / `expect.error` | Exactly one; error asserts `name` + byte-exact `message` (+ `status` when set) |

`expect.error.kind` / `expect.error.code` are Rust-era taxonomy fields carried for later runners; the TS harness does not invent or assert them.

## Run

```bash
# Build packages first (harness imports @solvapay/server + @solvapay/core dist)
pnpm build:packages

# Full contract suite (OpenAPI + manifest + fixtures)
pnpm test:contract

# Fixture discovery + replay only
pnpm exec vitest run scripts/contract-fixtures.test.ts

# Rust runner (bound pure-core suites incl. error-model; unbound suites skipped).
# Retry fixtures simulate shouldRetry / onRetry / sleep host-side.
cd rust && cargo run -q -p fixture-runner -- ../contract/fixtures
```

## Error model (Step 17 / §4.4)

Construction + mapping fixtures for `SdkError` / TS `SolvaPayError` + `PaywallError`. Binding: `constructSdkError` (`kind`: `Api` | `Webhook` | `Paywall` | `Transport`). Rust asserts `kind`/`code` when present; TS ignores those fields by design.

| Path                                         | Axis                                        |
| -------------------------------------------- | ------------------------------------------- |
| `error-model/api/check-limits-template.json` | `{status}` / `{body}` template render       |
| `error-model/api/external-ref-case.json`     | named `{externalRef}` case template         |
| `error-model/webhook/*.json`                 | five stable webhook codes + frozen messages |
| `error-model/paywall/*.json`                 | `PaywallError` + gate attached              |
| `error-model/transport/*.json`               | retryable / non-retryable transport         |

## Webhook verification (Step 4 / §6.1)

Shared clock `2026-07-01T00:00:00Z` (epoch `1782864000`), secret `whsec_test_fixture_secret`. Every webhook fixture is replayed against **both** Node (`node:crypto`, sync) and Edge (Web Crypto, async) `verifyWebhook` bindings registered under `input.fn: "verifyWebhook"`.

| Path                                                      | Axis                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `webhook-verification/accept.json`                        | Happy path HMAC accept                                                                       |
| `webhook-verification/accept-extra-comma-parts.json`      | Extra `,v0=...` parts ignored (first `t=` / `v1=` win)                                       |
| `webhook-verification/accept-boundary-past-299s.json`     | `t = now - 299` accept                                                                       |
| `webhook-verification/accept-boundary-future-299s.json`   | `t = now + 299` accept                                                                       |
| `webhook-verification/accept-boundary-300s.json`          | `t = now - 300` accept (`age > 300` is the reject)                                           |
| `webhook-verification/missing-signature.json`             | `missing_signature`                                                                          |
| `webhook-verification/malformed-signature-*.json`         | `malformed_signature` (no parts / missing `v1` / missing `t` / non-numeric `t` / empty `v1`) |
| `webhook-verification/timestamp-too-old.json`             | `timestamp_too_old` (`now - 301`)                                                            |
| `webhook-verification/timestamp-too-old-future-301s.json` | `timestamp_too_old` (`now + 301`; age uses `Math.abs`)                                       |
| `webhook-verification/invalid-signature-*.json`           | `invalid_signature` (wrong HMAC / non-hex `v1` / length mismatch)                            |
| `webhook-verification/invalid-payload-*.json`             | `invalid_payload` (non-JSON body / empty body, valid HMAC)                                   |

## Client methods (Step 7 / §2.3)

Golden request/response fixtures for every one of the 36 `SolvaPayClient` methods. Layout: `client/<method-kebab>/<case>.json`. Shared clock `2026-07-01T00:00:00Z` (epoch ms `1782864000000`); set `rngSeed: 42` only on auto-generated idempotency-key fixtures (`random9` → `ln13h9a6y`). Auth: `Authorization: Bearer sk_test_fixture`.

Harness extras for this suite: `wire.request.query` capture/assertion, verbatim string response bodies (so `{body}` and invalid-JSON branches match), and `deleteProduct`/`deletePlan` invokers coerce `undefined → null`.

| Axis                                    | Coverage                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Simple methods                          | `success` + `error` each (`Check limits`, `Track usage`, … default `{Prefix} failed ({status}): {body}`)                             |
| `createCustomer` / `updateCustomer`     | `reference→customerRef` map + fallback variants                                                                                      |
| `getCustomer`                           | by-`customerRef`, by-`externalRef` (direct / array / `{customers}` / `{customer}`), by-`email`, no-match, missing-params, HTTP error |
| `assignCredits`                         | forwarded `Idempotency-Key` + omitted variant + error                                                                                |
| `getProduct`                            | `{ ...data, ...result }` merge                                                                                                       |
| `listProducts`                          | bare array, `{products}`, nested `data` unwrap                                                                                       |
| `listPlans`                             | bare array, `{plans}`, `plan.price ?? data.price` with `data` deleted                                                                |
| `deleteProduct` / `deletePlan`          | success (`result: null`), 404-as-success, non-404 error                                                                              |
| `createPaymentIntent`                   | auto key `payment-{planRef}-{epoch}-{random9}`, caller key, `currency` spread                                                        |
| `createTopupPaymentIntent`              | auto key `topup-{epoch}-{random9}`, `autoRecharge` spread                                                                            |
| `processPaymentIntent`                  | all 7 `ProcessPaymentResult` branches + error                                                                                        |
| `cancelPurchase` / `reactivatePurchase` | nested `{purchase}`, flat `{reference}`, 404, 400, invalid-JSON, generic error                                                       |

## Retry schedule (Step 5 / §6.2)

Captures `withRetry` from `@solvapay/server` (`utils.ts`). Fixtures assert the **computed delay sequence** and callback ordering — never wall-clock time. The harness patches `globalThis.setTimeout` to record each `ms` and fire the callback immediately.

Every retry fixture uses `expect.result` (never `expect.error`). Terminal rejection is folded into the observation's `outcome` so the contract stays language-neutral.

### Scenario spec (`input.args`)

| Field         | Shape                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| `attempts`    | Array of `{ "resolve": <any> }`, `{ "throw": "<message>" }`, or `{ "throwRaw": <any> }` |
| `options`     | Optional `{ maxRetries?, initialDelay?, backoffStrategy? }` (omit to exercise defaults) |
| `shouldRetry` | Omit \| `"always"` \| `"never"` \| `{ "vetoAt": [<attempt>...] }`                       |
| `onRetry`     | Omit \| `true` (pass a recording callback)                                              |

### Observation (`expect.result`)

```json
{
  "delays": [500, 500],
  "events": ["call:0", "onRetry:0", "sleep:500", "call:1", "onRetry:1", "sleep:500", "call:2"],
  "outcome": { "type": "rejected", "name": "Error", "message": "boom" }
}
```

Event vocabulary (program order): `call:<attempt>`, `shouldRetry:<attempt>=<true|false>`, `onRetry:<attempt>`, `sleep:<ms>`.

| Path                                                             | Axis                                    |
| ---------------------------------------------------------------- | --------------------------------------- |
| `retry-schedule/immediate-success.json`                          | Defaults; resolve on first call         |
| `retry-schedule/fixed-success-after-one-retry.json`              | Fixed backoff; success after one retry  |
| `retry-schedule/fixed-exhausted.json`                            | Fixed; all attempts throw               |
| `retry-schedule/maxretries-zero-immediate-throw.json`            | `maxRetries: 0` edge                    |
| `retry-schedule/linear-delays.json`                              | Linear: `d*(attempt+1)`                 |
| `retry-schedule/exponential-delays.json`                         | Exponential: `d*2^attempt`              |
| `retry-schedule/should-retry-veto-*.json`                        | `shouldRetry` short-circuit             |
| `retry-schedule/should-retry-not-consulted-on-last-attempt.json` | Last attempt skips `shouldRetry`        |
| `retry-schedule/on-retry-ordering.json`                          | `onRetry` after decision, before sleep  |
| `retry-schedule/should-retry-and-on-retry-ordering.json`         | Combined callback ordering              |
| `retry-schedule/non-error-throwable-*.json`                      | Non-`Error` wrapped via `String(error)` |

## Business details (Step 9)

Captures `@solvapay/core` helpers: `validateBusinessDetails`, `deriveTaxIdType`, `resolveTaxBehavior`, `getTaxIdExample` / `getTaxIdFieldLabel` / `getTaxIdHelperText`, and `getBusinessCountryOptions` (locks `BUSINESS_COUNTRY_OPTIONS` sort). Pure fixtures — no `wire` block; `expect.result` only. Absent optional fields are omitted (never `null`).

| Path                                                        | `input.fn`                                                      | Axis                                                                                                                                                                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `business-details/validate/*.json`                          | `validateBusinessDetails`                                       | Non-business / business happy paths, unsupported countries, invalid tax ID, Zod `too_big` default message (`customer-name-too-big-zod-default-message`), normalization, skip-absent outputs, `taxIdType` derivation |
| `business-details/tax-id-by-country/*-{accept,reject}.json` | `validateBusinessDetails`                                       | Accept (`TAX_ID_EXAMPLE_BY_COUNTRY`) + one reject per each of 29 countries                                                                                                                                          |
| `business-details/derive-tax-id-type/*.json`                | `deriveTaxIdType`                                               | `eu_vat` / `gb_vat` / `us_ein`                                                                                                                                                                                      |
| `business-details/tax-behavior/*.json`                      | `resolveTaxBehavior`                                            | `auto`+USD/CAD → exclusive, `auto`+EUR → inclusive, explicit passthrough, lowercase currency                                                                                                                        |
| `business-details/labels/*.json`                            | `getTaxIdExample` / `getTaxIdFieldLabel` / `getTaxIdHelperText` | Per tax-ID type copy + Greece `EL` example                                                                                                                                                                          |
| `business-details/country-options.json`                     | `getBusinessCountryOptions`                                     | LocaleCompare ordering of display labels                                                                                                                                                                            |

## Credit display (Step 10)

Captures `@solvapay/core` helpers: `minorUnitsPerMajor`, `isZeroDecimalCurrency`, `creditsToDisplayMinorUnits`. Pure fixtures — no `wire` block. When `creditsPerMinorUnit <= 0`, `expect.result` is JSON `null` (not omitted).

| Path                                 | `input.fn`                   | Axis                                                                                                            |
| ------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `credit-display/minor-units/*.json`  | `minorUnitsPerMajor`         | 100 vs 1 (zero-decimal), case-insensitive currency                                                              |
| `credit-display/zero-decimal/*.json` | `isZeroDecimalCurrency`      | True for JPY/KRW, false for USD                                                                                 |
| `credit-display/convert/*.json`      | `creditsToDisplayMinorUnits` | SEK/USD/EUR/JPY conversions, half-up rounding, zero/negative credits, CPM ≤ 0 → `null`, rate `0` → treat as `1` |

## Seller identity (Step 10)

Captures `@solvapay/core` helpers: `SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE`, `getSellerTaxIdentifierDisplayLabel`, `resolveSellerIdentityDisplay`. Pure fixtures — no `wire` block. Unlike paywall skip-absent, absent identity rows are emitted as JSON `null` (`"taxIdentifier": null` / `"companyNumber": null`).

| Path                                     | `input.fn`                                    | Axis                                                                                      |
| ---------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `seller-identity/label-map/by-type.json` | `SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE` | Full `eu_vat` / `gb_vat` / `us_ein` map                                                   |
| `seller-identity/labels/*.json`          | `getSellerTaxIdentifierDisplayLabel`          | VAT / EIN / Tax ID fallback; lowercase country; null country                              |
| `seller-identity/resolve/*.json`         | `resolveSellerIdentityDisplay`                | EU/GB/US/CA value selection, company dedupe, whitespace-only → absent, explicit null rows |

## Paywall (Step 6 / §6.3)

Captures the five pure paywall helpers from `@solvapay/server`. Fixtures use `expect.result` only (these functions never throw). Conditionally-spread fields (`plans` / `balance` / `productDetails` / `confirmationUrl`) are **omitted** from `expect.result` when absent — `deepStrictEqual` locks the “never emit null for absent fields” rule.

| Path                            | `input.fn`                               | Axis                                                                                                                                                      |
| ------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paywall/classification/*.json` | `classifyPaywallState`                   | Full precedence table + older-backend fallbacks (`null` limits, nested/top-level credit channels, `remaining === 0`, balance-block proxy, plan list miss) |
| `paywall/gate/*.json`           | `buildPaywallGate`                       | Activation vs payment branches, PAYG-topup reclassification, conditional field presence/absence, `plan ?? ''` fallback                                    |
| `paywall/messages/*.json`       | `buildGateMessage` / `buildNudgeMessage` | Byte-exact copy: all kinds × url/no-url, reactivation omits open-clause, null-limits nudge                                                                |
| `paywall/client-payload/*.json` | `paywallErrorToClientPayload`            | Activation/payment × full/minimal conditional fields                                                                                                      |
