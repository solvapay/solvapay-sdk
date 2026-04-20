---
name: sdk-create-customer-response-mapping
overview: "Fix `SolvaPayClient.createCustomer` to map the backend's `{ reference, ... }` response into the `{ customerRef }` shape its type declares, matching the pattern already used by `updateCustomer` and `getCustomer`. Direct callers currently get `customerRef: undefined`; the paywall hides the bug internally."
todos:
  - id: fix-client
    content: ''
    status: completed
  - id: simplify-test
    content: ''
    status: completed
  - id: unit-coverage
    content: ''
    status: completed
  - id: verify
    content: ''
    status: completed
  - id: open-pr
    content: ''
    status: completed
isProject: false
---

# Fix `SolvaPayClient.createCustomer` response mapping

## Background

`POST /v1/sdk/customers` returns `{ reference, name, email, externalRef?, purchases? }` (see `CustomerResponse` in [generated.ts#L1642](solvapay-sdk/packages/server/src/types/generated.ts)). The hand-typed SDK interface declares the return as `Promise<{ customerRef: string }>` ([types/client.ts#L151](solvapay-sdk/packages/server/src/types/client.ts)), but [client.ts#L119-L136](solvapay-sdk/packages/server/src/client.ts) returns the raw `result` without remapping — so any integrator calling `apiClient.createCustomer()` directly gets `customerRef: undefined`.

The paywall's `ensureCustomer` hides the bug internally with a fallback ([paywall.ts#L450-L451](solvapay-sdk/packages/server/src/paywall.ts)):

```ts
const resultObj = result as unknown as Record<string, string>
const ref = resultObj.customerRef || resultObj.reference || customerRef
```

`updateCustomer` ([client.ts#L138-L158](solvapay-sdk/packages/server/src/client.ts)) and `getCustomer` ([client.ts#L220-L229](solvapay-sdk/packages/server/src/client.ts)) already map `reference → customerRef` at the client boundary. `createCustomer` is the odd one out.

Caught while writing integration coverage for the [customer externalRef backfill PR](https://github.com/solvapay/solvapay-sdk/pull/107); the integration test had to ship a `refOf()` workaround ([customer-update.integration.test.ts#L39-L55](solvapay-sdk/packages/server/__tests__/customer-update.integration.test.ts)).

## Scope

**In scope** (one implementation change + test tidy):

- [`packages/server/src/client.ts`](solvapay-sdk/packages/server/src/client.ts) — `createCustomer`
- [`packages/server/__tests__/customer-update.integration.test.ts`](solvapay-sdk/packages/server/__tests__/customer-update.integration.test.ts) — drop `refOf()` helper + disclaimer comment
- New minimal unit test next to `ensure-customer.unit.test.ts`

**Out of scope** (flag but don't widen here):

- Widening the return type from `{ customerRef: string }` to `CustomerResponseMapped` (`email`, `name`, `externalRef`, `purchases`). The backend already returns these; exposing them is additive and useful, but it's a public API surface change that warrants its own PR and a SemVer note. Leaving the narrow shape preserves bug-for-bug compatibility with anyone who relied on the return being destructurable to `{ customerRef }` only. Note this as a follow-up.
- Removing the `ensureCustomer` fallback (`customerRef || reference`). The fallback is harmless and defends against third-party `SolvaPayClient` implementations that might not normalize. Leave it.
- The `factory.ts` `solvaPay.createCustomer()` pass-through ([factory.ts#L772-L777](solvapay-sdk/packages/server/src/factory.ts)) — after the client fix, the pass-through correctly returns the declared shape. No code change needed.

## The fix

Mirror the `updateCustomer` mapping pattern exactly:

```ts
// packages/server/src/client.ts — createCustomer (~L119)
async createCustomer(params) {
  const url = `${base}/v1/sdk/customers`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  })

  if (!res.ok) {
    const error = await res.text()
    log(`❌ API Error: ${res.status} - ${error}`)
    throw new SolvaPayError(`Create customer failed (${res.status}): ${error}`)
  }

  const result = await res.json()
  return {
    customerRef: result.reference || result.customerRef,
  }
},
```

Identical to the last 4 lines of `updateCustomer` — intentional consistency.

## Test changes

### 1. Simplify `customer-update.integration.test.ts`

Delete the `refOf()` helper and its disclaimer comment. Replace every `refOf(await apiClient.createCustomer!({...}))` with `(await apiClient.createCustomer!({...})).customerRef`. Three call sites, ~5 lines net removed.

### 2. Add a tiny unit test

New `packages/server/__tests__/create-customer.unit.test.ts` — mocks `fetch` to return `{ reference: 'cus_xyz', email, name }`, asserts `apiClient.createCustomer({...})` resolves to `{ customerRef: 'cus_xyz' }`. Guards against regression if someone removes the map.

Shape (reuse patterns from `ensure-customer.unit.test.ts`):

```ts
it('maps backend reference → customerRef', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reference: 'cus_xyz', email: 'a@b.c', name: 'A' }),
    }),
  )
  const client = createSolvaPayClient({ apiKey: 'sk_test', apiBaseUrl: 'http://x' })
  await expect(client.createCustomer!({ email: 'a@b.c', metadata: {} })).resolves.toEqual({
    customerRef: 'cus_xyz',
  })
})
```

Register it in the `test:unit` script list in [packages/server/package.json#L43](solvapay-sdk/packages/server/package.json) alongside the other `.unit.test.ts` files.

## Verify

```bash
cd packages/server
pnpm test:unit                                                    # 80 tests (79 + 1 new)
USE_REAL_BACKEND=true pnpm exec vitest run \
  __tests__/customer-update.integration.test.ts                   # 4 green against local backend
pnpm -w build                                                     # turbo build all packages
```

No backend change, no regen. This is a pure SDK implementation fix.

## PR

Branch: `fix/create-customer-response-mapping` off `dev`.

Commit (single commit is fine, changes are tiny and related):

- `fix(server): map POST /v1/sdk/customers reference → customerRef`

PR body skeleton:

```md
## Summary

`apiClient.createCustomer()` was returning the raw backend payload
(`{ reference, ... }`) while the declared return type promises
`{ customerRef }`. Direct callers got `customerRef: undefined`;
`ensureCustomer` hid it internally via a `reference || customerRef`
fallback. Aligns with `updateCustomer` and `getCustomer`, which have
always mapped at the client boundary.

## Test plan

- [x] New unit test: `createCustomer` maps `reference → customerRef`
- [x] `customer-update.integration.test.ts` simplified — no more `refOf()`
- [x] All 80 server unit tests green
- [x] 4 customer-update integration tests green against local backend
```

## Risk

- Behavioural change is from `undefined` to a real value on a property that was typed as `string` — integrators relying on `undefined` would already be crashing, so there's effectively no one to break.
- The response body drops `email`, `name`, `externalRef`, `purchases` compared to returning the raw object. If anyone ignored the declared type and read those off the result, they'd lose them. Low likelihood (raw shape is undocumented and types tell them not to), but it's the only real risk surface. Widening to `CustomerResponseMapped` as a follow-up eliminates this concern.

## Follow-ups (explicitly deferred)

- Widen `createCustomer`'s return to `CustomerResponseMapped` for symmetry with `getCustomer`. Small, additive, one-line type change + one implementation line. Separate PR so the SemVer framing is clean.
- Drop the `customerRef || reference` fallback in `paywall.ts` `ensureCustomer` once the widened type lands and we're confident no third-party `SolvaPayClient` shims are in the wild. Can be part of the 1.1 cleanup.
