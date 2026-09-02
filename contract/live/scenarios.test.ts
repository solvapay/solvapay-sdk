import { describe, expect, it } from 'vitest'
import { LIVE_SCENARIOS } from './scenarios.js'

describe('live scenario live-backend readiness', () => {
  it('uses composable options[] for live recurring-plan creates', () => {
    const createPlan = LIVE_SCENARIOS.find(s => s.id === 'createPlan')
    expect(createPlan).toBeDefined()
    expect(createPlan?.args).toMatchObject({
      currency: 'usd',
      options: [
        { kind: 'billingCycle', interval: 'month' },
        { kind: 'charge', per: 'flat', amountMinor: 1000, currency: 'usd' },
      ],
    })
    expect(createPlan?.args).not.toHaveProperty('billingCycle')
    expect(createPlan?.args).not.toHaveProperty('type')
    expect(createPlan?.args).not.toHaveProperty('price')
  })

  it('scopes product names with {sideTag} to avoid unique-index collisions', () => {
    for (const id of ['createProduct', 'updateProduct', 'cloneProduct']) {
      const scenario = LIVE_SCENARIOS.find(s => s.id === id)
      expect(scenario, id).toBeDefined()
      expect(String(scenario?.args.name)).toContain('{sideTag}')
    }
  })
})
