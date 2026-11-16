import { describe, expect, it, vi } from 'vitest'
import { SolvaPayPaywall } from '../src/paywall'
import type { SolvaPayClient } from '../src/types'

/**
 * A gate the SDK decides on its own (the last cached unit is used, or more
 * parallel callers than units share one limits check) must describe that
 * verdict, not the limits response it was counted down from: that response
 * still says `withinLimits: true` with units remaining.
 */
function clientWithRemaining(remaining: number): SolvaPayClient {
  return {
    checkLimits: vi.fn(async () => ({
      withinLimits: true,
      remaining,
      plan: 'Pro',
      meterName: 'requests',
      checkoutUrl: 'https://checkout.example.test/s/1',
    })),
    trackUsage: vi.fn(async () => undefined),
  } as unknown as SolvaPayClient
}

const args = { auth: { customer_ref: 'cus_cached_gate' } }
const metadata = { product: 'prd_cached_gate' }

describe('gates the SDK decides from its own count', () => {
  it('gates the call after the last cached unit as limit_reached with nothing remaining', async () => {
    const paywall = new SolvaPayPaywall(clientWithRemaining(1), { debug: false })

    const first = await paywall.decide(args, metadata)
    const second = await paywall.decide(args, metadata)

    expect(first.outcome).toBe('allow')
    expect(second.outcome).toBe('gate')
    if (second.outcome !== 'gate') return
    expect(second.gate.kind).toBe('payment_required')
    expect(second.gate.reason).toBe('limit_reached')
    expect(second.gate.remainingCalls ?? 0).toBe(0)
  })

  it('gates the parallel caller beyond the remaining units as limit_reached', async () => {
    const paywall = new SolvaPayPaywall(clientWithRemaining(2), { debug: false })
    const otherArgs = { auth: { customer_ref: 'cus_cached_gate_parallel' } }

    const decisions = await Promise.all([1, 2, 3].map(() => paywall.decide(otherArgs, metadata)))

    const gated = decisions.filter(d => d.outcome === 'gate')
    expect(gated).toHaveLength(1)
    const [gate] = gated
    if (gate.outcome !== 'gate') return
    expect(gate.gate.reason).toBe('limit_reached')
    expect(gate.gate.remainingCalls ?? 0).toBe(0)
  })
})
