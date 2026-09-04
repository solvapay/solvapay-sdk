/**
 * WASM-free `@solvapay/core` install for the single-file MCP App widget.
 *
 * Host CSP rejects embedded WebAssembly, and the widget HTML is served as
 * an iframe document with no origin to fetch a `.wasm` from. Views still
 * call `formatPrice` / pricing readers through `dispatchSync`.
 */

import { installNativeCoreApi, type NativeCoreSyncMethod } from '@solvapay/core'

const ZERO_DECIMAL = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
])

const SYMBOLS: Record<string, { symbol: string; prefix: boolean }> = {
  USD: { symbol: '$', prefix: true },
  EUR: { symbol: '€', prefix: true },
  GBP: { symbol: '£', prefix: true },
  JPY: { symbol: '¥', prefix: true },
  CAD: { symbol: 'C$', prefix: true },
  AUD: { symbol: 'A$', prefix: true },
  CHF: { symbol: 'CHF', prefix: true },
  CNY: { symbol: '¥', prefix: true },
  HKD: { symbol: 'HK$', prefix: true },
  NZD: { symbol: 'NZ$', prefix: true },
  SEK: { symbol: 'kr', prefix: false },
  KRW: { symbol: '₩', prefix: true },
  SGD: { symbol: 'S$', prefix: true },
  NOK: { symbol: 'kr', prefix: false },
  MXN: { symbol: '$', prefix: true },
  INR: { symbol: '₹', prefix: true },
  RUB: { symbol: '₽', prefix: true },
  ZAR: { symbol: 'R', prefix: true },
  TRY: { symbol: '₺', prefix: true },
  BRL: { symbol: 'R$', prefix: true },
  DKK: { symbol: 'kr', prefix: false },
  ISK: { symbol: 'kr', prefix: false },
  PLN: { symbol: 'zł', prefix: false },
  CZK: { symbol: 'Kč', prefix: false },
  HUF: { symbol: 'Ft', prefix: false },
  RON: { symbol: 'lei', prefix: false },
  THB: { symbol: '฿', prefix: true },
  MYR: { symbol: 'RM', prefix: true },
  PHP: { symbol: '₱', prefix: true },
  IDR: { symbol: 'Rp', prefix: true },
  VND: { symbol: '₫', prefix: true },
  TWD: { symbol: 'NT$', prefix: true },
  ILS: { symbol: '₪', prefix: true },
  AED: { symbol: 'د.إ', prefix: true },
  SAR: { symbol: 'ر.س', prefix: true },
  CLP: { symbol: '$', prefix: true },
  COP: { symbol: '$', prefix: true },
  ARS: { symbol: '$', prefix: true },
  PEN: { symbol: 'S/', prefix: true },
  UYU: { symbol: '$U', prefix: true },
  EGP: { symbol: '£', prefix: true },
  NGN: { symbol: '₦', prefix: true },
  KES: { symbol: 'KSh', prefix: true },
  UGX: { symbol: 'USh', prefix: false },
  RWF: { symbol: 'RF', prefix: false },
  BIF: { symbol: 'FBu', prefix: false },
  DJF: { symbol: 'Fdj', prefix: false },
  GNF: { symbol: 'FG', prefix: false },
  KMF: { symbol: 'CF', prefix: false },
  MGA: { symbol: 'Ar', prefix: false },
  PYG: { symbol: '₲', prefix: true },
  XOF: { symbol: 'CFA', prefix: false },
  XAF: { symbol: 'FCFA', prefix: false },
  XPF: { symbol: '₣', prefix: true },
  VUV: { symbol: 'Vt', prefix: false },
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL.has(currency.toLowerCase())
}

function minorUnitsPerMajor(currency: string): number {
  return isZeroDecimalCurrency(currency) ? 1 : 100
}

function toMajorUnits(amountMinor: number, currency: string): number {
  return isZeroDecimalCurrency(currency) ? amountMinor : amountMinor / 100
}

function formatGroupedMajor(major: number, fraction: number): string {
  const intPart = Math.trunc(major)
  const digits = String(Math.abs(intPart)).split('')
  let grouped = ''
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ','
    grouped += digits[i]
  }
  const sign = major < 0 || Object.is(major, -0) ? '-' : ''
  if (fraction === 0) return `${sign}${grouped}`
  const scale = 10 ** fraction
  const frac = Math.round(Math.abs(major) * scale) % scale
  return `${sign}${grouped}.${String(frac).padStart(fraction, '0')}`
}

function applySymbol(formatted: string, currency: string, display: string | null): string {
  const code = currency.toUpperCase()
  if (display?.trim().toLowerCase() === 'code') {
    return `${code}\u00a0${formatted}`
  }
  const entry = SYMBOLS[code]
  if (!entry || entry.symbol === code) return `${code}\u00a0${formatted}`
  return entry.prefix ? `${entry.symbol}${formatted}` : `${formatted}\u00a0${entry.symbol}`
}

function formatPrice(args: Record<string, unknown>): string {
  const amountMinor = asNumber(args.amountMinor) ?? 0
  const currency = asString(args.currency) ?? 'USD'
  const free = args.free === null || args.free === undefined ? 'Free' : String(args.free)
  if (amountMinor === 0 && free !== '') return free

  const natural = isZeroDecimalCurrency(currency) ? 0 : 2
  const minorPerMajor = minorUnitsPerMajor(currency)
  const isWhole = minorPerMajor !== 0 && Math.abs(amountMinor % minorPerMajor) < Number.EPSILON
  const formatted = applySymbol(
    formatGroupedMajor(toMajorUnits(amountMinor, currency), isWhole ? 0 : natural),
    currency,
    asString(args.currencyDisplay) ?? null,
  )
  const interval = asString(args.interval)?.trim()
  if (!interval) return formatted
  const count = asNumber(args.intervalCount) ?? 1
  const suffix = count > 1 ? `${count} ${interval}s` : interval
  return `${formatted} / ${suffix}`
}

function creditsToDisplayMinorUnits(args: Record<string, unknown>): number | null {
  const credits = asNumber(args.credits) ?? 0
  const creditsPerMinorUnit = asNumber(args.creditsPerMinorUnit) ?? 0
  if (creditsPerMinorUnit <= 0) return null
  const rate = asNumber(args.displayExchangeRate) || 1
  const displayCurrency = asString(args.displayCurrency) ?? 'USD'
  const usdMajor = credits / creditsPerMinorUnit / 100
  return Math.round(usdMajor * rate * minorUnitsPerMajor(displayCurrency))
}

function normalizeOptional(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function resolveSellerIdentityDisplay(args: Record<string, unknown>): {
  taxIdentifier: { label: string; value: string } | null
  companyNumber: { label: string; value: string } | null
} {
  const country = normalizeOptional(args.country)?.toUpperCase()
  const vatNumber = normalizeOptional(args.vatNumber)
  const taxId = normalizeOptional(args.taxId)
  const companyNumber = normalizeOptional(args.companyNumber)
  const taxValue = country === 'US' ? (taxId ?? companyNumber) : (vatNumber ?? taxId)
  const taxLabel = country === 'US' ? 'EIN' : country ? 'VAT number' : 'Tax ID'
  const taxIdentifier = taxValue ? { label: taxLabel, value: taxValue } : null
  const companyValue = companyNumber ?? taxId
  const companyRow =
    companyValue && companyValue !== taxIdentifier?.value
      ? { label: 'Company number', value: companyValue }
      : null
  return { taxIdentifier, companyNumber: companyRow }
}

type Charge = {
  per: string
  amountMinor: number
  currency: string
  meter?: string
  oneTime?: boolean
}

function optionsOf(priced: unknown): Record<string, unknown>[] {
  const options = asRecord(priced).options
  return Array.isArray(options)
    ? options.filter(item => item !== null && typeof item === 'object')
    : []
}

function asCharge(option: Record<string, unknown>): Charge | null {
  if (asString(option.kind) !== 'charge') return null
  const per = asString(option.per)
  const amountMinor = asNumber(option.amountMinor)
  const currency = asString(option.currency)
  if (!per || amountMinor === undefined || !currency) return null
  const meter = asString(option.meter)
  const oneTime = option.oneTime === true ? true : undefined
  return {
    per,
    amountMinor,
    currency,
    ...(meter ? { meter } : {}),
    ...(oneTime ? { oneTime } : {}),
  }
}

function charges(priced: unknown): Charge[] {
  return optionsOf(priced)
    .map(asCharge)
    .filter((charge): charge is Charge => charge !== null)
}

function headlineCharges(priced: unknown): Charge[] {
  const flat = charges(priced).filter(charge => charge.per === 'flat')
  const base = flat.filter(charge => charge.oneTime !== true)
  const source = base.length === 0 ? flat : base
  const seen = new Set<string>()
  return source.filter(charge => {
    const key = charge.currency.toUpperCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function perUnitCharge(priced: unknown, meter: string | null): Charge | null {
  const unit = charges(priced).filter(charge => charge.per === 'unit')
  if (meter) return unit.find(charge => charge.meter === meter) ?? null
  return unit[0] ?? null
}

function countsUsage(priced: unknown): boolean {
  if (perUnitCharge(priced, null)) return true
  return optionsOf(priced).some(option => {
    const kind = asString(option.kind)
    return kind === 'tier' || kind === 'limit'
  })
}

const handlers: Partial<Record<NativeCoreSyncMethod, (args: Record<string, unknown>) => unknown>> =
  {
    formatPrice,
    toMajorUnits: args =>
      toMajorUnits(asNumber(args.amountMinor) ?? 0, asString(args.currency) ?? 'USD'),
    minorUnitsPerMajor: args => minorUnitsPerMajor(asString(args.currency) ?? 'USD'),
    isZeroDecimalCurrency: args => isZeroDecimalCurrency(asString(args.currency) ?? 'USD'),
    creditsToDisplayMinorUnits,
    resolveSellerIdentityDisplay,
    charges: args => charges(args.priced),
    headlineCharges: args => headlineCharges(args.priced),
    perUnitCharge: args => perUnitCharge(args.priced, asString(args.meter) ?? null),
    countsUsage: args => countsUsage(args.priced),
  }

export function installWidgetCoreSync(): void {
  installNativeCoreApi({
    callNativeSync: (fn, argsJson) => {
      const handler = handlers[fn]
      if (!handler) {
        throw new Error(`core sync API not installed (${fn})`)
      }
      return handler(asRecord(JSON.parse(argsJson) as unknown))
    },
  })
}
