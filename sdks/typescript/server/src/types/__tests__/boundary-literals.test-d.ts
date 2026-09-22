/**
 * Pins Charge.per, BillingCycle.interval, and disableAutoRecharge success
 * to the published npm baseline (core@1.5.0 / server@2.2.1).
 *
 * Run: pnpm --filter @solvapay/server test:types
 */

import { describe, expectTypeOf, it } from 'vitest'
import type { BillingCycleLike, ChargeLike } from '@solvapay/core'
import type { SolvaPayClient } from '../client'

describe('boundary literals vs published npm baseline', () => {
  it('ChargeLike.per is the closed charge-basis union', () => {
    expectTypeOf<ChargeLike['per']>().toEqualTypeOf<'flat' | 'unit' | 'seat'>()
  })

  it('BillingCycleLike.interval is the closed interval union', () => {
    expectTypeOf<BillingCycleLike['interval']>().toEqualTypeOf<'week' | 'month' | 'year'>()
  })

  it('disableAutoRecharge resolves to { success: true }', () => {
    expectTypeOf<
      Awaited<ReturnType<NonNullable<SolvaPayClient['disableAutoRecharge']>>>
    >().toEqualTypeOf<{ success: true }>()
  })
})
