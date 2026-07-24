import { describe, expect, it } from 'vitest'
import { SHADOW_SCENARIOS } from './scenarios.js'

describe('shadow scenario live-backend readiness', () => {
  it('includes billingCycle so live recurring-plan creates succeed', () => {
    const createPlan = SHADOW_SCENARIOS.find(s => s.id === 'createPlan')
    expect(createPlan).toBeDefined()
    expect(createPlan?.args).toMatchObject({
      billingCycle: 'monthly',
      type: 'recurring',
    })
  })

  it('scopes product names with {sideTag} to avoid unique-index collisions', () => {
    for (const id of ['createProduct', 'updateProduct', 'cloneProduct']) {
      const scenario = SHADOW_SCENARIOS.find(s => s.id === id)
      expect(scenario, id).toBeDefined()
      expect(String(scenario?.args.name)).toContain('{sideTag}')
    }
  })
})
