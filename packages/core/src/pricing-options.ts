/**
 * Readers for the backend's composable `options[]` pricing model.
 *
 * Every plan-shaped payload the SDK receives — the catalog list
 * (`GET /v1/sdk/products/:ref/plans`), the frozen `planSnapshot` on a
 * purchase, and the `plans[]` on a limits response — describes its
 * pricing as an ordered list of `options`, each with a `kind`. The
 * legacy scalars (`planType`, `creditsPerUnit`, `billingCycle`,
 * `pricingOptions`, `freeUnits`) are NOT on any of those wires; the
 * backend derives them from `options` and only publishes the coarse
 * `type` label. These helpers are the SDK's single reader for that
 * model so no surface has to re-guess the shape.
 *
 * Options are read structurally rather than parsed: the wire types the
 * generated client exposes are `Record<string, unknown>`, and a plan
 * carrying an option kind this SDK version doesn't know about must
 * still render its charges.
 */

/** One entry of a plan's `options[]`. Narrowed by the readers below. */
export type PricingOptionLike = Record<string, unknown>

/** Anything carrying composable pricing — a catalog plan or a frozen snapshot. */
export interface PricedLike {
  options?: readonly PricingOptionLike[] | null
}

/**
 * A charge option. `amountMinor` is in `currency`'s minor units — for a
 * `per: 'unit'` charge this is the metered rate, NOT a credit amount.
 * Converting it to credits needs the FX peg; see `peggedCreditsPerUnit`.
 */
export interface ChargeLike {
  per: 'flat' | 'unit' | 'seat'
  amountMinor: number
  currency: string
  meter?: string
  oneTime?: boolean
}

/** A billing-cycle option — present only on recurring plans. */
export interface BillingCycleLike {
  interval: 'week' | 'month' | 'year'
  count?: number
}

function isRecord(value: unknown): value is PricingOptionLike {
  return typeof value === 'object' && value !== null
}

function optionsOf(priced: PricedLike | null | undefined): PricingOptionLike[] {
  const options = priced?.options
  return Array.isArray(options) ? options.filter(isRecord) : []
}

function asCharge(option: PricingOptionLike): ChargeLike | null {
  if (option.kind !== 'charge') return null
  const { per, amountMinor, currency } = option
  if (per !== 'flat' && per !== 'unit' && per !== 'seat') return null
  if (typeof amountMinor !== 'number' || typeof currency !== 'string') return null
  return {
    per,
    amountMinor,
    currency,
    ...(typeof option.meter === 'string' ? { meter: option.meter } : {}),
    ...(option.oneTime === true ? { oneTime: true } : {}),
  }
}

/** Every charge option on the plan, in wire order. */
export function charges(priced: PricedLike | null | undefined): ChargeLike[] {
  return optionsOf(priced)
    .map(asCharge)
    .filter((charge): charge is ChargeLike => charge !== null)
}

/**
 * The recurring or one-time flat charge in each currency the plan
 * prices, in first-seen order. A multi-currency plan carries one flat
 * charge per currency (amounts are set per currency, not FX-converted),
 * so this is the list a price row should render.
 *
 * Setup fees (`oneTime` alongside a base charge) are excluded — they are
 * not the headline price.
 */
export function headlineCharges(priced: PricedLike | null | undefined): ChargeLike[] {
  const flat = charges(priced).filter(charge => charge.per === 'flat')
  const base = flat.filter(charge => !charge.oneTime)
  const source = base.length > 0 ? base : flat
  const seen = new Set<string>()
  return source.filter(charge => {
    const key = charge.currency.toUpperCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * The plan's metered charge — the first `per: 'unit'` charge, optionally
 * restricted to one meter. `null` when the plan doesn't meter usage.
 */
export function perUnitCharge(
  priced: PricedLike | null | undefined,
  meter?: string,
): ChargeLike | null {
  const unitCharges = charges(priced).filter(charge => charge.per === 'unit')
  if (meter) return unitCharges.find(charge => charge.meter === meter) ?? null
  return unitCharges[0] ?? null
}

/** The plan's billing cycle, or `null` for a one-time or pure usage-based plan. */
export function billingCycle(priced: PricedLike | null | undefined): BillingCycleLike | null {
  for (const option of optionsOf(priced)) {
    if (option.kind !== 'billingCycle') continue
    const { interval, count } = option
    if (interval !== 'week' && interval !== 'month' && interval !== 'year') continue
    return { interval, ...(typeof count === 'number' && count > 1 ? { count } : {}) }
  }
  return null
}

/** Free trial length in days, or `null` when the plan has no trial. */
export function trialDays(priced: PricedLike | null | undefined): number | null {
  for (const option of optionsOf(priced)) {
    if (option.kind !== 'trial') continue
    if (typeof option.days === 'number' && option.days > 0) return option.days
  }
  return null
}

/**
 * Included units for a meter, from its limit option. The backend uses
 * `cap: 0` to mean unlimited, which this preserves — callers must treat
 * `0` as "no ceiling", not "nothing included". `null` when the meter
 * carries no limit.
 */
export function includedUnits(
  priced: PricedLike | null | undefined,
  meter?: string,
): number | null {
  for (const option of optionsOf(priced)) {
    if (option.kind !== 'limit') continue
    if (meter && option.meter !== meter) continue
    if (typeof option.cap === 'number') return option.cap
  }
  return null
}

/**
 * Credits consumed per metered unit for a charge of `chargeMinor` in the
 * charge currency, given the USD → charge-currency rate.
 *
 * Mirrors the backend's `peggedCreditsPerUnit`, which is the single
 * definition the debit engine and the paywall both derive from. Keep the
 * two in step: they diverged once (DEV-691), and the paywall
 * over-reported remaining units by 100×.
 *
 * The caller is responsible for establishing that `usdToChargeRate`
 * really is the rate for the charge's currency — see
 * `creditsPerUnitFromBalance`, which will not guess.
 */
export function peggedCreditsPerUnit(
  chargeMinor: number,
  creditsPerMinorUnit: number,
  usdToChargeRate = 1,
): number {
  if (!(chargeMinor > 0) || !(creditsPerMinorUnit > 0)) return 0
  const rate = usdToChargeRate > 0 ? usdToChargeRate : 1
  return Math.round((chargeMinor / rate) * creditsPerMinorUnit)
}

/** The FX-bearing fields of a customer balance, as shipped on the bootstrap payload. */
export interface BalancePegLike {
  displayCurrency?: string | null
  displayExchangeRate?: number | null
  creditsPerMinorUnit?: number | null
}

/**
 * Credits per metered call for `priced`, priced against a customer's
 * balance peg. `null` when it cannot be established honestly.
 *
 * The backend converts a per-unit charge to credits with
 * `resolveDisplayFx(chargeCurrency)`. A balance carries
 * `resolveDisplayFx(provider.defaultCurrency)` as `displayExchangeRate`,
 * so the two agree only when the charge is denominated in the balance's
 * `displayCurrency`. When they differ the SDK does not hold the right
 * rate and returns `null` rather than publishing a number that would be
 * wrong by the FX ratio.
 */
export function creditsPerUnitFromBalance(
  priced: PricedLike | null | undefined,
  balance: BalancePegLike | null | undefined,
  meter?: string,
): number | null {
  const charge = perUnitCharge(priced, meter)
  if (!charge || !(charge.amountMinor > 0)) return null

  const displayCurrency = balance?.displayCurrency
  const creditsPerMinorUnit = balance?.creditsPerMinorUnit
  if (typeof displayCurrency !== 'string' || typeof creditsPerMinorUnit !== 'number') return null
  if (charge.currency.toUpperCase() !== displayCurrency.toUpperCase()) return null

  const credits = peggedCreditsPerUnit(
    charge.amountMinor,
    creditsPerMinorUnit,
    balance?.displayExchangeRate ?? 1,
  )
  return credits > 0 ? credits : null
}
