import { describe, it, expect } from 'vitest'
import type { AutoRechargeConfig } from '@solvapay/server'
import {
  buildSummaryLineFromPayload,
  configToAutoRechargeInput,
  configToForm,
  currentSpendPeriod,
  effectiveMonthlySpend,
  formatMonthlySpendLine,
  isMonthlySpendCapReached,
  validateAutoRechargeForm,
  type AutoRechargeFormState,
} from './auto-recharge-form'
import { enCopy } from '../i18n/en'
import { interpolate } from '../i18n/interpolate'
import { formatPrice } from '../utils/format'

describe('configToAutoRechargeInput', () => {
  const baseConfig: AutoRechargeConfig = {
    enabled: true,
    trigger: { type: 'balance', thresholdAmountMinor: 4500 },
    topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
    status: 'pending_setup',
    failureCount: 0,
    monthlySpendMinor: 0,
  }

  it('prefers backend display block when present on config', () => {
    const input = configToAutoRechargeInput({
      ...baseConfig,
      display: {
        thresholdAmountMajor: 45,
        topupAmountMajor: 10,
        currency: 'USD',
        formatted: { threshold: '$45', topup: '$10' },
        exchangeRate: 1,
        rateSource: 'parity',
      },
    })
    expect(input).toEqual({
      enabled: true,
      triggerType: 'balance',
      thresholdAmountMajor: 45,
      topupAmountMajor: 10,
      currency: 'USD',
    })
  })

  it('prefers explicit display option over credit conversion', () => {
    const input = configToAutoRechargeInput(baseConfig, {
      display: {
        thresholdAmountMajor: 45,
        topupAmountMajor: 10,
        currency: 'USD',
        formatted: { threshold: '$45', topup: '$10' },
        exchangeRate: 1,
        rateSource: 'parity',
      },
    })
    expect(input?.thresholdAmountMajor).toBe(45)
    expect(input?.topupAmountMajor).toBe(10)
  })

  it('derives major amounts from trigger minor units when display is absent', () => {
    const input = configToAutoRechargeInput(baseConfig, {
      currency: 'USD',
    })
    expect(input?.enabled).toBe(true)
    expect(input?.thresholdAmountMajor).toBe(45)
    expect(input?.topupAmountMajor).toBe(10)
  })

  it('returns null when auto-recharge is disabled', () => {
    expect(configToAutoRechargeInput({ ...baseConfig, enabled: false })).toBeNull()
  })

  it('carries maxMonthlySpendMajor when config has a cap', () => {
    const input = configToAutoRechargeInput({
      ...baseConfig,
      maxMonthlySpendMinor: 10_000,
    })
    expect(input?.maxMonthlySpendMajor).toBe(100)
  })
})

describe('configToForm (DEV-586: reload must not mis-scale or zero when display is absent)', () => {
  const baseConfig: AutoRechargeConfig = {
    enabled: true,
    trigger: { type: 'balance', thresholdAmountMinor: 4500 },
    topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
    status: 'active',
    failureCount: 0,
    monthlySpendMinor: 0,
  }

  it('prefers the backend display block verbatim when present', () => {
    const form = configToForm(
      {
        ...baseConfig,
        display: {
          thresholdAmountMajor: 50,
          topupAmountMajor: 12,
          currency: 'USD',
          formatted: { threshold: '$50', topup: '$12' },
          exchangeRate: 1,
          rateSource: 'parity',
        },
      },
      'USD',
    )
    expect(form.enabled).toBe(true)
    expect(form.thresholdAmountMajor).toBe('50')
    expect(form.topupAmountMajor).toBe('12')
  })

  it('reconstructs currency-correct major amounts from trigger minor units when display is absent', () => {
    const form = configToForm(baseConfig, 'USD')
    expect(form.thresholdAmountMajor).toBe('45')
    expect(form.topupAmountMajor).toBe('10')
  })

  it('uses a zero-decimal divisor for the top-up on JPY when display is absent', () => {
    const form = configToForm(
      {
        ...baseConfig,
        trigger: { type: 'balance', thresholdAmountMinor: 50_000 },
        topup: { mode: 'fixed', amountMinor: 5000, currency: 'JPY' },
      },
      'JPY',
    )
    // JPY is zero-decimal: 5000 minor units == 5000 major, not 50.
    expect(form.topupAmountMajor).toBe('5000')
    expect(form.thresholdAmountMajor).not.toBe('0')
  })

  it('round-trips maxMonthlySpendMinor into the form cap field', () => {
    const form = configToForm({ ...baseConfig, maxMonthlySpendMinor: 10_000 }, 'USD')
    expect(form.maxMonthlySpendMajor).toBe('100')
  })
})

describe('buildSummaryLineFromPayload', () => {
  it('builds a natural-language summary from a staged payload', () => {
    const line = buildSummaryLineFromPayload(
      {
        enabled: true,
        triggerType: 'balance',
        thresholdAmountMajor: 5,
        topupAmountMajor: 10,
        currency: 'USD',
      },
      'USD',
    )
    expect(line).toBe('When my balance falls below $5, add $10.')
  })

  it('returns null when auto-recharge is disabled in the payload', () => {
    expect(
      buildSummaryLineFromPayload(
        { enabled: false, triggerType: 'balance', currency: 'USD' },
        'USD',
      ),
    ).toBeNull()
  })
})

describe('validateAutoRechargeForm — per-currency minimums & relationship (DEV-582)', () => {
  const form = (over: Partial<AutoRechargeFormState> = {}): AutoRechargeFormState => ({
    enabled: true,
    thresholdAmountMajor: '5',
    thresholdUnit: 'currency',
    thresholdBaseValue: '5',
    thresholdBaseUnit: 'currency',
    topupAmountMajor: '10',
    topupUnit: 'currency',
    topupBaseValue: '10',
    topupBaseUnit: 'currency',
    maxMonthlySpendMajor: '',
    ...over,
  })

  // Known Stripe minimums (minor units) mirrored from the backend source of truth.
  const minTopupMessage = (currency: string, minMinor: number) =>
    interpolate(enCopy.autoRecharge.minTopupAmount ?? '', {
      amount: formatPrice(minMinor, currency, { free: '' }),
    })

  it('rejects a SEK top-up below the SEK minimum (3.00 kr), not the USD $0.50', () => {
    const result = validateAutoRechargeForm(
      form({ thresholdAmountMajor: '1', topupAmountMajor: '2' }),
      'SEK',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(minTopupMessage('SEK', 300))
      expect(result.error).not.toContain('$0.50')
    }
  })

  it('accepts a SEK top-up exactly at the SEK minimum (3.00 kr)', () => {
    const result = validateAutoRechargeForm(
      form({ thresholdAmountMajor: '1', topupAmountMajor: '3' }),
      'SEK',
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a JPY top-up below the JPY minimum (50) using zero-decimal units', () => {
    const result = validateAutoRechargeForm(
      form({ thresholdAmountMajor: '10', topupAmountMajor: '49' }),
      'JPY',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(minTopupMessage('JPY', 50))
    }
  })

  it('accepts a JPY top-up exactly at the JPY minimum (50)', () => {
    const result = validateAutoRechargeForm(
      form({ thresholdAmountMajor: '10', topupAmountMajor: '50' }),
      'JPY',
    )
    expect(result.ok).toBe(true)
  })

  it('accepts a GBP top-up exactly at the GBP minimum (0.30), which the old $0.50 floor wrongly rejected', () => {
    const result = validateAutoRechargeForm(
      form({ thresholdAmountMajor: '0.3', topupAmountMajor: '0.3' }),
      'GBP',
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a USD top-up below the USD minimum ($0.50)', () => {
    const result = validateAutoRechargeForm(
      form({ thresholdAmountMajor: '0.5', topupAmountMajor: '0.01' }),
      'USD',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(minTopupMessage('USD', 50))
    }
  })

  it('rejects a zero threshold (would never trigger a recharge)', () => {
    const result = validateAutoRechargeForm(form({ thresholdAmountMajor: '0' }), 'USD')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(enCopy.autoRecharge.thresholdTooLow)
    }
  })

  it('rejects a top-up smaller than the threshold (would immediately re-trigger)', () => {
    const result = validateAutoRechargeForm(
      form({ thresholdAmountMajor: '10', topupAmountMajor: '5' }),
      'USD',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(
        interpolate(enCopy.autoRecharge.topupBelowThreshold ?? '', {
          amount: formatPrice(1000, 'USD', { free: '' }),
        }),
      )
    }
  })

  it('accepts a top-up exactly equal to the threshold (boundary)', () => {
    const result = validateAutoRechargeForm(
      form({ thresholdAmountMajor: '10', topupAmountMajor: '10' }),
      'USD',
    )
    expect(result.ok).toBe(true)
  })
})

describe('validateAutoRechargeForm — monthly spend cap (DEV-635)', () => {
  const form = (over: Partial<AutoRechargeFormState> = {}): AutoRechargeFormState => ({
    enabled: true,
    thresholdAmountMajor: '5',
    thresholdUnit: 'currency',
    thresholdBaseValue: '5',
    thresholdBaseUnit: 'currency',
    topupAmountMajor: '10',
    topupUnit: 'currency',
    topupBaseValue: '10',
    topupBaseUnit: 'currency',
    maxMonthlySpendMajor: '',
    ...over,
  })

  it('treats a blank cap as unlimited', () => {
    const result = validateAutoRechargeForm(form(), 'USD')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.maxMonthlySpendMajor).toBeUndefined()
    }
  })

  it('rejects an invalid cap', () => {
    const result = validateAutoRechargeForm(form({ maxMonthlySpendMajor: 'abc' }), 'USD')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(enCopy.autoRecharge.invalidMaxMonthlySpend)
    }
  })

  it('rejects a cap below the top-up amount', () => {
    const result = validateAutoRechargeForm(form({ maxMonthlySpendMajor: '5' }), 'USD')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(
        interpolate(enCopy.autoRecharge.maxMonthlySpendBelowTopup, {
          amount: formatPrice(1000, 'USD', { free: '' }),
        }),
      )
    }
  })

  it('accepts a valid cap and emits maxMonthlySpendMajor', () => {
    const result = validateAutoRechargeForm(form({ maxMonthlySpendMajor: '100' }), 'USD')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.maxMonthlySpendMajor).toBe(100)
    }
  })
})

describe('monthly spend helpers (DEV-635)', () => {
  const july2026 = new Date('2026-07-15T12:00:00Z')

  it('currentSpendPeriod returns UTC YYYY-MM', () => {
    expect(currentSpendPeriod(july2026)).toBe('2026-07')
  })

  it('effectiveMonthlySpend resets when the period does not match', () => {
    expect(
      effectiveMonthlySpend(
        { monthlySpendMinor: 4500, monthlySpendPeriod: '2026-06' },
        july2026,
      ),
    ).toBe(0)
  })

  it('effectiveMonthlySpend returns spend for the current period', () => {
    expect(
      effectiveMonthlySpend(
        { monthlySpendMinor: 4500, monthlySpendPeriod: '2026-07' },
        july2026,
      ),
    ).toBe(4500)
  })

  it('isMonthlySpendCapReached includes the pending top-up in the check', () => {
    expect(
      isMonthlySpendCapReached(
        {
          maxMonthlySpendMinor: 10_000,
          monthlySpendMinor: 9500,
          monthlySpendPeriod: '2026-07',
          topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
        },
        july2026,
      ),
    ).toBe(true)
  })

  it('formatMonthlySpendLine renders spent / cap for the current month', () => {
    const line = formatMonthlySpendLine(
      {
        enabled: true,
        trigger: { type: 'balance', thresholdAmountMinor: 500 },
        topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
        maxMonthlySpendMinor: 10_000,
        monthlySpendMinor: 4500,
        monthlySpendPeriod: '2026-07',
        status: 'active',
        failureCount: 0,
      },
      'USD',
      july2026,
    )
    expect(line).toBe('$45 / $100 this month')
  })
})
