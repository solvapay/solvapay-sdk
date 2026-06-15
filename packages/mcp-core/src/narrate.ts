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

import { creditsToDisplayMinorUnits, isZeroDecimalCurrency } from './credit-display'
import type { BootstrapPayload } from './types'

export interface NarratorOutput {
  text: string
  links?: Array<{ uri: string; name: string }>
}

export type IntentTool = 'upgrade' | 'manage_account' | 'topup' | 'activate_plan'

interface PlanShape {
  name?: string
  planType?: string
  price?: number
  currency?: string
  pricingOptions?: Array<{
    currency?: string
    price?: number
    default?: boolean
  }>
  billingCycle?: string | null
  meterRef?: string | null
  limit?: number | null
  creditsPerUnit?: number | null
  reference?: string
}

interface PurchaseShape {
  planRef?: string
  planSnapshot?: PlanShape | null
  amount?: number
  currency?: string
  endDate?: string
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

function formatMoney(amountMinor: number | null | undefined, currency: string | null | undefined): string | null {
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
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
    currency &&
    typeof creditsPerMinorUnit === 'number' &&
    creditsPerMinorUnit > 0
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

function resolveCreditsPerCall(active: PurchaseShape, plans: PlanShape[]): number | null {
  const snapshot = active.planSnapshot
  if (snapshot?.planType === 'usage-based') {
    const fromSnapshot = snapshot.creditsPerUnit
    if (typeof fromSnapshot === 'number' && fromSnapshot > 0) return fromSnapshot
  }

  const planRef = active.planRef
  if (planRef) {
    const match = plans.find(p => p.reference === planRef)
    if (
      match?.planType === 'usage-based' &&
      typeof match.creditsPerUnit === 'number' &&
      match.creditsPerUnit > 0
    ) {
      return match.creditsPerUnit
    }
  }

  return null
}

function costPerCallRow(creditsPerUnit: number): string {
  const fmt = new Intl.NumberFormat('en-US').format(creditsPerUnit)
  return `Cost per call: ${fmt} credits`
}

function commandsLine(commands: string[]): string {
  return `Commands: ${commands.map((c) => `\`/${c}\``).join(' ')}`
}

function formatPlanPrices(p: PlanShape): string {
  const options =
    p.pricingOptions && p.pricingOptions.length > 0
      ? p.pricingOptions
      : [{ currency: p.currency, price: p.price, default: true }]

  return options
    .map((option) => formatMoney(option.price, option.currency))
    .filter((value): value is string => value != null)
    .join(' · ')
}

function plansListLines(plans: PlanShape[]): string[] {
  return plans.map((p) => {
    const name = p.name ?? 'Plan'
    const price = formatPlanPrices(p)
    const cycle = p.billingCycle ? `/${p.billingCycle}` : ''
    const type =
      p.planType === 'free'
        ? 'no payment required'
        : p.planType === 'usage-based'
          ? 'pay as you go'
          : p.planType === 'trial'
            ? 'trial'
            : 'recurring'
    if (price && p.planType !== 'free') {
      return `${name} · ${type} · ${price}${cycle}`
    }
    return `${name} · ${type}`
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
      const cycle = plan.billingCycle ? `/${plan.billingCycle}` : ''
      const end = formatDate(active.endDate)
      const parts = [planName]
      if (price && plan.planType !== 'free') parts.push(`${price}${cycle}`)
      if (end) parts.push(`renews ${end}`)
      lines.push(`Plan: ${parts.join(' · ')}`)
    }
    const bal = balanceRow(customer)
    if (bal) lines.push(bal)
    const creditsPerCall = resolveCreditsPerCall(active, (data.plans ?? []) as PlanShape[])
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
  const plans = ((data.plans ?? []) as PlanShape[]).filter((p) => p.planType !== 'free')
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
    .map((m) => formatMoney(m, currency))
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
  topup: (p) => `Opened ${p} top-up.`,
  upgrade: (p) => `Opened ${p} upgrade.`,
  manage_account: (p) => `Opened your ${p} account.`,
  activate_plan: (p) => `Opened ${p} plan picker.`,
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
export function uiPlaceholder(
  tool: IntentTool,
  data: BootstrapPayload,
): string {
  const name = productName(data)
  const opened = UI_OPENED_VERB[tool](name)
  const balance = balanceSummary(data.customer as CustomerShape | null)
  const parts = [opened]
  if (balance) parts.push(`Balance: ${balance}.`)
  parts.push(UI_PANEL_SHOWN[tool])
  return parts.join(' ')
}
