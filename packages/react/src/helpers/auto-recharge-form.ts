import type { AutoRechargeConfig, AutoRechargeInput } from '@solvapay/server'
import { formatPrice, getMinorUnitsPerMajor } from '../utils/format'
import { estimateCredits, estimateCurrencyMajorFromCredits } from '../utils/credit-estimation'

export type AutoRechargeTopupMode = AutoRechargeInput['topupMode']
export type AmountInputUnit = 'currency' | 'credits'

export type AutoRechargeFormState = {
  enabled: boolean
  thresholdAmountMajor: string
  thresholdUnit: AmountInputUnit
  topupMode: AutoRechargeTopupMode
  topupAmountMajor: string
  topupUnit: AmountInputUnit
  targetCredits: string
  targetUnit: AmountInputUnit
  maxRecharges: string
  showAdvanced: boolean
}

export type AutoRechargeConversionContext = {
  creditsPerMinorUnit?: number | null
  displayExchangeRate?: number | null
}

export type AutoRechargeInputPayload = AutoRechargeInput

export function createDefaultAutoRechargeForm(
  currency: string,
  defaultTopupMajor?: number | null,
): AutoRechargeFormState {
  const topup =
    defaultTopupMajor != null && defaultTopupMajor > 0 ? String(defaultTopupMajor) : '10'
  const threshold =
    defaultTopupMajor != null && defaultTopupMajor > 0 ? String(defaultTopupMajor) : '5'

  return {
    enabled: false,
    thresholdAmountMajor: threshold,
    thresholdUnit: 'currency',
    topupMode: 'fixed',
    topupAmountMajor: topup,
    topupUnit: 'currency',
    targetCredits: '100',
    targetUnit: 'currency',
    maxRecharges: '',
    showAdvanced: false,
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
        topupMode: form.topupMode,
        currency: currency.toUpperCase(),
      },
    }
  }

  const payload: AutoRechargeInputPayload = {
    enabled: true,
    triggerType: 'balance',
    topupMode: form.topupMode,
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

  if (form.topupMode === 'fixed') {
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
  } else {
    const targetRaw = parsePositiveNumber(form.targetCredits)
    if (targetRaw == null) {
      return { ok: false, error: 'Enter a valid target credit balance.' }
    }
    if (form.targetUnit === 'currency') {
      const credits = estimateCredits(
        targetRaw,
        currency,
        conversion?.creditsPerMinorUnit,
        conversion?.displayExchangeRate,
      )
      if (credits == null || !Number.isInteger(credits)) {
        return { ok: false, error: 'Enter a valid target credit balance.' }
      }
      payload.targetCredits = credits
    } else {
      if (!Number.isInteger(targetRaw)) {
        return { ok: false, error: 'Enter a valid target credit balance.' }
      }
      payload.targetCredits = Math.floor(targetRaw)
    }
  }

  if (form.maxRecharges.trim().length > 0) {
    const max = parsePositiveNumber(form.maxRecharges)
    if (max == null || !Number.isInteger(max)) {
      return { ok: false, error: 'Max recharges must be a positive whole number.' }
    }
    payload.maxRecharges = Math.floor(max)
  }

  return { ok: true, payload }
}

export function configToForm(config: AutoRechargeConfig, currency: string): AutoRechargeFormState {
  const base = createDefaultAutoRechargeForm(currency)
  return {
    ...base,
    enabled: config.enabled,
    thresholdAmountMajor: String(Math.max(0, config.trigger.thresholdCredits / 100)),
    topupMode: config.topup.mode,
    topupAmountMajor:
      config.topup.mode === 'fixed'
        ? String(config.topup.amountMinor / getMinorUnitsPerMajor(currency))
        : base.topupAmountMajor,
    targetCredits:
      config.topup.mode === 'target' ? String(config.topup.targetCredits) : base.targetCredits,
    targetUnit: config.topup.mode === 'target' ? 'credits' : base.targetUnit,
    maxRecharges: config.maxRecharges ? String(config.maxRecharges) : '',
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
  const targetDisplay = formatAmountWithUnit(form.targetCredits, form.targetUnit, currency)

  if (form.topupMode === 'fixed') {
    return `When my balance falls below ${thresholdDisplay}, add ${fixedDisplay}.`
  }
  return `When my balance falls below ${thresholdDisplay}, top up to ${targetDisplay}.`
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
