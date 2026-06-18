import { describe, expect, it } from 'vitest'
import type { AutoRechargeConfig } from '@solvapay/server'
import {
  configToForm,
  createDefaultAutoRechargeForm,
  formatAmountWithUnit,
  validateAutoRechargeForm,
} from './auto-recharge-form'

const conversion = { creditsPerMinorUnit: 100, displayExchangeRate: 1 }
const SEK_RATE = 9.46
const sekConversion = { creditsPerMinorUnit: 100, displayExchangeRate: SEK_RATE }

/** Mirrors post-fix backend: FX-convert threshold major -> USD cents -> credits. */
function thresholdCreditsFromMajor(
  thresholdMajor: number,
  currency: string,
  displayExchangeRate: number,
): number {
  const upper = currency.toUpperCase()
  const thresholdUsdMinor =
    upper === 'USD'
      ? Math.round(thresholdMajor * 100)
      : Math.round((thresholdMajor / displayExchangeRate) * 100)
  return thresholdUsdMinor * 100
}

function enabledForm(overrides: Partial<ReturnType<typeof createDefaultAutoRechargeForm>> = {}) {
  return {
    ...createDefaultAutoRechargeForm('USD'),
    enabled: true,
    ...overrides,
  }
}

describe('createDefaultAutoRechargeForm', () => {
  it('should default threshold to 5 and topup to 10 when no defaultTopupMajor', () => {
    const form = createDefaultAutoRechargeForm('USD')
    expect(form.enabled).toBe(false)
    expect(form.thresholdAmountMajor).toBe('5')
    expect(form.topupAmountMajor).toBe('10')
  })

  it('should use defaultTopupMajor for topup only when provided', () => {
    const form = createDefaultAutoRechargeForm('USD', 25)
    expect(form.thresholdAmountMajor).toBe('5')
    expect(form.topupAmountMajor).toBe('25')
  })

  it('does not inflate USD threshold on repeated configToForm→validate cycles', () => {
    const config: AutoRechargeConfig = {
      enabled: true,
      trigger: { type: 'balance', thresholdCredits: 50_000 },
      topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
      status: 'active',
      failureCount: 0,
    }

    const cycle = () => {
      const form = configToForm(config, 'USD', conversion)
      const validated = validateAutoRechargeForm(
        { ...form, enabled: true },
        'USD',
        conversion,
      )
      expect(validated.ok).toBe(true)
      if (!validated.ok) return
      config.trigger.thresholdCredits = Math.round(
        (validated.payload.thresholdAmountMajor ?? 0) * 100 * 100,
      )
    }

    cycle()
    cycle()
    expect(config.trigger.thresholdCredits).toBe(50_000)
  })
})

describe('validateAutoRechargeForm unit conversion', () => {
  it('converts threshold entered in credits to currency major for payload', () => {
    const form = enabledForm({
      thresholdUnit: 'credits',
      thresholdAmountMajor: '100000',
    })
    const result = validateAutoRechargeForm(form, 'USD', conversion)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.thresholdAmountMajor).toBe(10)
      expect(result.payload.triggerType).toBe('balance')
    }
  })

  it('converts fixed top-up entered in credits to currency major for payload', () => {
    const form = enabledForm({
      topupUnit: 'credits',
      topupAmountMajor: '100000',
    })
    const result = validateAutoRechargeForm(form, 'USD', conversion)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.topupAmountMajor).toBe(10)
    }
  })

  it('rejects fixed top-up below minimum charge', () => {
    const form = enabledForm({ topupAmountMajor: '0.01' })
    const result = validateAutoRechargeForm(form, 'USD', conversion)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/minimum/i)
    }
  })

  it('returns disabled payload when form is not enabled', () => {
    const form = createDefaultAutoRechargeForm('USD')
    const result = validateAutoRechargeForm(form, 'USD', conversion)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.enabled).toBe(false)
    }
  })
})

describe('configToForm', () => {
  it('maps fixed-mode config to form state', () => {
    const config: AutoRechargeConfig = {
      enabled: true,
      trigger: { type: 'balance', thresholdCredits: 50_000 },
      topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
      status: 'active',
      failureCount: 0,
    }
    const form = configToForm(config, 'USD', conversion)
    expect(form.enabled).toBe(true)
    expect(form.thresholdAmountMajor).toBe('5')
    expect(form.topupAmountMajor).toBe('10')
  })

  it('inverts FX-scaled SEK threshold without 100x inflation', () => {
    const thresholdMajor = 1000
    const thresholdCredits = thresholdCreditsFromMajor(thresholdMajor, 'SEK', SEK_RATE)
    const config: AutoRechargeConfig = {
      enabled: true,
      trigger: { type: 'balance', thresholdCredits },
      topup: { mode: 'fixed', amountMinor: 1500, currency: 'SEK' },
      status: 'active',
      failureCount: 0,
    }
    const form = configToForm(config, 'SEK', sekConversion)
    const displayed = Number(form.thresholdAmountMajor)
    expect(displayed).toBeCloseTo(thresholdMajor, 0)
    expect(displayed).not.toBe(100_000)
  })

  it('round-trips SEK threshold through validate payload storage shape and configToForm', () => {
    const form = enabledForm({
      thresholdAmountMajor: '10',
      topupAmountMajor: '15',
    })
    const validated = validateAutoRechargeForm(form, 'SEK', sekConversion)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    const thresholdMajor = validated.payload.thresholdAmountMajor ?? 0
    const storedCredits = thresholdCreditsFromMajor(thresholdMajor, 'SEK', SEK_RATE)
    const config: AutoRechargeConfig = {
      enabled: true,
      trigger: { type: 'balance', thresholdCredits: storedCredits },
      topup: { mode: 'fixed', amountMinor: 1500, currency: 'SEK' },
      status: 'active',
      failureCount: 0,
    }
    const reloaded = configToForm(config, 'SEK', sekConversion)
    expect(Number(reloaded.thresholdAmountMajor)).toBeCloseTo(10, 0)
  })
})

describe('formatAmountWithUnit', () => {
  it('formats currency amounts', () => {
    expect(formatAmountWithUnit('10', 'currency', 'SEK')).toMatch(/10/)
  })

  it('formats credit amounts', () => {
    expect(formatAmountWithUnit('1000', 'credits', 'USD')).toBe('1,000 credits')
  })
})
