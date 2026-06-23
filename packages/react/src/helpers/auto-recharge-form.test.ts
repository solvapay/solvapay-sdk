import { describe, it, expect } from 'vitest'
import type { AutoRechargeConfig } from '@solvapay/server'
import { buildSummaryLineFromPayload, configToAutoRechargeInput } from './auto-recharge-form'

describe('configToAutoRechargeInput', () => {
  const baseConfig: AutoRechargeConfig = {
    enabled: true,
    trigger: { type: 'balance', thresholdCredits: 450_000 },
    topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
    status: 'pending_setup',
    failureCount: 0,
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

  it('derives major amounts from credits when display is absent', () => {
    const input = configToAutoRechargeInput(baseConfig, {
      currency: 'USD',
      conversion: { creditsPerMinorUnit: 100, displayExchangeRate: 1 },
    })
    expect(input?.enabled).toBe(true)
    expect(input?.thresholdAmountMajor).toBe(45)
    expect(input?.topupAmountMajor).toBe(10)
  })

  it('returns null when auto-recharge is disabled', () => {
    expect(configToAutoRechargeInput({ ...baseConfig, enabled: false })).toBeNull()
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
