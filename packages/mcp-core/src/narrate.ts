/**
 * Narrator map — one function per intent tool that renders a sparse,
 * text-friendly markdown summary of the bootstrap payload.
 *
 * Style rules (see the discoverable-UX plan for rationale):
 *  1. First line is a single `**bold title**` — no headings.
 *  2. Body uses `Label: value` rows (one per line). Inline `·`
 *     separator for compound values. No bullet lists.
 *  3. Commands on a single line as inline-code tokens.
 *  4. External URLs go into `resource_link` blocks, not inline
 *     markdown links.
 *
 * Missing fields skip their row entirely — we never emit `Balance: —`
 * or `Customer: unknown`. A narrator returning just `title + 1 row`
 * is still well-formed.
 */

import {
  billingCycle,
  creditsPerUnitFromBalance,
  creditsToDisplayMinorUnits,
  headlineCharges,
  isZeroDecimalCurrency,
  meterName,
  trialDays,
  usageRate,
  type PricingOptionLike,
} from '@solvapay/core'
import type { BootstrapPayload } from './types'

export interface NarratorOutput {
  text: string
  links?: Array<{ uri: string; name: string }>
}

export type IntentTool = 'upgrade' | 'manage_account' | 'topup' | 'activate_plan'

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
  reference?: string
}

interface PurchaseShape {
  planRef?: string
  planSnapshot?: PlanSnapshotShape | null
  amount?: number
  currency?: string
  endDate?: string
  isRecurring?: boolean
  /** Lives on the purchase, not the snapshot, which freezes only `options`. */
  billingCycle?: string | null
  metadata?: { purpose?: string }
}

interface CustomerShape {
  ref?: string
  balance?: {
    credits?: number | null
    displayCurrency?: string
    displayExchangeRate?: number
    creditsPerMinorUnit?: number
  } | null
  usage?: { used?: number; limit?: number; resetsAt?: string } | null
  purchase?: { purchases?: PurchaseShape[] } | null
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

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return null
  }
}

function isPlanPurchase(purchase: PurchaseShape): boolean {
  return !!purchase.planSnapshot && purchase.metadata?.purpose !== 'credit_topup'
}

function activePurchase(customer: CustomerShape | null | undefined): PurchaseShape | null {
  const list = customer?.purchase?.purchases ?? []
  return list.find(isPlanPurchase) ?? null
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

/**
 * Cost of one metered call, in credits.
 *
 * The rate is the per-unit charge frozen onto the purchase's own
 * `planSnapshot.options` — what the customer is billed on, which may
 * differ from the live plan's current price. Converting that charge to
 * credits needs the USD→charge-currency rate; `creditsPerUnitFromBalance`
 * returns `null` when the balance peg doesn't cover the charge's
 * currency, and the row is then skipped rather than guessed.
 */
function resolveCreditsPerCall(
  active: PurchaseShape,
  customer: CustomerShape | null | undefined,
): number | null {
  if (active.planSnapshot?.isMetered !== true) return null
  return creditsPerUnitFromBalance(active.planSnapshot, customer?.balance)
}

function costPerCallRow(creditsPerUnit: number): string {
  const fmt = new Intl.NumberFormat('en-US').format(creditsPerUnit)
  return `Cost per call: ${fmt} credits`
}

function commandsLine(commands: string[]): string {
  return `Commands: ${commands.map(c => `\`/${c}\``).join(' ')}`
}

/**
 * Every currency the plan prices its headline charge in. A
 * multi-currency plan carries one flat charge per currency in
 * `options[]`; the derived top-level `price` collapses that to the
 * default currency, so it is only a fallback for plans whose options
 * this SDK can't read.
 */
function formatPlanPrices(p: PlanShape): string {
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
  const rate = usageRate(p)
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
  switch (p.type) {
    case 'usage-based':
      return 'pay as you go'
    case 'hybrid':
      return 'subscription + usage'
    case 'one-time':
      return 'one-time'
    default:
      return 'recurring'
  }
}

function formatCycle(p: PlanShape): string {
  const cycle = billingCycle(p)
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

    return parts.join(' · ')
  })
}

function hostedPortalLink(data: BootstrapPayload): { uri: string; name: string } | null {
  // Bootstrap payload doesn't carry a portal URL today; a portal is
  // provisioned lazily. The narrators only emit a link when an
  // explicit `portalUrl` shows up — safe forward extension point.
  const url = (data as unknown as { portalUrl?: string }).portalUrl
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    return { uri: url, name: 'Open hosted portal' }
  }
  return null
}

export function narrateManageAccount(data: BootstrapPayload): NarratorOutput {
  const lines: string[] = []
  const customer = data.customer as CustomerShape | null
  const active = activePurchase(customer)
  const name = productName(data)

  if (!active) {
    lines.push(`**Welcome to ${name}**`)
    lines.push('')
    const bal = balanceRow(customer)
    if (bal) lines.push(bal)
    const plans = (data.plans ?? []) as PlanShape[]
    if (plans.length > 0) {
      lines.push('No active plan. Plans available:')
      lines.push(...plansListLines(plans))
    } else {
      lines.push('No active plan.')
    }
    lines.push('')
    lines.push(commandsLine(['activate_plan', 'upgrade']))
  } else {
    lines.push(`**${name} — your account**`)
    lines.push('')
    const plan = active.planSnapshot
    if (plan) {
      const planName = plan.name ?? 'Plan'
      const price = formatMoney(plan.price, plan.currency)
      const cycle = active.billingCycle ? `/${active.billingCycle}` : ''
      const end = formatDate(active.endDate)
      const parts = [planName]
      if (price) parts.push(`${price}${cycle}`)
      if (end) parts.push(`renews ${end}`)
      lines.push(`Plan: ${parts.join(' · ')}`)
    }
    const bal = balanceRow(customer)
    if (bal) lines.push(bal)
    const creditsPerCall = resolveCreditsPerCall(active, customer)
    if (creditsPerCall != null) lines.push(costPerCallRow(creditsPerCall))
    lines.push('')
    lines.push(commandsLine(['topup', 'upgrade']))
  }

  const links: NarratorOutput['links'] = []
  const portal = hostedPortalLink(data)
  if (portal) links.push(portal)
  return { text: lines.join('\n'), links }
}

export function narrateUpgrade(data: BootstrapPayload): NarratorOutput {
  const lines: string[] = []
  lines.push(`**Upgrade — ${productName(data)}**`)
  lines.push('')
  const plans = ((data.plans ?? []) as PlanShape[]).filter(p => !isFreePlan(p))
  if (plans.length > 0) {
    lines.push('Plans available:')
    lines.push(...plansListLines(plans))
  } else {
    lines.push('No paid plans are configured on this product yet.')
  }
  lines.push('')
  lines.push(commandsLine(['manage_account', 'topup']))
  return { text: lines.join('\n') }
}

export function narrateTopup(data: BootstrapPayload): NarratorOutput {
  const lines: string[] = []
  lines.push(`**Top up — ${productName(data)}**`)
  lines.push('')
  const bal = balanceRow(data.customer as CustomerShape | null)
  if (bal) lines.push(bal)
  const currency = (data.customer as CustomerShape | null)?.balance?.displayCurrency ?? 'USD'
  const presets = [1000, 2500, 5000, 10_000]
    .map(m => formatMoney(m, currency))
    .filter(Boolean)
    .join(' · ')
  if (presets) lines.push(`Top-up presets: ${presets}`)
  lines.push('')
  lines.push(commandsLine(['manage_account']))
  return { text: lines.join('\n') }
}

export function narrateActivatePlan(data: BootstrapPayload): NarratorOutput {
  const lines: string[] = []
  lines.push(`**Activate a plan — ${productName(data)}**`)
  lines.push('')
  const plans = (data.plans ?? []) as PlanShape[]
  if (plans.length > 0) {
    lines.push('Plans available:')
    lines.push(...plansListLines(plans))
  } else {
    lines.push('No plans are configured on this product yet.')
  }
  lines.push('')
  lines.push(commandsLine(['manage_account', 'topup']))
  return { text: lines.join('\n') }
}

export const NARRATORS: Record<IntentTool, (data: BootstrapPayload) => NarratorOutput> = {
  upgrade: narrateUpgrade,
  manage_account: narrateManageAccount,
  topup: narrateTopup,
  activate_plan: narrateActivatePlan,
}

const UI_OPENED_VERB: Record<IntentTool, (productName: string) => string> = {
  topup: p => `Opened ${p} top-up.`,
  upgrade: p => `Opened ${p} upgrade.`,
  manage_account: p => `Opened your ${p} account.`,
  activate_plan: p => `Opened ${p} plan picker.`,
}

const UI_PANEL_SHOWN: Record<IntentTool, string> = {
  topup: 'Top-up options are shown in the panel.',
  upgrade: 'Plans and checkout are shown in the panel.',
  manage_account: 'Account details are shown in the panel.',
  activate_plan: 'Plan options are shown in the panel.',
}

/**
 * One-line placeholder shown on UI-rendering hosts when the intent
 * tool runs in `mode: 'ui'`. Gives the agent minimal grounding (what
 * surface opened + balance when available) without flooding the user
 * pane with the full narrated markdown that the iframe already covers.
 */
export function uiPlaceholder(tool: IntentTool, data: BootstrapPayload): string {
  const name = productName(data)
  const opened = UI_OPENED_VERB[tool](name)
  const balance = balanceSummary(data.customer as CustomerShape | null)
  const parts = [opened]
  if (balance) parts.push(`Balance: ${balance}.`)
  parts.push(UI_PANEL_SHOWN[tool])
  return parts.join(' ')
}
