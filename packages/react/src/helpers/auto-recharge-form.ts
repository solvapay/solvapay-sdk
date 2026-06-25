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
        amount: formatPrice(
          Math.round(payload.thresholdAmountMajor * minorPerMajor),
          currency,
          { free: '' },
        ),
      }),
    }
  }

  return { ok: true, payload }
}

/** Map a persisted config back to a payment-intent auto-recharge payload. */
export function configToAutoRechargeInput(
  config: AutoRechargeConfig,
  options?: {
    display?: AutoRechargeDisplayBlock | null
    currency?: string
    conversion?: AutoRechargeConversionContext
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

  const thresholdMajor = estimateCurrencyMajorFromCredits(
    config.trigger.thresholdCredits,
    currency,
    options?.conversion?.creditsPerMinorUnit,
    options?.conversion?.displayExchangeRate,
  )
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

export function configToForm(
  config: AutoRechargeConfig,
  currency: string,
  conversion?: AutoRechargeConversionContext,
): AutoRechargeFormState {
  const base = createDefaultAutoRechargeForm(currency)

  // Prefer the backend-computed display block verbatim — it already encodes the
  // correct credits/currency scaling. The credit-derived fallback below only runs
  // when `display` is absent (DEV-586), and must thread the real creditsPerMinorUnit
  // and a currency-correct minor divisor rather than assuming a 2-decimal /100.
  const display = config.display
  if (display?.thresholdAmountMajor != null && display.topupAmountMajor != null) {
    return {
      ...base,
      enabled: config.enabled,
      thresholdAmountMajor: String(Math.max(0, display.thresholdAmountMajor)),
      topupAmountMajor: String(display.topupAmountMajor),
    }
  }

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

export function payloadToForm(
  payload: AutoRechargeInputPayload,
  currency: string,
): AutoRechargeFormState {
  const base = createDefaultAutoRechargeForm(currency)
  if (!payload.enabled) {
    return { ...base, enabled: false }
  }
  return {
    ...base,
    enabled: true,
    thresholdAmountMajor: String(payload.thresholdAmountMajor ?? base.thresholdAmountMajor),
    thresholdUnit: 'currency',
    topupAmountMajor: String(payload.topupAmountMajor ?? base.topupAmountMajor),
    topupUnit: 'currency',
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
