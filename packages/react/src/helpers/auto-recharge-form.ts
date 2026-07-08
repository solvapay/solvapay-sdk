import type {
  AutoRechargeConfig,
  AutoRechargeDisplayBlock,
  AutoRechargeInput,
} from '@solvapay/server'
import { formatPrice, getMinorUnitsPerMajor } from '../utils/format'
import { estimateCredits, estimateCurrencyMajorFromCredits } from '../utils/credit-estimation'
import { getStripeMinimumMinor } from './stripe-minimums'
import { interpolate } from '../i18n/interpolate'

/**
 * Localized validation copy for the auto-recharge form. Structurally compatible
 * with the `autoRecharge` slice of the SDK copy, so callers can pass `copy.autoRecharge`
 * directly. `minTopupAmount` and `topupBelowThreshold` are templates with `{amount}`.
 */
export type AutoRechargeValidationMessages = {
  invalidThreshold: string
  thresholdTooLow: string
  minTopupAmount: string
  topupBelowThreshold: string
}

const DEFAULT_VALIDATION_MESSAGES: AutoRechargeValidationMessages = {
  invalidThreshold: 'Enter a valid balance threshold.',
  thresholdTooLow: 'Balance threshold must be greater than zero.',
  minTopupAmount: 'Top-up amount must be at least {amount}.',
  topupBelowThreshold: 'Top-up amount must be at least your balance threshold ({amount}).',
}

export type AmountInputUnit = 'currency' | 'credits'

/** Last user-entered value + unit for a field; restored verbatim on flip-back (DEV-591). */
export type AmountInputAnchor = {
  value: string
  unit: AmountInputUnit
}

export type AutoRechargeFormState = {
  enabled: boolean
  thresholdAmountMajor: string
  thresholdUnit: AmountInputUnit
  thresholdBaseValue: string
  thresholdBaseUnit: AmountInputUnit
  topupAmountMajor: string
  topupUnit: AmountInputUnit
  topupBaseValue: string
  topupBaseUnit: AmountInputUnit
}

export type AutoRechargeConversionContext = {
  creditsPerMinorUnit?: number | null
  displayExchangeRate?: number | null
}

export type AutoRechargeInputPayload = AutoRechargeInput

function amountAnchors(
  thresholdValue: string,
  topupValue: string,
  unit: AmountInputUnit = 'currency',
): Pick<
  AutoRechargeFormState,
  'thresholdBaseValue' | 'thresholdBaseUnit' | 'topupBaseValue' | 'topupBaseUnit'
> {
  return {
    thresholdBaseValue: thresholdValue,
    thresholdBaseUnit: unit,
    topupBaseValue: topupValue,
    topupBaseUnit: unit,
  }
}

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
    ...amountAnchors(threshold, topup, 'currency'),
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
  messages: AutoRechargeValidationMessages = DEFAULT_VALIDATION_MESSAGES,
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

  const minorPerMajor = getMinorUnitsPerMajor(currency)
  const minMinor = getStripeMinimumMinor(currency)

  const thresholdRaw = parseNonNegativeNumber(form.thresholdAmountMajor)
  if (thresholdRaw == null) {
    return { ok: false, error: messages.invalidThreshold }
  }
  if (form.thresholdUnit === 'credits') {
    const major = estimateCurrencyMajorFromCredits(
      thresholdRaw,
      currency,
      conversion?.creditsPerMinorUnit,
      conversion?.displayExchangeRate,
    )
    if (major == null) {
      return { ok: false, error: messages.invalidThreshold }
    }
    payload.thresholdAmountMajor = major
  } else {
    payload.thresholdAmountMajor = thresholdRaw
  }

  // A zero (or effectively zero) threshold never triggers a recharge for a
  // non-overdrawable balance, silently defeating the feature.
  if (payload.thresholdAmountMajor == null || payload.thresholdAmountMajor <= 0) {
    return { ok: false, error: messages.thresholdTooLow }
  }

  const amountRaw = parsePositiveNumber(form.topupAmountMajor)
  if (amountRaw == null) {
    return {
      ok: false,
      error: interpolate(messages.minTopupAmount, {
        amount: formatPrice(minMinor, currency, { free: '' }),
      }),
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
  if (amountMajor == null || Math.round(amountMajor * minorPerMajor) < minMinor) {
    return {
      ok: false,
      error: interpolate(messages.minTopupAmount, {
        amount: formatPrice(minMinor, currency, { free: '' }),
      }),
    }
  }
  payload.topupAmountMajor = amountMajor

  // The top-up must clear the threshold, otherwise the recharge leaves the
  // balance below it and re-triggers on the next check.
  if (amountMajor < payload.thresholdAmountMajor) {
    return {
      ok: false,
      error: interpolate(messages.topupBelowThreshold, {
        amount: formatPrice(Math.round(payload.thresholdAmountMajor * minorPerMajor), currency, {
          free: '',
        }),
      }),
    }
  }

  return { ok: true, payload }
}

/** Derive display-currency major units from stored trigger minor units. */
function triggerAmountMajorFromConfig(config: AutoRechargeConfig): number | null {
  const topupCurrency = config.topup.currency.toUpperCase()
  const minorPerMajor = getMinorUnitsPerMajor(topupCurrency)
  const { thresholdAmountMinor } = config.trigger
  if (!Number.isFinite(thresholdAmountMinor) || thresholdAmountMinor < 0) {
    return null
  }
  return thresholdAmountMinor / minorPerMajor
}

/** Map a persisted config back to a payment-intent auto-recharge payload. */
export function configToAutoRechargeInput(
  config: AutoRechargeConfig,
  options?: {
    display?: AutoRechargeDisplayBlock | null
    currency?: string
    conversion?: { creditsPerMinorUnit?: number | null; displayExchangeRate?: number | null }
  },
): AutoRechargeInput | null {
  if (!config.enabled) return null

  const display = options?.display ?? config.display
  const currency = (
    display?.currency ??
    config.topup.currency ??
    options?.currency ??
    'USD'
  ).toUpperCase()

  if (display?.thresholdAmountMajor != null && display.topupAmountMajor != null) {
    return {
      enabled: true,
      triggerType: 'balance',
      thresholdAmountMajor: display.thresholdAmountMajor,
      topupAmountMajor: display.topupAmountMajor,
      currency,
    }
  }

  const thresholdMajor = triggerAmountMajorFromConfig(config)
  const topupAmountMajor = config.topup.amountMinor / getMinorUnitsPerMajor(currency)

  if (thresholdMajor == null || !Number.isFinite(topupAmountMajor) || topupAmountMajor <= 0) {
    return null
  }

  return {
    enabled: true,
    triggerType: 'balance',
    thresholdAmountMajor: Math.max(0, thresholdMajor),
    topupAmountMajor,
    currency,
  }
}

export function configToForm(config: AutoRechargeConfig, currency: string): AutoRechargeFormState {
  const base = createDefaultAutoRechargeForm(currency)

  // Prefer the backend-computed display block verbatim. When absent, derive major
  // units from stored trigger/top-up minor amounts with a currency-correct divisor.
  const display = config.display
  if (display?.thresholdAmountMajor != null && display.topupAmountMajor != null) {
    const thresholdStr = String(Math.max(0, display.thresholdAmountMajor))
    const topupStr = String(display.topupAmountMajor)
    return {
      ...base,
      enabled: config.enabled,
      thresholdAmountMajor: thresholdStr,
      topupAmountMajor: topupStr,
      ...amountAnchors(thresholdStr, topupStr, 'currency'),
    }
  }

  const thresholdMajor = triggerAmountMajorFromConfig(config)
  const thresholdStr = thresholdMajor != null ? String(Math.max(0, thresholdMajor)) : '0'
  const topupStr = String(config.topup.amountMinor / getMinorUnitsPerMajor(currency))
  return {
    ...base,
    enabled: config.enabled,
    thresholdAmountMajor: thresholdStr,
    topupAmountMajor: topupStr,
    ...amountAnchors(thresholdStr, topupStr, 'currency'),
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

export function buildSummaryLine(form: AutoRechargeFormState, currency: string): string | null {
  if (!form.enabled) return null
  const thresholdDisplay = formatAmountWithUnit(
    form.thresholdAmountMajor,
    form.thresholdUnit,
    currency,
  )
  const fixedDisplay = formatAmountWithUnit(form.topupAmountMajor, form.topupUnit, currency)
  return `When my balance falls below ${thresholdDisplay}, add ${fixedDisplay}.`
}

export function payloadToForm(
  payload: AutoRechargeInputPayload,
  currency: string,
): AutoRechargeFormState {
  const base = createDefaultAutoRechargeForm(currency)
  if (!payload.enabled) {
    return { ...base, enabled: false }
  }
  const thresholdStr = String(payload.thresholdAmountMajor ?? base.thresholdAmountMajor)
  const topupStr = String(payload.topupAmountMajor ?? base.topupAmountMajor)
  return {
    ...base,
    enabled: true,
    thresholdAmountMajor: thresholdStr,
    thresholdUnit: 'currency',
    topupAmountMajor: topupStr,
    topupUnit: 'currency',
    ...amountAnchors(thresholdStr, topupStr, 'currency'),
  }
}

export function buildSummaryLineFromPayload(
  payload: AutoRechargeInputPayload,
  currency: string,
): string | null {
  if (!payload.enabled) return null
  const thresholdDisplay = formatAmountWithUnit(
    String(payload.thresholdAmountMajor ?? 0),
    'currency',
    currency,
  )
  const fixedDisplay = formatAmountWithUnit(
    String(payload.topupAmountMajor ?? 0),
    'currency',
    currency,
  )
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

export function flipUnitValue(
  anchor: AmountInputAnchor,
  targetUnit: AmountInputUnit,
  currency: string,
  creditsPerMinorUnit?: number | null,
  displayExchangeRate?: number | null,
): { value: string; unit: AmountInputUnit } {
  if (targetUnit === anchor.unit) {
    return { value: anchor.value, unit: anchor.unit }
  }
  const converted = convertAmountForUnitFlip(
    anchor.value,
    anchor.unit,
    targetUnit,
    currency,
    creditsPerMinorUnit,
    displayExchangeRate,
  )
  return { value: converted, unit: targetUnit }
}
