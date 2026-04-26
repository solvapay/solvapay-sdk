import { describe, expect, it } from 'vitest'
import * as edgeEntry from '../src/edge'
import * as fetchEntry from '../src/fetch'
import * as helpers from '../src/helpers'

// Regression guard: `@solvapay/server/fetch` (and any other edge-runtime
// adapter) imports all *Core route helpers from the default
// `@solvapay/server` entry. Node resolves that to `dist/index.js`, but
// Deno / edge-light / worker resolve it to `dist/edge.js`. If `edge.ts`
// forgets to re-export a helper, adapters crash at boot with
// `does not provide an export named 'fooCore'`. This test keeps the two
// surfaces in sync for route helpers.
describe('edge entry point parity', () => {
  it('re-exports every *Core route helper from ./helpers', () => {
    const coreHelperNames = Object.keys(helpers).filter(name => name.endsWith('Core'))

    expect(coreHelperNames.length).toBeGreaterThan(0)

    const edgeExports = new Set(Object.keys(edgeEntry))
    const missing = coreHelperNames.filter(name => !edgeExports.has(name))

    expect(missing).toEqual([])
  })

  it('re-exports isErrorResult and handleRouteError from ./helpers', () => {
    expect(edgeEntry).toHaveProperty('isErrorResult')
    expect(edgeEntry).toHaveProperty('handleRouteError')
  })
})

// Second surface: the `./fetch` subpath export (folded in from
// `@solvapay/fetch` in `@solvapay/server@1.0.8`). Asserts the canonical
// set of Web-standards `(req: Request) => Promise<Response>` handlers
// resolves — protects against accidentally dropping a handler from the
// barrel during future refactors. Paired with
// `scripts/validate-fetch-runtime.ts` (runtime-level smoke test) for a
// full before-publish guarantee.
describe('fetch subpath surface', () => {
  const EXPECTED_HANDLERS = [
    'activatePlan',
    'cancelRenewal',
    'checkPurchase',
    'createCheckoutSession',
    'createCustomerSession',
    'createPaymentIntent',
    'createTopupPaymentIntent',
    'customerBalance',
    'getMerchant',
    'getPaymentMethod',
    'getProduct',
    'listPlans',
    'processPayment',
    'reactivateRenewal',
    'syncCustomer',
    'trackUsage',
  ] as const

  it.each(EXPECTED_HANDLERS)('exports %s as an async handler', name => {
    expect(fetchEntry).toHaveProperty(name)
    expect(typeof (fetchEntry as Record<string, unknown>)[name]).toBe('function')
  })

  it('exports the solvapayWebhook factory + configureCors helper', () => {
    expect(typeof fetchEntry.solvapayWebhook).toBe('function')
    expect(typeof fetchEntry.configureCors).toBe('function')
  })
})
