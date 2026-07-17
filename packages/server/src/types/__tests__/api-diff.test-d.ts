/**
 * API-diff: mutual assignability between hand-written SolvaPayClient and
 * generated SolvaPayClientGenerated (step 18).
 *
 * Run: pnpm --filter @solvapay/server test:types
 */

import { describe, expectTypeOf, it } from 'vitest'
import type { SolvaPayClient } from '../client'
import type { SolvaPayClientGenerated } from '../client.generated'

type Hand = SolvaPayClient
type Gen = SolvaPayClientGenerated

describe('SolvaPayClient ↔ SolvaPayClientGenerated API-diff', () => {
  it('shares the same method keys', () => {
    expectTypeOf<keyof Hand>().toEqualTypeOf<keyof Gen>()
  })

  it('checkLimits is mutually assignable', () => {
    expectTypeOf<Hand['checkLimits']>().toExtend<Gen['checkLimits']>()
    expectTypeOf<Gen['checkLimits']>().toExtend<Hand['checkLimits']>()
  })

  it('updateCustomer positional params are mutually assignable', () => {
    expectTypeOf<Hand['updateCustomer']>().toExtend<Gen['updateCustomer']>()
    expectTypeOf<Gen['updateCustomer']>().toExtend<Hand['updateCustomer']>()
  })

  it('optional getMerchant remains optional on both sides', () => {
    type HandOpt = undefined extends Hand['getMerchant'] ? true : false
    type GenOpt = undefined extends Gen['getMerchant'] ? true : false
    expectTypeOf<HandOpt>().toEqualTypeOf<true>()
    expectTypeOf<GenOpt>().toEqualTypeOf<true>()
  })

  it('interfaces are mutually assignable (drop-in compatible)', () => {
    expectTypeOf<Hand>().toExtend<Gen>()
    expectTypeOf<Gen>().toExtend<Hand>()
  })
})
