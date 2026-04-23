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
  billingCycle?: string | null
  meterRef?: string | null
  limit?: number | null
}

interface PurchaseShape {
  planSnapshot?: PlanShape | null
  amount?: number
  currency?: string
  endDate?: string
}

interface CustomerShape {
  ref?: string
  balance?: { credits?: number | null; displayCurrency?: string; displayExchangeRate?: number } | null
  usage?: { used?: number; limit?: number; resetsAt?: string } | null
  purchase?: { purchases?: PurchaseShape[] } | null
}

const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'])

function formatMoney(amountMinor: number | null | undefined, currency: string | null | undefined): string | null {
  if (amountMinor == null || !currency) return null
  const zero = ZERO_DECIMAL.has(currency.toLowerCase())
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

function activePurchase(customer: CustomerShape | null | undefined): PurchaseShape | null {
  const list = customer?.purchase?.purchases ?? []
  return list[0] ?? null
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
  const rate = customer.balance.displayExchangeRate ?? 1
  // Credits are minor-unit-equivalent on display currency; rate is
  // already applied by the server.
  const majorMinor = currency ? Math.round(credits / rate) : null
  const money = formatMoney(majorMinor, currency ?? null)
  const fmt = new Intl.NumberFormat('en-US').format(credits)
  return money ? `Balance: ${fmt} credits (~${money})` : `Balance: ${fmt} credits`
}

function commandsLine(commands: string[]): string {
  return `Commands: ${commands.map((c) => `\`/${c}\``).join(' ')}`
}

function plansListLines(plans: PlanShape[]): string[] {
  return plans.map((p) => {
    const name = p.name ?? 'Plan'
    const price = formatMoney(p.price, p.currency)
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
  parts.push("Pass `mode: 'text'` for a markdown summary.")
  return parts.join(' ')
}
