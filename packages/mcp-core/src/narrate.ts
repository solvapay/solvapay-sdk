/**
 * Narrator map — one function per intent tool that renders a sparse,
 * text-friendly markdown summary of the bootstrap payload.
 *
 * Style rules (see the discoverable-UX plan for rationale):
 *  1. First line is a single `**bold title**` — no headings.
 *  2. Body uses `Label: value` rows (one per line). Inline `·`
 *     separator for compound values. No bullet lists.
 *  3. Recovery is a named tool call with arguments, never a slash
 *     command — slash names are host prompt UI a model cannot fire.
 *  4. External URLs are named markdown links (`[Open checkout](url)`)
 *     plus a matching `resource_link` block. Never dump the raw URL
 *     as the visible label — hosts render the name; the href stays
 *     in the text for the model and for terminals that do not render
 *     markdown.
 *
 * Missing fields skip their row entirely — we never emit `Balance: —`
 * or `Customer: unknown`. A narrator returning just `title + 1 row`
 * is still well-formed.
 */

import {
  billingCycle,
  charges,
  countsUsage,
  creditsPerUnitFromBalance,
  creditsToDisplayMinorUnits,
  headlineCharges,
  includedUnits,
  isZeroDecimalCurrency,
  meterName,
  planPricingShape,
  trialDays,
  usageRate,
  type PricingOptionLike,
} from '@solvapay/core'
import { creditSignals, type LimitResponseWithPlan } from '@solvapay/server'
import type { BootstrapPayload, SolvaPayMcpViewKind } from './types'
import { MCP_TOOL_NAMES, VIEWER_TOOL_NAME } from './tool-names'
import { selectActivePlanPurchase } from './active-purchase'

export interface NarratorOutput {
  text: string
  links?: Array<{ uri: string; name: string }>
}

/**
 * A plan as `GET /v1/sdk/products/:ref/plans` actually ships it. Pricing
 * lives in `options[]`; the only scalars the backend derives onto the
 * wire are the coarse `type` label, the headline `price`/`currency`, and
 * `requiresPayment`. There is no `planType`, `creditsPerUnit`,
 * `billingCycle`, or `pricingOptions` — read those through the
 * `@solvapay/core` option helpers.
 */
interface PlanShape {
  name?: string
  type?: string
  price?: number
  currency?: string
  requiresPayment?: boolean
  options?: PricingOptionLike[]
  reference?: string
}

/**
 * Frozen plan captured on a purchase. Deliberately separate from
 * `PlanShape`: the snapshot carries `isMetered` and no `type` or
 * `requiresPayment`. It does carry the plan's `options[]` frozen at
 * purchase time, which is what the customer is actually billed on.
 */
interface PlanSnapshotShape {
  name?: string
  price?: number
  currency?: string
  options?: PricingOptionLike[]
  isMetered?: boolean
  requiresPayment?: boolean
  reference?: string
}

interface PurchaseShape {
  status?: string
  productRef?: string
  planRef?: string
  planSnapshot?: PlanSnapshotShape | null
  amount?: number
  currency?: string
  startDate?: string
  endDate?: string
  cancelledAt?: string | null
  isRecurring?: boolean
  /** Lives on the purchase, not the snapshot, which freezes only `options`. */
  billingCycle?: string | null
  metadata?: { purpose?: string }
}

interface UsageShape {
  used?: number
  total?: number | null
  remaining?: number | null
  periodEnd?: string
  meterRef?: string | null
}

interface LimitsShape {
  remaining?: number | null
  withinLimits?: boolean | null
  activationRequired?: boolean | null
  overage?: boolean | null
  needsTopUp?: boolean | null
  needsUpgrade?: boolean | null
  throttled?: boolean | null
  planRef?: string | null
  planName?: string | null
  creditBalance?: number
  creditsPerUnit?: number
  balance?: {
    creditBalance?: number
    creditsPerUnit?: number
    remainingUnits?: number
  }
}

interface CustomerShape {
  ref?: string
  balance?: {
    credits?: number | null
    displayCurrency?: string
    displayExchangeRate?: number
    creditsPerMinorUnit?: number
  } | null
  usage?: UsageShape | null
  limits?: LimitsShape | null
  purchase?: { purchases?: PurchaseShape[] } | null
  autoRecharge?: { enabled?: boolean; status?: string } | null
}

function formatMoney(
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (amountMinor == null || !currency) return null
  const zero = isZeroDecimalCurrency(currency)
  const major = zero ? amountMinor : amountMinor / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      maximumFractionDigits: zero ? 0 : 2,
    }).format(major)
  } catch {
    return `${currency.toUpperCase()} ${major.toFixed(zero ? 0 : 2)}`
  }
}

function formatShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatCompactMoney(
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  const money = formatMoney(amountMinor, currency)
  return money ? money.replace(/\.00(?!\d)/, '') : null
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function daysUntil(iso: string, now: Date): number | null {
  const end = new Date(iso)
  if (Number.isNaN(end.getTime())) return null
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / MS_PER_DAY))
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function meterUnit(meter: string | null | undefined, count: number): string {
  if (meter && meter !== 'requests') {
    return count === 1 && meter.endsWith('s') ? meter.slice(0, -1) : meter
  }
  return count === 1 ? 'call' : 'calls'
}

function activePurchase(data: BootstrapPayload): PurchaseShape | null {
  return selectActivePlanPurchase(
    (data.customer as CustomerShape | null)?.purchase?.purchases,
    data.productRef,
  )
}

function limitsAsSignals(limits: LimitsShape | null | undefined): LimitResponseWithPlan | null {
  if (!limits) return null
  return limits as LimitResponseWithPlan
}

function preferLimitsPlan(
  purchase: PurchaseShape | null,
  limits: LimitsShape | null | undefined,
): boolean {
  const purchaseRef = purchase?.planRef ?? purchase?.planSnapshot?.reference
  const limitsRef = limits?.planRef
  return Boolean(limitsRef && purchaseRef && limitsRef !== purchaseRef)
}

function productName(data: BootstrapPayload): string {
  const name = (data.product as { name?: string } | undefined)?.name
  return typeof name === 'string' && name ? name : 'SolvaPay'
}

/**
 * Human-readable balance summary used by the `'ui'` mode placeholder.
 * Returns `null` when no balance is available so the caller can skip
 * the segment entirely.
 */
export function balanceSummary(customer: CustomerShape | null | undefined): string | null {
  const row = balanceRow(customer)
  if (!row) return null
  return row.replace(/^Balance:\s*/, '')
}

function balanceRow(customer: CustomerShape | null | undefined): string | null {
  if (!customer?.balance) return null
  const credits = customer.balance.credits ?? 0
  if (!credits && credits !== 0) return null
  const currency = customer.balance.displayCurrency
  const creditsPerMinorUnit = customer.balance.creditsPerMinorUnit
  const displayMinor =
    currency && typeof creditsPerMinorUnit === 'number' && creditsPerMinorUnit > 0
      ? creditsToDisplayMinorUnits({
          credits,
          creditsPerMinorUnit,
          displayExchangeRate: customer.balance.displayExchangeRate ?? 1,
          displayCurrency: currency,
        })
      : null
  const money = formatMoney(displayMinor, currency ?? null)
  const fmt = new Intl.NumberFormat('en-US').format(credits)
  return money ? `Balance: ${fmt} credits (~${money})` : `Balance: ${fmt} credits`
}

function recoveryLine(views: SolvaPayMcpViewKind[]): string {
  const calls = views.map(v => `\`${VIEWER_TOOL_NAME}\` with view: "${v}"`).join(' or ')
  return `To continue, call ${calls}.`
}

/**
 * Every currency the plan prices its headline charge in. A
 * multi-currency plan carries one flat charge per currency in
 * `options[]`; the derived top-level `price` collapses that to the
 * default currency, so it is only a fallback for plans whose options
 * this SDK can't read.
 */
function formatPlanPrices(p: PlanShape): string {
  const shape = planPricingShape(p)
  const charges = headlineCharges(p)
  if (charges.length > 0) {
    return charges
      .map(charge => formatMoney(charge.amountMinor, charge.currency))
      .filter((value): value is string => value != null)
      .join(' · ')
  }

  // No flat charge: a pay-as-you-go plan, priced per unit or in bands. Its
  // derived top-level `price` is 0, so falling straight through to it
  // announced a paid plan as free. Lead with the rate instead, marked as a
  // floor when the plan prices in bands.
  const rate = shape.rate ?? usageRate(p)
  if (rate && rate.amountMinor > 0) {
    const money = formatMoney(rate.amountMinor, rate.currency)
    if (money != null) {
      const unit = rate.meter ?? meterName(p) ?? 'unit'
      return `${rate.tiered ? 'from ' : ''}${money} / ${unit}`
    }
  }

  return [formatMoney(p.price, p.currency)]
    .filter((value): value is string => value != null)
    .join(' · ')
}

/** A free plan is one that requires no payment — there is no `'free'` plan type. */
function isFreePlan(p: PlanShape): boolean {
  return p.requiresPayment === false
}

function planTypeLabel(p: PlanShape): string {
  if (isFreePlan(p)) return 'no payment required'
  switch (planPricingShape(p).shape) {
    case 'usage':
      return 'pay as you go'
    case 'hybrid':
      return 'subscription + usage'
    case 'oneTime':
      return 'one-time'
    default:
      return 'recurring'
  }
}

function formatCycle(p: PlanShape): string {
  const cycle = planPricingShape(p).cycle ?? billingCycle(p)
  if (!cycle) return ''
  return cycle.count ? `/${cycle.count} ${cycle.interval}s` : `/${cycle.interval}`
}

function plansListLines(plans: PlanShape[]): string[] {
  return plans.map(p => {
    const name = p.name ?? 'Plan'
    const parts = [name, planTypeLabel(p)]

    const price = formatPlanPrices(p)
    if (price && !isFreePlan(p)) parts.push(`${price}${formatCycle(p)}`)

    const trial = trialDays(p)
    if (trial) parts.push(`${trial}-day trial`)

    if (p.reference) parts.push(`planRef: ${p.reference}`)

    return parts.join(' · ')
  })
}

const CHECKOUT_TTL = 'expires in 15 minutes'

function httpsUrl(value: string | null | undefined): string | null {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value
  return null
}

function checkoutUrlOf(data: BootstrapPayload): string | null {
  return httpsUrl(data.checkoutUrl)
}

function checkoutLinkLabel(url: string): string {
  return url.includes('/checkout/topup') ? 'Add credits' : 'Open checkout'
}

function namedCheckoutMarkdown(url: string): string {
  return `[${checkoutLinkLabel(url)}](${url})`
}

function checkoutRow(data: BootstrapPayload): string | null {
  const url = checkoutUrlOf(data)
  return url ? `Checkout: ${namedCheckoutMarkdown(url)} (${CHECKOUT_TTL})` : null
}

function namedManageMarkdown(url: string): string {
  return `[Manage account](${url})`
}

function manageRow(data: BootstrapPayload): string | null {
  const url = httpsUrl(data.portalUrl)
  return url ? `Manage: ${namedManageMarkdown(url)} (${CHECKOUT_TTL})` : null
}

function checkoutLink(data: BootstrapPayload): { uri: string; name: string } | null {
  const url = checkoutUrlOf(data)
  return url ? { uri: url, name: checkoutLinkLabel(url) } : null
}

function hostedPortalLink(data: BootstrapPayload): { uri: string; name: string } | null {
  const url = httpsUrl(data.portalUrl)
  if (url) {
    return { uri: url, name: 'Manage account' }
  }
  return null
}

type NarratorAccountState = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'H' | 'I' | 'J'
type NarratorPlanShape =
  | 'free'
  | 'trial'
  | 'usage-based'
  | 'recurring-unlimited'
  | 'recurring-metered'
  | 'paid-unknown'

function isPaidPlan(plan: PlanShape | PlanSnapshotShape): boolean {
  if ('requiresPayment' in plan && plan.requiresPayment === false) return false
  if (charges(plan).some(charge => charge.amountMinor > 0)) return true
  return (plan.price ?? 0) > 0
}

function hasReadableOptions(plan: PlanShape | PlanSnapshotShape): boolean {
  return Array.isArray(plan.options) && plan.options.length > 0
}

function resolveNarratorPlanShape(
  plan: PlanShape | PlanSnapshotShape | null | undefined,
): NarratorPlanShape | null {
  if (!plan) return null
  if ((trialDays(plan) ?? 0) > 0) return 'trial'
  if (!isPaidPlan(plan)) return 'free'
  const metered = countsUsage(plan)
  const unlimitedCap = includedUnits(plan) === 0
  const readable = hasReadableOptions(plan)
  if (billingCycle(plan)) {
    if (metered && !unlimitedCap) return 'recurring-metered'
    if (unlimitedCap || (readable && !metered)) return 'recurring-unlimited'
    return 'paid-unknown'
  }
  if (metered && !unlimitedCap) return 'usage-based'
  if (unlimitedCap || (readable && !metered)) return 'recurring-unlimited'
  return 'paid-unknown'
}

function mergePlan(
  snapshot: PlanSnapshotShape | null | undefined,
  catalog: PlanShape | null | undefined,
): PlanShape | PlanSnapshotShape | null {
  if (!snapshot && !catalog) return null
  if (!catalog) return snapshot ?? null
  if (!snapshot) return catalog
  const snapshotHasOptions = Array.isArray(snapshot.options) && snapshot.options.length > 0
  return {
    ...catalog,
    ...snapshot,
    options: snapshotHasOptions ? snapshot.options : catalog.options,
    requiresPayment: snapshot.requiresPayment ?? catalog.requiresPayment,
    isMetered: snapshot.isMetered,
  }
}

function findCatalogPlan(
  plans: PlanShape[],
  snapshot: PlanSnapshotShape | null | undefined,
  planRef?: string | null,
): PlanShape | undefined {
  const ref = snapshot?.reference ?? planRef
  if (!ref) return undefined
  return plans.find(plan => plan.reference === ref)
}

function isAtFiniteCap(limits: LimitsShape | null | undefined): boolean {
  if (!limits || limits.withinLimits !== false) return false
  if (limits.remaining === null || limits.remaining === undefined) return false
  if (limits.remaining === -1) return false
  return limits.remaining <= 0
}

function isCancelledNotExpired(purchase: PurchaseShape | null | undefined, now: Date): boolean {
  if (!purchase?.cancelledAt || !purchase.endDate) return false
  const end = new Date(purchase.endDate)
  return !Number.isNaN(end.getTime()) && end.getTime() > now.getTime()
}

function resolveNarratorAccountState(input: {
  purchase: PurchaseShape | null
  limits: LimitsShape | null | undefined
  plan: PlanShape | PlanSnapshotShape | null
  now: Date
}): NarratorAccountState {
  const { purchase, limits, plan, now } = input
  if (limits?.activationRequired) return 'H'
  if (isCancelledNotExpired(purchase, now)) return 'J'
  if (limits?.overage) return 'I'
  if (limits?.needsTopUp) return 'D'

  const shape = resolveNarratorPlanShape(plan)
  if (!purchase && !shape) return 'A'

  const atCap = isAtFiniteCap(limits)
  if (shape === 'usage-based') {
    if (atCap || limits?.withinLimits === false) return 'D'
    return 'B'
  }
  if (atCap) return 'F'
  if (shape === 'free' || shape === 'trial') return 'E'
  if (shape === 'recurring-metered' || shape === 'recurring-unlimited') return 'C'
  if (purchase) return 'C'
  return 'A'
}

function intervalPhrase(plan: PlanShape | PlanSnapshotShape | null | undefined): string | null {
  const cycle = billingCycle(plan)
  if (!cycle) return null
  const count = cycle.count ?? 1
  return count === 1 ? `a ${cycle.interval}` : `every ${count} ${cycle.interval}s`
}

function planPricePhrase(plan: PlanShape | PlanSnapshotShape | null | undefined): string | null {
  const list = headlineCharges(plan)
  if (list.length > 0) {
    const prices = list
      .map(charge => formatCompactMoney(charge.amountMinor, charge.currency))
      .filter((value): value is string => value != null)
    if (prices.length > 0) return prices.join(' · ')
  }
  return formatCompactMoney(plan?.price, plan?.currency)
}

function planPriceBit(plan: PlanShape | PlanSnapshotShape | null | undefined): string {
  const price = planPricePhrase(plan)
  const cycle = intervalPhrase(plan)
  if (!billingCycle(plan)) return price ? `, ${price} once` : ''
  if (price && cycle) return `, ${price} ${cycle}`
  if (price) return `, ${price}`
  return ''
}

function creditsRatePhrase(
  plan: PlanShape | PlanSnapshotShape | null | undefined,
  customer: CustomerShape | null | undefined,
): string | null {
  const rate = usageRate(plan)
  if (!rate || rate.amountMinor <= 0) return null
  const credits = creditsPerUnitFromBalance(plan, customer?.balance)
  if (credits == null) {
    const money = formatCompactMoney(rate.amountMinor, rate.currency)
    if (!money) return null
    const unit = meterUnit(rate.meter ?? meterName(plan), 1)
    return `${rate.tiered ? 'from ' : ''}${money} per ${unit}`
  }
  return `${rate.tiered ? 'from ' : ''}${formatCount(credits)} credits per call`
}

function catalogFragment(plan: PlanShape, customer: CustomerShape | null | undefined): string {
  const name = plan.name ?? 'Plan'
  const cap = includedUnits(plan)
  const cycle = intervalPhrase(plan)
  const price = planPricePhrase(plan)
  const rate = creditsRatePhrase(plan, customer)
  const shape = resolveNarratorPlanShape(plan)
  const trial = trialDays(plan)

  let core: string
  if (shape === 'free' || (!isPaidPlan(plan) && shape !== 'trial')) {
    core =
      cap && cap > 0
        ? `${name} gives ${formatCount(cap)} ${meterUnit(meterName(plan), cap)}${cycle ? ` ${cycle}` : ''}`
        : `${name} requires no payment`
  } else if (shape === 'usage-based') {
    core = rate ? `${name} is ${rate}` : `${name} is pay as you go`
  } else if (!billingCycle(plan)) {
    const allowance =
      cap === 0 || cap == null
        ? ' for unlimited'
        : ` for ${formatCount(cap)} ${meterUnit(meterName(plan), cap)}`
    core = price ? `${name} is ${price} once${allowance}` : `${name} is one-time`
  } else {
    const interval = cycle
    const allowance =
      cap === 0
        ? ' for unlimited'
        : cap && cap > 0
          ? ` for ${formatCount(cap)} ${meterUnit(meterName(plan), cap)}`
          : ''
    core = price
      ? `${name} is ${price}${interval ? ` ${interval}` : ''}${allowance}`
      : interval
        ? `${name} is ${interval}`
        : name
  }

  if (trial) core += ` · ${trial}-day trial`
  if (plan.reference) core += ` · planRef: ${plan.reference}`
  return core
}

function carryOnFragment(plan: PlanShape, customer: CustomerShape | null | undefined): string {
  const name = plan.name ?? 'Plan'
  let core: string
  if (resolveNarratorPlanShape(plan) === 'usage-based') {
    const credits = customer?.balance?.credits
    core =
      credits && credits > 0
        ? `${name} starts now using your existing ${formatCount(credits)} credits`
        : `${name} starts now`
  } else {
    const price = planPricePhrase(plan)
    const cycle = intervalPhrase(plan)
    if (!billingCycle(plan)) core = price ? `${name} is ${price} once` : name
    else core = price && cycle ? `${name} is ${price} ${cycle}` : name
  }
  return plan.reference ? `${core} · planRef: ${plan.reference}` : core
}

function joinOr(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]}, or ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, or ${parts[parts.length - 1]}`
}

function remainingOfTotal(usage: UsageShape | null | undefined): string | null {
  if (usage?.remaining == null || usage.total == null || usage.remaining < 0) return null
  const noun = meterUnit(usage.meterRef, usage.total)
  return `${formatCount(usage.remaining)} of ${formatCount(usage.total)} ${noun}`
}

function usedOfTotal(usage: UsageShape | null | undefined): string | null {
  if (usage?.used == null || usage.total == null) return null
  const noun = meterUnit(usage.meterRef, usage.total)
  return `${formatCount(usage.used)} of ${formatCount(usage.total)} ${noun}`
}

function claimableFreePlan(plans: PlanShape[]): PlanShape | undefined {
  return plans.find(plan => {
    if (plan.requiresPayment !== false) return false
    const cap = includedUnits(plan)
    return cap != null && cap > 0
  })
}

function activateRecovery(planRef: string): string {
  return `To continue, call \`${MCP_TOOL_NAMES.activatePlan}\` with planRef: "${planRef}".`
}

function recoveryForState(state: NarratorAccountState, freePlanRef?: string | null): string {
  switch (state) {
    case 'A':
      return recoveryLine(['checkout'])
    case 'B':
      return recoveryLine(['topup'])
    case 'C':
    case 'E':
    case 'F':
    case 'I':
      return recoveryLine(['checkout'])
    case 'D':
      return recoveryLine(['topup', 'checkout'])
    case 'H':
      return freePlanRef ? activateRecovery(freePlanRef) : recoveryLine(['checkout'])
    case 'J':
      return recoveryLine(['account'])
  }
}

function narrateAccountBody(input: {
  state: NarratorAccountState
  product: string
  plan: PlanShape | PlanSnapshotShape | null
  planShape: NarratorPlanShape | null
  purchase: PurchaseShape | null
  customer: CustomerShape | null
  plans: PlanShape[]
  now: Date
}): string {
  const { state, product, plan, planShape, purchase, customer, plans, now } = input
  const planName = plan?.name ?? 'plan'
  const usage = customer?.usage ?? null
  const credits = customer?.balance?.credits ?? 0

  if (state === 'A') {
    const fragments = plans.map(item => catalogFragment(item, customer))
    const catalog = fragments.length > 0 ? ` ${fragments.join(', ')}.` : ''
    return `${product} has no plan yet.${catalog} Reply with a plan name to activate it.`
  }

  if (state === 'H') {
    const free = claimableFreePlan(plans)
    const cap = free ? includedUnits(free) : null
    const cycle = intervalPhrase(free)
    const unit = meterUnit(meterName(free), cap && cap > 0 ? cap : 2)
    const ready =
      cap && cap > 0
        ? `${formatCount(cap)} ${unit}${cycle ? ` ${cycle}` : ''}, no card`
        : 'no card'
    return `${product} has a free plan ready: ${ready}. Call \`${MCP_TOOL_NAMES.activatePlan}\` with a \`planRef\` to activate it.`
  }

  if (state === 'B') {
    const rate = creditsRatePhrase(plan, customer)
    const perCall = plan ? creditsPerUnitFromBalance(plan, customer?.balance) : null
    const runway =
      perCall && perCall > 0 ? `, about ${formatCount(Math.floor(credits / perCall))} calls` : ''
    const rateBit = rate ? `, ${rate}` : ''
    return (
      `${product} is on ${planName}${rateBit}. ` +
      `Balance ${formatCount(credits)} credits${runway}. ` +
      `Call \`${VIEWER_TOOL_NAME}\` with view: 'topup' to add credits.`
    )
  }

  if (state === 'D') {
    const perCall = plan ? creditsPerUnitFromBalance(plan, customer?.balance) : null
    const shortfall = perCall && perCall > 0 ? Math.max(0, perCall - credits) : null
    const costBit =
      perCall && perCall > 0
        ? `; this call costs ${formatCount(perCall)} credits${
            shortfall != null ? ` — ${formatCount(shortfall)} short` : ''
          }`
        : ` and ${planName} needs credits`
    return (
      `${product} is on ${planName}. Balance ${formatCount(credits)} credits` +
      `${costBit}. ` +
      `Call \`${VIEWER_TOOL_NAME}\` with view: 'topup' to add credits, or with view: 'checkout' to switch to a plan that does not use credits.`
    )
  }

  if (state === 'C') {
    const priceBit = planPriceBit(plan)
    const oneTime = !billingCycle(plan)
    const left = remainingOfTotal(usage)
    const date = formatShortDate(usage?.periodEnd ?? purchase?.endDate)
    const unlimited =
      usage?.remaining === -1 || includedUnits(plan) === 0 || planShape === 'recurring-unlimited'
    let position: string
    if (left) {
      position = oneTime
        ? `${left} left`
        : `${left} left this period${date ? `, renewing ${date}` : ''}`
    } else if (unlimited) {
      position = oneTime ? 'Unlimited calls' : `Unlimited calls${date ? `, renewing ${date}` : ''}`
    } else if (date && !oneTime) {
      position = `Renews ${date}`
    } else {
      position = 'After your first call'
    }
    const creditsUnused = !creditSignals(limitsAsSignals(customer?.limits)).isCreditBased
    return (
      `${product} is on ${planName}${priceBit}. ${position}. ` +
      (creditsUnused
        ? `Credits are not used on this plan. Call \`${VIEWER_TOOL_NAME}\` with view: 'checkout' to switch.`
        : `Call \`${VIEWER_TOOL_NAME}\` with view: 'checkout' to switch.`)
    )
  }

  if (state === 'E') {
    const left = remainingOfTotal(usage)
    const date = formatShortDate(usage?.periodEnd)
    const interval = billingCycle(plan)?.interval ?? 'period'
    const leftBit = left
      ? `${left} left this ${interval}${date ? `, resetting ${date}` : ''}`
      : date
        ? `resets ${date}`
        : 'After your first call'
    return (
      `${product} is on the free plan: ${leftBit}. ` +
      `Credits are not used on ${planName}. Call \`${VIEWER_TOOL_NAME}\` with view: 'checkout' for more calls.`
    )
  }

  if (state === 'F') {
    const cap = usage?.total ?? includedUnits(plan)
    const unit = meterUnit(usage?.meterRef ?? meterName(plan), cap && cap > 0 ? cap : 2)
    const date = formatShortDate(usage?.periodEnd)
    const capBit =
      cap && cap > 0 ? `${formatCount(cap)} ${unit} are used up` : `allowance is used up`
    const consequence = date
      ? ` Further calls fail until ${date}`
      : ' Further calls fail until the allowance resets'
    const others = plans.filter(item => {
      if (item.reference && item.reference === (plan?.reference ?? purchase?.planRef)) {
        return false
      }
      const otherShape = resolveNarratorPlanShape(item)
      return otherShape !== 'free' && otherShape !== 'trial'
    })
    const carryOn =
      others.length > 0 ? ` ${joinOr(others.map(item => carryOnFragment(item, customer)))}.` : ''
    const antiTrap =
      credits > 0 && planShape !== 'usage-based'
        ? ` Adding credits will not help, because ${planName} does not spend them.`
        : ''
    const priceBit = planPriceBit(plan)
    return (
      `${product} is on ${planName}${priceBit}. ${capBit}.${consequence}.${antiTrap}${carryOn} ` +
      `Call \`${VIEWER_TOOL_NAME}\` with view: 'checkout' to switch plan.`
    )
  }

  if (state === 'I') {
    const used = usedOfTotal(usage)
    const usedBit = used ? `: ${used} used` : ''
    return (
      `${product} is over its ${planName} allowance${usedBit}. Calls still work. ` +
      `Call \`${VIEWER_TOOL_NAME}\` with view: 'checkout' for a higher limit.`
    )
  }

  const date = formatShortDate(purchase?.endDate)
  const days = purchase?.endDate ? daysUntil(purchase.endDate, now) : null
  const left = remainingOfTotal(usage)
  const until = date ? `runs until ${date}` : 'is cancelled'
  const daysBit = days != null ? `, ${days} days away` : ''
  const leftBit = left ? `, with ${left} left` : ''
  return (
    `${product}'s ${planName} plan is cancelled and ${until}${daysBit}${leftBit}. ` +
    `Calls stop after that. Call \`${VIEWER_TOOL_NAME}\` with view: 'account' to reactivate it.`
  )
}

export function narrateAlreadyActive(result: {
  creditBalance?: number
  creditsPerUnit?: number
}): string {
  return narrateActivatePlan({ status: 'already_active', ...result })
}

export function narrateActivatePlan(result: {
  status:
    | 'activated'
    | 'already_active'
    | 'already_purchased'
    | 'topup_required'
    | 'payment_required'
    | 'invalid'
  creditBalance?: number
  creditsPerUnit?: number
  checkoutUrl?: string
  message?: string
  planName?: string
}): string {
  const planName = result.planName
  const named = planName ? `${planName}` : 'This plan'
  const checkout =
    result.checkoutUrl && result.checkoutUrl.length > 0
      ? ` [${result.checkoutUrl.includes('/checkout/topup') ? 'Add credits' : 'Open checkout'}](${result.checkoutUrl}) (expires in 15 minutes), or`
      : ''

  switch (result.status) {
    case 'activated':
      return planName
        ? `Activated ${planName}. Paid tools are available now.`
        : 'Plan activated. Paid tools are available now.'
    case 'already_purchased':
      return `${named} is already purchased. Call \`${VIEWER_TOOL_NAME}\` with view: 'account' to manage it.`
    case 'payment_required':
      return `${named} requires payment.${checkout} Call \`${VIEWER_TOOL_NAME}\` with view: 'checkout' to pay.`
    case 'topup_required':
      return `${named} needs credits before it can activate.${checkout} Call \`${VIEWER_TOOL_NAME}\` with view: 'topup' to add credits.`
    case 'invalid':
      return (
        result.message ??
        `That planRef is not valid for this product. Call \`${VIEWER_TOOL_NAME}\` with view: 'checkout' to see plans.`
      )
    case 'already_active': {
      const balance = result.creditBalance
      const cost = result.creditsPerUnit
      if (balance !== undefined && cost !== undefined) {
        const shortfall = Math.max(0, cost - balance)
        if (shortfall > 0) {
          return (
            `${named} is already active. Balance ${formatCount(balance)} credits; ` +
            `this call costs ${formatCount(cost)} credits — ${formatCount(shortfall)} short. ` +
            `Call the \`${VIEWER_TOOL_NAME}\` tool with view: 'topup' to add credits.`
          )
        }
      }
      return `${named === 'This plan' ? 'This plan is' : `${named} is`} already active.`
    }
  }
}

export function narrateManageAccount(
  data: BootstrapPayload,
  options?: { now?: Date },
): NarratorOutput {
  const now = options?.now ?? new Date()
  const customer = data.customer as CustomerShape | null
  const plans = (data.plans ?? []) as PlanShape[]
  const active = activePurchase(data)
  const limits = customer?.limits
  const useLimits = preferLimitsPlan(active, limits)
  const catalog = findCatalogPlan(
    plans,
    useLimits ? { reference: limits?.planRef ?? undefined } : active?.planSnapshot,
    useLimits ? limits?.planRef : active?.planRef,
  )
  const plan = useLimits
    ? (catalog ?? { name: limits?.planName ?? undefined, reference: limits?.planRef ?? undefined })
    : mergePlan(active?.planSnapshot, catalog)
  const planShape = resolveNarratorPlanShape(plan)
  const state = resolveNarratorAccountState({
    purchase: active,
    limits: customer?.limits,
    plan,
    now,
  })
  const name = productName(data)
  const free = claimableFreePlan(plans)

  const lines: string[] = []
  lines.push(
    state === 'A' || state === 'H' ? `**Welcome to ${name}**` : `**${name} — your account**`,
  )
  lines.push('')
  lines.push(
    narrateAccountBody({
      state,
      product: name,
      plan,
      planShape,
      purchase: active,
      customer,
      plans,
      now,
    }),
  )

  if (state === 'A' || state === 'H') {
    const bal = balanceRow(customer)
    if (bal) lines.push(bal)
  }

  const manage = manageRow(data)
  if (manage) lines.push(manage)
  if (state === 'D') {
    const topup = checkoutRow(data)
    if (topup) lines.push(topup)
  } else {
    const checkout = checkoutRow(data)
    if (checkout) lines.push(checkout)
  }
  lines.push('')
  lines.push(recoveryForState(state, free?.reference))

  const links: NarratorOutput['links'] = []
  const portal = hostedPortalLink(data)
  if (portal) links.push(portal)
  const checkoutLinkRow = checkoutLink(data)
  if (checkoutLinkRow) links.push(checkoutLinkRow)
  return { text: lines.join('\n'), links }
}

function withCheckout(data: BootstrapPayload, lines: string[]): NarratorOutput {
  const checkout = checkoutRow(data)
  if (checkout) lines.push(checkout)
  const links: NarratorOutput['links'] = []
  const link = checkoutLink(data)
  if (link) links.push(link)
  return { text: lines.join('\n'), links }
}

export function narrateUpgrade(data: BootstrapPayload): NarratorOutput {
  const lines: string[] = []
  lines.push(`**Upgrade — ${productName(data)}**`)
  lines.push('')
  const hasActivePurchase = activePurchase(data) !== null
  const plans = ((data.plans ?? []) as PlanShape[]).filter(
    plan => !hasActivePurchase || !isFreePlan(plan),
  )
  if (plans.length > 0) {
    lines.push('Plans available:')
    lines.push(...plansListLines(plans))
  } else {
    lines.push('No paid plans are configured on this product yet.')
  }
  lines.push('')
  lines.push(recoveryLine(['account']))
  return withCheckout(data, lines)
}

export function narrateTopup(data: BootstrapPayload): NarratorOutput {
  const lines: string[] = []
  lines.push(`**Top up — ${productName(data)}**`)
  lines.push('')
  const bal = balanceRow(data.customer as CustomerShape | null)
  if (bal) lines.push(bal)
  lines.push('')
  lines.push(recoveryLine(['account']))
  return withCheckout(data, lines)
}

export function narrateAutoRecharge(data: BootstrapPayload): NarratorOutput {
  const lines: string[] = []
  lines.push(`**Auto-recharge — ${productName(data)}**`)
  lines.push('')
  const customer = data.customer as CustomerShape | null
  const bal = balanceRow(customer)
  if (bal) lines.push(bal)
  const enabled = customer?.autoRecharge?.enabled === true
  lines.push(
    enabled
      ? 'Auto-recharge is on. It tops your balance up automatically so calls do not fail.'
      : 'Auto-recharge is off. Turn it on from the account page — it stores a card and tops your balance up automatically so calls do not fail.',
  )
  const manage = manageRow(data)
  if (manage) lines.push(manage)
  lines.push('')
  lines.push(recoveryLine(['account']))
  const links: NarratorOutput['links'] = []
  const portal = hostedPortalLink(data)
  if (portal) links.push({ ...portal, name: enabled ? 'Manage auto-recharge' : 'Turn on auto-recharge' })
  return { text: lines.join('\n'), links }
}

export const NARRATORS: Record<SolvaPayMcpViewKind, (data: BootstrapPayload) => NarratorOutput> = {
  checkout: narrateUpgrade,
  account: narrateManageAccount,
  topup: narrateTopup,
  'auto-recharge': narrateAutoRecharge,
}

const UI_OPENED_VERB: Record<SolvaPayMcpViewKind, (productName: string) => string> = {
  topup: p => `Opened ${p} top-up.`,
  checkout: p => `Opened ${p} upgrade.`,
  account: p => `Opened your ${p} account.`,
  'auto-recharge': p => `Opened ${p} auto-recharge.`,
}

function firstSelectablePlan(data: BootstrapPayload): PlanShape | undefined {
  const plans = (data.plans ?? []) as PlanShape[]
  return plans.find(p => !isFreePlan(p)) ?? plans[0]
}

/**
 * One-line placeholder shown on UI-rendering hosts when the intent
 * tool runs in `mode: 'ui'`. Self-sufficient for text-only hosts that
 * still receive this block: plan name, price, and a pasteable https
 * URL. Never points at "the panel".
 */
function planForPlaceholder(
  view: SolvaPayMcpViewKind,
  data: BootstrapPayload,
): PlanShape | undefined {
  if (view === 'account') {
    const snap = activePurchase(data)?.planSnapshot
    if (!snap) return undefined
    return {
      name: snap.name,
      price: snap.price,
      currency: snap.currency,
      options: snap.options,
      reference: snap.reference,
    }
  }
  return firstSelectablePlan(data)
}

export function uiPlaceholder(view: SolvaPayMcpViewKind, data: BootstrapPayload): string {
  const name = productName(data)
  const opened = UI_OPENED_VERB[view](name)
  const parts = [opened]
  const plan = planForPlaceholder(view, data)
  if (plan) {
    const price = formatPlanPrices(plan)
    const label = [plan.name ?? 'Plan', price && !isFreePlan(plan) ? price : null]
      .filter(Boolean)
      .join(' · ')
    if (label) parts.push(`${label}.`)
  }
  const balance = balanceSummary(data.customer as CustomerShape | null)
  if (balance) parts.push(`Balance: ${balance}.`)
  const url = checkoutUrlOf(data)
  if (url) parts.push(`Checkout: ${namedCheckoutMarkdown(url)} (${CHECKOUT_TTL}).`)
  return parts.join(' ')
}
