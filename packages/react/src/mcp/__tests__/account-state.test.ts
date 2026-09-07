import { describe, expect, it } from 'vitest'
import {
  resolveAccountState,
  resolveRemaining,
  resolveMeterTone,
  resolveRateDisplay,
  resolvePeriodDisplay,
  resolveOneTimeDisplay,
  resolveMerchantStrip,
  daysUntil,
  allowanceMeterUnit,
  type AccountLimitsLike,
  type AccountPurchaseLike,
} from '../account-state'
import type { PlanLike } from '../plan-actions'

const cycle = (interval = 'month') => ({ kind: 'billingCycle' as const, interval })
const flat = (amountMinor: number) => ({
  kind: 'charge' as const,
  per: 'flat' as const,
  amountMinor,
  currency: 'usd',
})
const perUnit = (amountMinor: number) => ({
  kind: 'charge' as const,
  per: 'unit' as const,
  amountMinor,
  currency: 'usd',
  meter: 'requests',
})
const limit = (cap: number) => ({ kind: 'limit' as const, cap, meter: 'requests' })
const band = (from: number, to: number | null, amountMinor: number) => ({
  kind: 'tier' as const,
  from,
  to,
  mode: 'graduated' as const,
  meter: 'requests',
  charge: { per: 'unit' as const, amountMinor, currency: 'usd', meter: 'requests' },
})

const payg: PlanLike = { requiresPayment: true, options: [perUnit(2)] }
const starter: PlanLike = {
  requiresPayment: true,
  options: [cycle(), flat(3000), limit(10000)],
}
const free: PlanLike = { requiresPayment: false, options: [cycle(), limit(3)] }
const unlimited: PlanLike = { requiresPayment: true, options: [cycle(), flat(9000)] }
const oneTime: PlanLike = { requiresPayment: true, options: [flat(9000)] }
const tiered: PlanLike = { requiresPayment: true, options: [band(0, 100, 2), band(100, null, 1)] }

const running: AccountLimitsLike = {
  remaining: 3800,
  withinLimits: true,
  activationRequired: false,
  overage: false,
  needsTopUp: false,
  needsUpgrade: false,
  throttled: false,
}

const atCap: AccountLimitsLike = {
  ...running,
  remaining: 0,
  withinLimits: false,
}

function purchase(snapshot: PlanLike, extra: Partial<AccountPurchaseLike> = {}): AccountPurchaseLike {
  return { planSnapshot: snapshot, ...extra }
}

describe('resolveAccountState precedence', () => {
  it('G: loading outranks every other signal', () => {
    expect(
      resolveAccountState({
        loading: true,
        purchase: purchase(free),
        limits: { ...atCap, activationRequired: true, overage: true, needsTopUp: true },
      }),
    ).toBe('G')
  })

  it('H: activationRequired outranks zero remaining (not F)', () => {
    expect(
      resolveAccountState({
        purchase: null,
        limits: { ...atCap, activationRequired: true },
      }),
    ).toBe('H')
  })

  it('I: overage outranks withinLimits / at-cap (not F)', () => {
    expect(
      resolveAccountState({
        purchase: purchase(starter),
        limits: { ...atCap, overage: true, remaining: 0 },
      }),
    ).toBe('I')
  })

  it('J: cancelledAt + future endDate outranks plan shape', () => {
    expect(
      resolveAccountState({
        purchase: purchase(starter, {
          cancelledAt: '2026-09-01T00:00:00.000Z',
          endDate: '2026-10-12T00:00:00.000Z',
        }),
        limits: running,
        now: new Date('2026-09-06T00:00:00.000Z'),
      }),
    ).toBe('J')
  })

  it('J does not fire when the cancelled plan has already ended', () => {
    expect(
      resolveAccountState({
        purchase: purchase(starter, {
          cancelledAt: '2026-08-01T00:00:00.000Z',
          endDate: '2026-09-01T00:00:00.000Z',
        }),
        limits: running,
        now: new Date('2026-09-06T00:00:00.000Z'),
      }),
    ).toBe('C')
  })

  it('D: needsTopUp on a credit plan', () => {
    expect(
      resolveAccountState({
        purchase: purchase(payg),
        limits: { ...running, remaining: 0, withinLimits: false, needsTopUp: true },
      }),
    ).toBe('D')
  })

  it('D: usage-based out of limits even without the needsTopUp flag', () => {
    expect(
      resolveAccountState({
        purchase: purchase(payg),
        limits: { ...running, remaining: 0, withinLimits: false },
      }),
    ).toBe('D')
  })

  it('throttled stays on the running plan-shape state (B)', () => {
    expect(
      resolveAccountState({
        purchase: purchase(payg),
        limits: { ...running, throttled: true },
      }),
    ).toBe('B')
  })

  it('needsUpgrade stays on the running plan-shape state (C)', () => {
    expect(
      resolveAccountState({
        purchase: purchase(starter),
        limits: { ...running, needsUpgrade: true },
      }),
    ).toBe('C')
  })
})

describe('resolveAccountState plan-shape states', () => {
  it('A: no purchase and no activation required', () => {
    expect(resolveAccountState({ purchase: null, limits: running })).toBe('A')
  })

  it('B: usage-based running', () => {
    expect(resolveAccountState({ purchase: purchase(payg), limits: running })).toBe('B')
  })

  it('C: metered subscription running', () => {
    expect(resolveAccountState({ purchase: purchase(starter), limits: running })).toBe('C')
  })

  it('C: unmetered subscription running', () => {
    expect(resolveAccountState({ purchase: purchase(unlimited), limits: running })).toBe('C')
  })

  it('E: free running', () => {
    expect(
      resolveAccountState({
        purchase: purchase(free),
        limits: { ...running, remaining: 2 },
      }),
    ).toBe('E')
  })

  it('F: allowance plan at cap', () => {
    expect(resolveAccountState({ purchase: purchase(free), limits: atCap })).toBe('F')
    expect(resolveAccountState({ purchase: purchase(starter), limits: atCap })).toBe('F')
  })
})

describe('resolveRemaining', () => {
  it('returns a finite number for a real cap', () => {
    expect(resolveRemaining({ remaining: 3800, limitsResolved: true })).toEqual({
      kind: 'finite',
      remaining: 3800,
    })
  })

  it('prints Unlimited when remaining is -1 or cap is 0', () => {
    expect(resolveRemaining({ remaining: -1, limitsResolved: true })).toEqual({
      kind: 'unlimited',
      label: 'Unlimited',
    })
    expect(resolveRemaining({ remaining: 12, cap: 0, limitsResolved: true })).toEqual({
      kind: 'unlimited',
      label: 'Unlimited',
    })
  })

  it('prints Not known yet while limits resolve — never fakes unlimited', () => {
    expect(resolveRemaining({ remaining: null, limitsResolved: false })).toEqual({
      kind: 'unknown',
      label: 'Not known yet',
    })
    expect(resolveRemaining({ remaining: null, limitsResolved: true })).toEqual({
      kind: 'unknown',
      label: 'Not known yet',
    })
  })
})

describe('resolveMeterTone', () => {
  it('warns at 80% used', () => {
    expect(resolveMeterTone({ used: 80, remaining: 20, total: 100 })).toBe('warning')
  })

  it('is critical at 100%', () => {
    expect(resolveMeterTone({ used: 100, remaining: 0, total: 100 })).toBe('critical')
  })

  it('warns on the last remaining call even below 80% (E at 2 of 3)', () => {
    expect(resolveMeterTone({ used: 2, remaining: 1, total: 3 })).toBe('warning')
  })

  it('is ok well under the warning threshold', () => {
    expect(resolveMeterTone({ used: 6200, remaining: 3800, total: 10000 })).toBe('ok')
  })
})

describe('resolveRateDisplay', () => {
  const usdBalance = { displayCurrency: 'USD', creditsPerMinorUnit: 100, displayExchangeRate: 1 }

  it('omits the runway when the rate cannot be converted', () => {
    const sekPlan: PlanLike = {
      requiresPayment: true,
      options: [{ kind: 'charge', per: 'unit', amountMinor: 200, currency: 'sek', meter: 'requests' }],
    }
    expect(resolveRateDisplay(sekPlan, usdBalance)).toEqual({
      kind: 'unconvertible',
      label: 'Rate confirmed at checkout',
      showRunway: false,
    })
  })

  it('prefixes a tiered rate with from', () => {
    expect(resolveRateDisplay(tiered, usdBalance)).toEqual({
      kind: 'tiered',
      creditsPerCall: 200,
      label: 'from 200 credits per call',
      showRunway: true,
    })
  })
})

describe('resolvePeriodDisplay', () => {
  it('never returns an empty cell — first-run reads After your first call', () => {
    expect(resolvePeriodDisplay(undefined)).toEqual({
      kind: 'none',
      label: 'After your first call',
    })
    expect(resolvePeriodDisplay(null)).toEqual({
      kind: 'none',
      label: 'After your first call',
    })
  })

  it('keeps a known period end', () => {
    expect(resolvePeriodDisplay('2026-10-01T00:00:00.000Z')).toEqual({
      kind: 'date',
      periodEnd: '2026-10-01T00:00:00.000Z',
    })
  })
})

describe('resolveOneTimeDisplay', () => {
  it('drops Renews and qualifies the plan line as one time', () => {
    expect(resolveOneTimeDisplay(oneTime)).toEqual({
      showRenews: false,
      planQualifier: 'one time',
    })
  })

  it('keeps Renews on a recurring plan', () => {
    expect(resolveOneTimeDisplay(starter)).toEqual({
      showRenews: true,
      planQualifier: null,
    })
  })

  it('does not label pay-as-you-go as one time', () => {
    expect(resolveOneTimeDisplay(payg)).toEqual({
      showRenews: false,
      planQualifier: null,
    })
  })
})

describe('resolveMerchantStrip', () => {
  it('is never required for a state to be legible', () => {
    expect(resolveMerchantStrip()).toEqual({ required: false })
  })
})

describe('daysUntil', () => {
  it('returns whole days remaining, never a negative', () => {
    const now = new Date('2026-09-06T12:00:00.000Z')
    expect(daysUntil('2026-09-12T00:00:00.000Z', now)).toBe(6)
    expect(daysUntil('2026-09-06T00:00:00.000Z', now)).toBe(0)
    expect(daysUntil('2026-09-01T00:00:00.000Z', now)).toBe(0)
  })

  it('returns null for an unparseable date', () => {
    expect(daysUntil('not-a-date', new Date('2026-09-06T00:00:00.000Z'))).toBeNull()
  })
})

describe('allowanceMeterUnit', () => {
  it('prints calls for the default requests meter, singular at 1', () => {
    expect(allowanceMeterUnit('requests', 3800)).toBe('calls')
    expect(allowanceMeterUnit(null, 1)).toBe('call')
    expect(allowanceMeterUnit(undefined, 3)).toBe('calls')
  })

  it('keeps a named meter and singularizes a trailing s at 1', () => {
    expect(allowanceMeterUnit('tokens', 10)).toBe('tokens')
    expect(allowanceMeterUnit('tokens', 1)).toBe('token')
  })
})
