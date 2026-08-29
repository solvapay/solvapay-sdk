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

/**
 * One band of a tiered price. `[from, to)` in metered units, with `to:
 * null` marking the unbounded top band. The rate rides an embedded
 * per-unit `charge`, so a tier-priced meter carries NO standalone
 * `per: 'unit'` charge — every reader that only looks at `charges()`
 * sees a tiered plan as unpriced.
 *
 * A plan may price several meters, one band stack each; `tierBands`
 * groups them, because the wire is a flat list of `tier` options with no
 * grouping and no ordering guarantee.
 */
export interface TierLike {
  from: number
  to: number | null
  mode: 'graduated' | 'volume'
  charge: ChargeLike
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

function asTier(option: PricingOptionLike): TierLike | null {
  if (option.kind !== 'tier') return null
  const { from, to, mode } = option
  if (typeof from !== 'number') return null
  if (to !== null && typeof to !== 'number') return null
  if (mode !== 'graduated' && mode !== 'volume') return null
  if (!isRecord(option.charge)) return null
  const charge = asCharge({ ...option.charge, kind: 'charge' })
  if (!charge) return null
  return { from, to: to as number | null, mode, charge }
}

/**
 * The tier bands a plan prices `meter` with, ordered by band floor.
 *
 * Without a `meter` this returns the first tiered meter's stack — the
 * common single-meter case. It never mixes two meters' bands: on the
 * wire they interleave, and reading them as one stack prices usage from
 * whichever meter happens to sort first.
 *
 * Empty when the plan has no bands (for that meter).
 */
export function tierBands(
  priced: PricedLike | null | undefined,
  meter?: string,
): TierLike[] {
  const all = optionsOf(priced)
    .map(asTier)
    .filter((tier): tier is TierLike => tier !== null)
  if (all.length === 0) return []
  const target = meter ?? all[0].charge.meter
  return all
    .filter(tier => (target == null ? true : tier.charge.meter === target))
    .sort((a, b) => a.from - b.from)
}

/** Every meter the plan prices with tier bands, in first-seen order. */
export function tierMeters(priced: PricedLike | null | undefined): string[] {
  const seen: string[] = []
  for (const option of optionsOf(priced)) {
    const tier = asTier(option)
    const meter = tier?.charge.meter
    if (meter && !seen.includes(meter)) seen.push(meter)
  }
  return seen
}

/** What one metered unit costs, and whether that rate is the first of several bands. */
export interface UsageRate extends ChargeLike {
  /**
   * True when the plan prices this meter in bands, so `amountMinor` is
   * the ENTRY rate and later units may cost more or less. Surfaces
   * should present it as a floor ("from $0.02 / call"), never as the
   * price of every unit.
   */
  tiered: boolean
}

/**
 * The rate a plan charges for one metered unit — a standalone per-unit
 * charge, else the entry band of the meter's tier stack. `null` when the
 * plan prices no usage.
 *
 * This is the reader every "what does a call cost" surface wants.
 * `perUnitCharge` alone answers `null` for a tiered plan, which is why
 * tiered plans rendered no price at all.
 */
export function usageRate(
  priced: PricedLike | null | undefined,
  meter?: string,
): UsageRate | null {
  // A ZERO-rate per-unit charge does not price the meter — it exists to anchor
  // an allowance to one — so it must not short-circuit the bands. A plan
  // carrying both (authorable through the API, though the builder now blocks
  // it) would otherwise report a rate of 0 and render no price at all.
  const charge = perUnitCharge(priced, meter)
  if (charge && charge.amountMinor > 0) return { ...charge, tiered: false }

  // Lead with the first band that actually charges: a stack opening with a free
  // band is still a paid plan, and "from $0.00" is not its price.
  const priced_ = tierBands(priced, meter).filter(band => band.charge.amountMinor > 0)
  if (priced_.length > 0) {
    return { ...priced_[0].charge, tiered: priced_.length > 1 }
  }
  return charge ? { ...charge, tiered: false } : null
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
  return firstLimit(priced, meter)?.cap ?? null
}

/**
 * The meter a plan counts against: the per-unit charge's meter, else
 * the first limit option's meter. `null` when neither names one.
 */
export function meterName(priced: PricedLike | null | undefined): string | null {
  const fromCharge = perUnitCharge(priced)?.meter
  if (fromCharge) return fromCharge
  // A tier-priced meter has no standalone per-unit charge, and a pure
  // pay-as-you-go tier plan carries no limit either, so without this a
  // tiered plan reported no meter at all.
  const fromTier = tierMeters(priced)[0]
  if (fromTier) return fromTier
  const fromLimit = firstLimit(priced)?.meter
  return fromLimit ?? null
}

/**
 * True when the plan counts usage: a per-unit charge, a tier, or a limit.
 * Distinct from "prices per unit" — a free allowance has a limit and no
 * rate, and still needs a usage counter.
 */
export function countsUsage(priced: PricedLike | null | undefined): boolean {
  if (perUnitCharge(priced) != null) return true
  if (includedUnits(priced) != null) return true
  return tierBands(priced).length > 0
}

function firstLimit(
  priced: PricedLike | null | undefined,
  meter?: string,
): { cap: number; meter: string | null } | null {
  for (const option of optionsOf(priced)) {
    if (option.kind !== 'limit') continue
    if (meter && option.meter !== meter) continue
    if (typeof option.cap !== 'number') continue
    return {
      cap: option.cap,
      meter: typeof option.meter === 'string' && option.meter.length > 0 ? option.meter : null,
    }
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
  // `usageRate` falls back to the entry band, so a tiered plan reports the
  // credits its FIRST unit costs instead of nothing. On a graduated stack
  // later units cost their own bands' rates — callers presenting this
  // figure should frame it as a floor (see `tiered` on the rate).
  const charge = usageRate(priced, meter)
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
