import { describe, expect, it } from 'vitest'
import type { AutoRechargeConfig } from '@solvapay/server'
import {
  configToForm,
  createDefaultAutoRechargeForm,
  formatAmountWithUnit,
  validateAutoRechargeForm,
} from './auto-recharge-form'

const conversion = { creditsPerMinorUnit: 100, displayExchangeRate: 1 }

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

  it('should use defaultTopupMajor for threshold and topup when provided', () => {
    const form = createDefaultAutoRechargeForm('USD', 25)
    expect(form.thresholdAmountMajor).toBe('25')
    expect(form.topupAmountMajor).toBe('25')
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
      trigger: { type: 'balance', thresholdCredits: 500 },
      topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
      status: 'active',
      failureCount: 0,
    }
    const form = configToForm(config, 'USD')
    expect(form.enabled).toBe(true)
    expect(form.thresholdAmountMajor).toBe('5')
    expect(form.topupAmountMajor).toBe('10')
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
