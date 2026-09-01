import { describe, expect, it } from 'vitest'
import { narrateUpgrade } from '../src/narrate'
import type { BootstrapPayload } from '../src/types'

/**
 * The plan list an MCP client reads before choosing a plan. A plan's price
 * comes from `options[]`; the derived top-level `price` is only a fallback,
 * and it is 0 for anything priced per unit — so reading it alone announced a
 * paid pay-as-you-go plan as free (DEV-816).
 */
const band = (from: number, to: number | null, amountMinor: number, meter = 'requests') => ({
  kind: 'tier',
  from,
  to,
  mode: 'graduated',
  charge: { per: 'unit', amountMinor, currency: 'USD', meter },
})

const payload = (options: unknown[]): BootstrapPayload =>
  ({
    product: { name: 'Wiki' },
    plans: [
      {
        reference: 'pln_1',
        name: 'Scale',
        type: 'usage-based',
        requiresPayment: true,
        price: 0,
        currency: 'USD',
        options,
      },
    ],
  }) as unknown as BootstrapPayload

describe('narrateUpgrade plan pricing', () => {
  it('leads a tiered plan with its entry band, marked as a floor', () => {
    const { text } = narrateUpgrade(payload([band(0, 1000, 2), band(1000, null, 1)]))
    expect(text).toContain('from $0.02 / requests')
    expect(text).not.toContain('$0.00')
  })

  it('states a single-band rate plainly', () => {
    const { text } = narrateUpgrade(payload([band(0, null, 5)]))
    expect(text).toContain('$0.05 / requests')
    expect(text).not.toContain('from ')
  })

  it('states a flat per-unit rate the same way', () => {
    const { text } = narrateUpgrade(
      payload([{ kind: 'charge', per: 'unit', amountMinor: 3, currency: 'USD', meter: 'tokens' }]),
    )
    expect(text).toContain('$0.03 / tokens')
  })

  it('still leads a recurring plan with its flat charge', () => {
    const { text } = narrateUpgrade(
      payload([
        { kind: 'billingCycle', interval: 'month' },
        { kind: 'charge', per: 'flat', amountMinor: 1900, currency: 'USD' },
      ]),
    )
    expect(text).toContain('$19')
  })
})
