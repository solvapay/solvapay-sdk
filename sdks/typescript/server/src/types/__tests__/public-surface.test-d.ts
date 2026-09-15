/**
 * Pins the published @solvapay/server@2.2.1 / @solvapay/core@1.5.0 public
 * surface so Phase 4 rewrites stay additive-only.
 *
 * Snapshot was seeded from `npm pack` tarballs via the TypeScript compiler API
 * (see public-surface.snapshot.json). Charge.per / BillingCycle.interval /
 * disableAutoRecharge are already pinned in boundary-literals.test-d.ts.
 *
 * Run: pnpm --filter @solvapay/server test:types
 */

import { describe, expectTypeOf, it } from 'vitest'
import type { createSolvaPay, CreateSolvaPayConfig, SolvaPay } from '../../factory'

const _FROZEN_SOLVAPAY_METHODS = [
  'payable',
  'ensureCustomer',
  'createPaymentIntent',
  'createTopupPaymentIntent',
  'processPaymentIntent',
  'attachBusinessDetails',
  'checkLimits',
  'trackUsage',
  'trackUsageBulk',
  'createCustomer',
  'getCustomer',
  'assignCredits',
  'getCustomerBalance',
  'createCheckoutSession',
  'createCustomerSession',
  'activatePlan',
  'bootstrapMcpProduct',
  'configureMcpPlans',
  'getVirtualTools',
  'registerVirtualToolsMcp',
  'paywall',
  'apiClient',
] as const

const _FROZEN_CREATE_CONFIG = ['apiKey', 'apiClient', 'apiBaseUrl', 'limitsCacheTTL'] as const

type FrozenSolvaPayMethod = (typeof _FROZEN_SOLVAPAY_METHODS)[number]
type FrozenCreateConfig = (typeof _FROZEN_CREATE_CONFIG)[number]

describe('published public surface is additive-only', () => {
  it('createSolvaPay() still returns SolvaPay', () => {
    expectTypeOf<ReturnType<typeof createSolvaPay>>().toExtend<SolvaPay>()
  })

  it('frozen SolvaPay methods remain on the current interface (superset)', () => {
    expectTypeOf<FrozenSolvaPayMethod>().toExtend<keyof SolvaPay>()
  })

  it('frozen createSolvaPay() options remain (superset, including limitsCacheTTL)', () => {
    expectTypeOf<FrozenCreateConfig>().toExtend<keyof CreateSolvaPayConfig>()
  })

  it('ensureCustomer keeps the published positional signature', () => {
    expectTypeOf<SolvaPay['ensureCustomer']>().toEqualTypeOf<
      (
        customerRef: string,
        externalRef?: string,
        options?: { email?: string; name?: string },
      ) => Promise<string>
    >()
  })

  it('createSolvaPay() instance exposes that same ensureCustomer signature', () => {
    expectTypeOf<ReturnType<typeof createSolvaPay>['ensureCustomer']>().toEqualTypeOf<
      SolvaPay['ensureCustomer']
    >()
  })
})
