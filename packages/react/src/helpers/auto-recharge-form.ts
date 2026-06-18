import type { AutoRechargeConfig, AutoRechargeInput } from '@solvapay/server'
import { formatPrice, getMinorUnitsPerMajor } from '../utils/format'
import { estimateCredits, estimateCurrencyMajorFromCredits } from '../utils/credit-estimation'

export type AmountInputUnit = 'currency' | 'credits'

export type AutoRechargeFormState = {
  enabled: boolean
  thresholdAmountMajor: string
  thresholdUnit: AmountInputUnit
  topupAmountMajor: string
  topupUnit: AmountInputUnit
}

export type AutoRechargeConversionContext = {
  creditsPerMinorUnit?: number | null
  displayExchangeRate?: number | null
}

export type AutoRechargeInputPayload = AutoRechargeInput

export function createDefaultAutoRechargeForm(
  currency: string,
  defaultTopupMajor?: number | null,
  defaultThresholdMajor?: number | null,
): AutoRechargeFormState {
  const topup =
    defaultTopupMajor != null && defaultTopupMajor > 0 ? String(defaultTopupMajor) : '10'
  const threshold =
    defaultThresholdMajor != null && defaultThresholdMajor >= 0
      ? String(defaultThresholdMajor)
      : '5'

  return {
    enabled: false,
    thresholdAmountMajor: threshold,
    thresholdUnit: 'currency',
    topupAmountMajor: topup,
    topupUnit: 'currency',
  }
}

function parsePositiveNumber(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function parseNonNegativeNumber(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

export function validateAutoRechargeForm(
  form: AutoRechargeFormState,
  currency: string,
  conversion?: AutoRechargeConversionContext,
): { ok: true; payload: AutoRechargeInputPayload } | { ok: false; error: string } {
  if (!form.enabled) {
    return {
      ok: true,
      payload: {
        enabled: false,
        triggerType: 'balance',
        currency: currency.toUpperCase(),
      },
    }
  }

  const payload: AutoRechargeInputPayload = {
    enabled: true,
    triggerType: 'balance',
    currency: currency.toUpperCase(),
  }

  const thresholdRaw = parseNonNegativeNumber(form.thresholdAmountMajor)
  if (thresholdRaw == null) {
    return { ok: false, error: 'Enter a valid balance threshold.' }
  }
  if (form.thresholdUnit === 'credits') {
    const major = estimateCurrencyMajorFromCredits(
      thresholdRaw,
      currency,
      conversion?.creditsPerMinorUnit,
      conversion?.displayExchangeRate,
    )
    if (major == null) {
      return { ok: false, error: 'Enter a valid balance threshold.' }
    }
    payload.thresholdAmountMajor = major
  } else {
    payload.thresholdAmountMajor = thresholdRaw
  }

  const amountRaw = parsePositiveNumber(form.topupAmountMajor)
  if (amountRaw == null) {
    return {
      ok: false,
      error: 'Top-up amount must be at least the minimum charge (about $0.50).',
    }
  }
  const amountMajor =
    form.topupUnit === 'credits'
      ? estimateCurrencyMajorFromCredits(
          amountRaw,
          currency,
          conversion?.creditsPerMinorUnit,
          conversion?.displayExchangeRate,
        )
      : amountRaw
  if (amountMajor == null || amountMajor < 0.5) {
    return {
      ok: false,
      error: 'Top-up amount must be at least the minimum charge (about $0.50).',
    }
  }
  payload.topupAmountMajor = amountMajor

  return { ok: true, payload }
}

export function configToForm(
  config: AutoRechargeConfig,
  currency: string,
  conversion?: AutoRechargeConversionContext,
): AutoRechargeFormState {
  const base = createDefaultAutoRechargeForm(currency)
  const thresholdMajor = estimateCurrencyMajorFromCredits(
    config.trigger.thresholdCredits,
    currency,
    conversion?.creditsPerMinorUnit,
    conversion?.displayExchangeRate,
  )
  return {
    ...base,
    enabled: config.enabled,
    thresholdAmountMajor:
      thresholdMajor != null ? String(Math.max(0, thresholdMajor)) : '0',
    topupAmountMajor: String(config.topup.amountMinor / getMinorUnitsPerMajor(currency)),
  }
}

export function formatAmountWithUnit(
  value: string,
  unit: AmountInputUnit,
  currency: string,
): string {
  const num = Number(value)
  if (!value || !Number.isFinite(num)) return '—'
  if (unit === 'credits') {
    return `${new Intl.NumberFormat().format(num)} credits`
  }
  return formatPrice(Math.round(num * getMinorUnitsPerMajor(currency)), currency, { free: '' })
}

export function buildSummaryLine(
  form: AutoRechargeFormState,
  currency: string,
): string | null {
  if (!form.enabled) return null
  const thresholdDisplay = formatAmountWithUnit(
    form.thresholdAmountMajor,
    form.thresholdUnit,
    currency,
  )
  const fixedDisplay = formatAmountWithUnit(form.topupAmountMajor, form.topupUnit, currency)
  return `When my balance falls below ${thresholdDisplay}, add ${fixedDisplay}.`
}

export function convertAmountForUnitFlip(
  value: string,
  fromUnit: AmountInputUnit,
  toUnit: AmountInputUnit,
  currency: string,
  creditsPerMinorUnit?: number | null,
  displayExchangeRate?: number | null,
): string {
  if (fromUnit === toUnit) return value
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return value

  if (fromUnit === 'currency' && toUnit === 'credits') {
    const credits = estimateCredits(parsed, currency, creditsPerMinorUnit, displayExchangeRate)
    return credits != null ? String(credits) : value
  }

  const major = estimateCurrencyMajorFromCredits(
    parsed,
    currency,
    creditsPerMinorUnit,
    displayExchangeRate,
  )
  return major != null ? String(major) : value
}
