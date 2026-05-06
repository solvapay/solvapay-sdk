import { describe, it, expect } from 'vitest'
import { buildPaywallGate } from '../src/paywall-gate'
import type { LimitResponseWithPlan } from '../src/types'

describe('buildPaywallGate', () => {
  const baseLimits: LimitResponseWithPlan = {
    withinLimits: false,
    remaining: 0,
    plan: 'free',
    checkoutUrl: 'https://pay.example.com/checkout',
  }

  it('builds a payment_required gate when activationRequired is false/undefined', () => {
    const gate = buildPaywallGate('prd_x', baseLimits)
    expect(gate.kind).toBe('payment_required')
    expect(gate.product).toBe('prd_x')
    expect(gate.checkoutUrl).toBe('https://pay.example.com/checkout')
    // Message names a recovery tool for terminal-first hosts.
    expect(gate.message).toMatch(/upgrade/i)
    expect(gate.message).toContain('https://pay.example.com/checkout')
  })

  it('inlines balance and productDetails on payment_required gates when present', () => {
    const balance = { creditBalance: 0, remainingUnits: 0, creditsPerUnit: 1 }
    const product = { name: 'API', ref: 'prd_x', provider: 'acme' }
    const gate = buildPaywallGate('prd_x', {
      ...baseLimits,
      balance,
      product,
    })
    if (gate.kind !== 'payment_required') {
      throw new Error('expected payment_required gate')
    }
    expect(gate.balance).toEqual(balance)
    expect(gate.productDetails).toEqual(product)
  })

  it('builds an activation_required gate when activationRequired is true', () => {
    const plans = [
      {
        reference: 'pln_usage',
        name: 'Usage',
        type: 'usage-based' as const,
        price: 0,
        currency: 'USD',
        requiresPayment: false,
      },
    ]
    const balance = { creditBalance: 100, remainingUnits: 100, creditsPerUnit: 1 }
    const productCtx = { name: 'API', ref: 'prd_x', provider: 'acme' }
    const gate = buildPaywallGate('prd_x', {
      ...baseLimits,
      activationRequired: true,
      confirmationUrl: 'https://pay.example.com/confirm',
      plans,
      balance,
      product: productCtx,
    })

    expect(gate.kind).toBe('activation_required')
    expect(gate.product).toBe('prd_x')
    if (gate.kind !== 'activation_required') return
    expect(gate.checkoutUrl).toBe('https://pay.example.com/confirm')
    expect(gate.confirmationUrl).toBe('https://pay.example.com/confirm')
    expect(gate.plans).toEqual(plans)
    expect(gate.balance).toEqual(balance)
    expect(gate.productDetails).toEqual(productCtx)
    expect(gate.message).toMatch(/activate_plan/i)
  })

  it('uses checkoutUrl when confirmationUrl is missing for activation gates', () => {
    const gate = buildPaywallGate('prd_x', {
      ...baseLimits,
      activationRequired: true,
    })
    expect(gate.kind).toBe('activation_required')
    if (gate.kind !== 'activation_required') return
    expect(gate.checkoutUrl).toBe('https://pay.example.com/checkout')
  })

  it('falls back to empty checkoutUrl when no URL is available', () => {
    const gate = buildPaywallGate('prd_x', {
      withinLimits: false,
      remaining: 0,
      plan: 'free',
    })
    if (gate.kind !== 'payment_required') {
      throw new Error('expected payment_required gate')
    }
    expect(gate.checkoutUrl).toBe('')
  })

  it('produces the same gate shape that paywall.decide() emits internally', () => {
    // This is the regression contract: extracting the helper must not
    // drift from the inline construction in paywall.decide(). We mirror
    // the structured fields the inline block builds and assert they
    // match the helper output.
    const limits: LimitResponseWithPlan = {
      withinLimits: false,
      remaining: 0,
      plan: 'free',
      checkoutUrl: 'https://example.com/checkout',
      balance: { creditBalance: 0, remainingUnits: 0, creditsPerUnit: 1 },
      product: { name: 'API', ref: 'prd_test', provider: 'acme' },
    }
    const gate = buildPaywallGate('prd_test', limits)
    expect(gate).toMatchObject({
      kind: 'payment_required',
      product: 'prd_test',
      checkoutUrl: 'https://example.com/checkout',
      balance: limits.balance,
      productDetails: limits.product,
    })
    expect(gate.message.length).toBeGreaterThan(0)
  })
})
