/**
 * Pure state engine that classifies a `LimitResponseWithPlan` into a
 * recovery-tool-specific `PaywallState`, and produces the human-readable
 * gate / nudge message templates the MCP transport ships as
 * `content[0].text` on gate/nudge responses.
 *
 * This module has no UI dependencies — it's framework-neutral so
 * `@solvapay/server`, `@solvapay/mcp-core`, and any HTTP adapter can
 * reuse the classification + copy. The text-only paywall design puts
 * the full narration (including a clickable `checkoutUrl` for
 * terminal-first hosts) on `gate.message`, and names exactly one
 * primary recovery tool so LLMs chain naturally toward it.
 */

import { minorUnitsPerMajor } from '@solvapay/core'
import type { PaywallNextAction, LimitResponseWithPlan, PaywallStructuredContent } from './types'

/**
 * How long a checkout session URL stays valid. Stated inline in gate
 * copy so a pasted transcript link is not treated as durable. Do not
 * extend this TTL — the session id is a guardless bearer credential.
 */
export const CHECKOUT_SESSION_TTL_MINUTES = 15

const DOCS_HINT = 'See docs://solvapay/overview.md.'

/**
 * Discriminated union describing which recovery path the customer
 * needs. Every state maps to exactly one primary recovery tool except
 * `reactivation_required`, which surfaces two alternatives (rare).
 */
export type PaywallState =
  | { kind: 'activation_required' }
  | { kind: 'topup_required' }
  | { kind: 'upgrade_required' }
  | { kind: 'limit_reached' }
  | { kind: 'reactivation_required' }

export type CreditSignals = {
  creditBalance?: number
  creditsPerCall?: number
  shortfallCredits?: number
  remainingCalls?: number
  isCreditBased: boolean
}

/**
 * Coalesce the two credit-balance channels and derive shortfall /
 * remaining-call counts. Nested `balance` wins when present.
 */
export function creditSignals(limits: LimitResponseWithPlan | null): CreditSignals {
  if (!limits) return { isCreditBased: false }
  const creditBalance = limits.balance?.creditBalance ?? limits.creditBalance
  const creditsPerCall = limits.balance?.creditsPerUnit ?? limits.creditsPerUnit
  const isCreditBased = creditBalance !== undefined || creditsPerCall !== undefined
  const shortfallCredits =
    creditBalance !== undefined && creditsPerCall !== undefined
      ? Math.max(0, creditsPerCall - creditBalance)
      : undefined
  let remainingCalls: number | undefined
  if (limits.balance?.remainingUnits !== undefined) {
    remainingCalls = limits.balance.remainingUnits
  } else if (
    creditBalance !== undefined &&
    creditsPerCall !== undefined &&
    creditsPerCall > 0
  ) {
    remainingCalls = Math.floor(creditBalance / creditsPerCall)
  } else if (limits.remaining >= 0) {
    remainingCalls = limits.remaining
  }
  return { creditBalance, creditsPerCall, shortfallCredits, remainingCalls, isCreditBased }
}

export function nextActionFor(state: PaywallState): PaywallNextAction {
  switch (state.kind) {
    case 'activation_required':
      return 'activate'
    case 'topup_required':
      return 'topup'
    case 'upgrade_required':
    case 'limit_reached':
      return 'checkout'
    case 'reactivation_required':
      return 'account'
  }
}

function activePlanRefOf(limits: LimitResponseWithPlan): string | undefined {
  const ref = limits.planRef ?? limits.plan
  return ref && ref.length > 0 ? ref : undefined
}

/**
 * Classify a `LimitResponseWithPlan` (or `null` on degraded paths) into
 * a `PaywallState`. Pure — safe to call multiple times per request.
 *
 * Precedence:
 *  1. `activationRequired` / `paywallReason === 'activation_required'`.
 *  2. `paywallReason === 'topup_required'` — backend stays authoritative
 *     for credit-based denials (same rule as Managed MCP).
 *  3. Authoritative `needsTopUp` / `needsUpgrade` flags from `decideLimit`.
 *  4. Credit-field presence + a real shortfall (`balance < cost`).
 *  5. Active purchase / plan at included cap → `limit_reached`.
 *  6. Floor: never `upgrade_required` when credit fields or a purchase
 *     are present. Everything else → `upgrade_required`.
 *
 * `reactivation_required` is deferred — it needs a distinct backend
 * signal which isn't emitted yet. Kept in the type so downstream code
 * compiles against the full discriminated union.
 */
export function classifyPaywallState(
  limits: LimitResponseWithPlan | null,
): PaywallState {
  if (!limits) return { kind: 'upgrade_required' }

  if (limits.activationRequired === true || limits.paywallReason === 'activation_required') {
    return { kind: 'activation_required' }
  }

  if (limits.paywallReason === 'topup_required') {
    return { kind: 'topup_required' }
  }

  if (limits.needsTopUp === true) {
    return { kind: 'topup_required' }
  }

  if (limits.needsUpgrade === true) {
    return { kind: 'upgrade_required' }
  }

  const signals = creditSignals(limits)
  if (signals.isCreditBased) {
    if (
      signals.creditBalance !== undefined &&
      signals.creditsPerCall !== undefined &&
      signals.creditBalance < signals.creditsPerCall
    ) {
      return { kind: 'topup_required' }
    }
    if (signals.creditBalance === 0) return { kind: 'topup_required' }
    if (signals.creditsPerCall === undefined && limits.remaining === 0) {
      return { kind: 'topup_required' }
    }
  }

  const activeRef = activePlanRefOf(limits)
  if ((limits.purchaseRef || activeRef) && limits.remaining <= 0) {
    return { kind: 'limit_reached' }
  }

  if (signals.isCreditBased) return { kind: 'topup_required' }
  if (limits.purchaseRef) return { kind: 'limit_reached' }

  return { kind: 'upgrade_required' }
}

function formatMinor(amountMinor: number, currency: string): string {
  const divisor = minorUnitsPerMajor(currency)
  const major = amountMinor / divisor
  const fractionDigits = divisor === 1 ? 0 : 2
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(major)
  } catch {
    return `${currency.toUpperCase()} ${
      divisor === 1 ? String(Math.round(major)) : major.toFixed(2)
    }`
  }
}

function formatCredits(value: number): string {
  return value.toLocaleString('en-US')
}

function meterLabel(gate: PaywallStructuredContent): string {
  if (!gate.meterName) return 'units'
  return gate.meterName.replace(/_/g, ' ')
}

function namedCheckoutMarkdown(url: string): string {
  return `[Open checkout](${url})`
}

/** Escape markdown link-label delimiters — plan names are provider-authored. */
export function linkLabel(name: string): string {
  return name.replace(/([[\]])/g, '\\$1')
}

export function planLadder(gate: PaywallStructuredContent): string | null {
  const linkable = (gate.plans ?? [])
    .filter(p => typeof p.checkoutUrl === 'string' && p.checkoutUrl.length > 0)
    .filter(p => p.reference !== gate.planRef)
    .sort((a, b) => a.price - b.price)
    .slice(0, 4)
  if (linkable.length === 0) return null
  return linkable.map(p => `[${linkLabel(p.name ?? p.reference)}](${p.checkoutUrl})`).join(' · ')
}

const VIEWER_TOOL = 'account'

function callViewer(view?: 'checkout' | 'account' | 'topup'): string {
  return view
    ? `call the \`${VIEWER_TOOL}\` tool with view: '${view}'`
    : `call the \`${VIEWER_TOOL}\` tool`
}

function recoverClause(
  url: string | null,
  verb: string,
  view?: 'checkout' | 'account' | 'topup',
): string {
  if (url) {
    return ` ${namedCheckoutMarkdown(url)} to ${verb} (expires in ${CHECKOUT_SESSION_TTL_MINUTES} minutes), or ${callViewer(view)}.`
  }
  return ` ${callViewer(view).replace(/^c/, 'C')}.`
}

function hasActivePlan(gate: PaywallStructuredContent): boolean {
  return Boolean(gate.purchaseRef || (gate.planRef && gate.planRef.length > 0))
}

function autoRechargeDisabled(gate: PaywallStructuredContent): boolean {
  return gate.autoRecharge?.enabled === false
}

/**
 * Produce the terminal-friendly gate message. Names the `account`
 * viewer (with a `view` hint when the landing screen matters) or
 * `activate_plan` when a specific plan needs activating. Inlines
 * `gate.checkoutUrl` when present so terminal-only MCP hosts (Claude
 * Code, CLI clients) can open a browser directly. States the
 * 15-minute session lifetime inline — the URL is a bearer credential,
 * not a durable link.
 *
 * Kept as a pure string so the adapter layer can concatenate it with
 * an optional narrator prefix without parsing structured copy.
 */
export function buildGateMessage(
  state: PaywallState,
  gate: PaywallStructuredContent,
): string {
  const url = gate.checkoutUrl && gate.checkoutUrl.length > 0 ? gate.checkoutUrl : null
  const ladder = planLadder(gate)

  switch (state.kind) {
    case 'limit_reached': {
      const included = gate.included
      const price =
        gate.unitPriceMinor != null && gate.currency
          ? formatMinor(gate.unitPriceMinor, gate.currency)
          : null
      const usedLine = included
        ? `You've used ${included.used} of ${included.total} included ${meterLabel(gate)} this period.`
        : `You've reached the included usage for this period.`
      const nextLine = price ? ` The next call is ${price}.` : ''
      const planName = gate.planName ?? 'This plan'
      const antiTrap =
        gate.creditBalance !== undefined &&
        gate.creditBalance > 0 &&
        (gate.creditsPerCall === undefined || gate.creditsPerCall === 0)
          ? ` Adding credits will not help, because ${planName} does not spend them.`
          : ''
      const switchLine = ladder ? ` Or switch plan: ${ladder}.` : recoverClause(url, 'continue', 'checkout')
      return `${usedLine}${nextLine}${antiTrap}${switchLine} ${DOCS_HINT}`
    }
    case 'activation_required':
      return `Your plan needs activation.${recoverClause(url, 'activate', 'checkout')} Or call \`activate_plan\` with a \`planRef\`. ${DOCS_HINT}`
    case 'topup_required': {
      const balance = gate.creditBalance
      const cost = gate.creditsPerCall
      const shortfall = gate.shortfallCredits
      let lead: string
      if (balance !== undefined && cost !== undefined && shortfall !== undefined) {
        lead = `Out of credits for this call. Balance ${formatCredits(balance)} credits; this call costs ${formatCredits(cost)} credits — ${formatCredits(shortfall)} short.`
      } else {
        lead = 'Included usage is exhausted.'
      }
      const topup = recoverClause(url, 'add credits', 'topup')
      const auto =
        autoRechargeDisabled(gate)
          ? ' Auto-recharge is off — turn it on from the account tool to avoid this next time.'
          : ''
      const switchLine = ladder ? ` Or switch plan: ${ladder}.` : ''
      return `${lead}${topup}${auto}${switchLine} ${DOCS_HINT}`
    }
    case 'upgrade_required': {
      if (hasActivePlan(gate)) {
        const planName = gate.planName ?? 'This plan'
        const lead = `${planName} is active but its included usage is exhausted, and the automatic switch to the next plan did not complete.`
        if (ladder) {
          return `${lead} Switch here: ${ladder}. ${DOCS_HINT}`
        }
        return `${lead}${recoverClause(url, 'switch plan', 'checkout')} ${DOCS_HINT}`
      }
      if (ladder) {
        return `You don't have an active plan for this tool. Pick a plan to use this tool: ${ladder} (links expire in ${CHECKOUT_SESSION_TTL_MINUTES} minutes), or ${callViewer('checkout')}. ${DOCS_HINT}`
      }
      return `You don't have an active plan for this tool.${recoverClause(url, 'pick a plan', 'checkout')} ${DOCS_HINT}`
    }
    case 'reactivation_required':
      return `Your previous plan is no longer active. ${callViewer('account').replace(/^c/, 'C')} to reactivate it, or ${callViewer('checkout')} to pick a new plan. ${DOCS_HINT}`
  }
}

/**
 * Low-balance / approaching-cap nudge copy used as a plain text suffix
 * on a successful merchant response (no `structuredContent` switch, no
 * view switch). Mirrors the `buildGateMessage` surface so nudges feel
 * like a softer version of the same text-only nudge path.
 *
 * Receives the `PaywallState` the classifier would have produced if
 * the customer had tripped the gate. `upgrade_required`,
 * `limit_reached`, and `topup_required` are the kinds that currently
 * produce nudge copy; the others are no-ops (shouldn't happen —
 * nudges only fire on successful calls).
 */
export function buildNudgeMessage(
  state: PaywallState,
  limits: LimitResponseWithPlan | null,
): string {
  const url = limits?.checkoutUrl && limits.checkoutUrl.length > 0 ? limits.checkoutUrl : null
  const visitClause = url ? `, or ${namedCheckoutMarkdown(url)}` : ''
  const remaining = creditSignals(limits).remainingCalls

  switch (state.kind) {
    case 'topup_required':
      if (remaining === 0) {
        return `Heads up — 0 calls left — the next call needs a top-up. ${callViewer('topup').replace(/^c/, 'C')} to add more${visitClause}.`
      }
      return `Heads up — running low on credits. ${callViewer('topup').replace(/^c/, 'C')} to add more${visitClause}.`
    case 'upgrade_required':
    case 'limit_reached':
      if (remaining === 0) {
        return `Heads up — 0 calls left — the next call needs a top-up. ${callViewer('checkout').replace(/^c/, 'C')} for more headroom${visitClause}.`
      }
      return `Heads up — approaching your plan's limit this period. ${callViewer('checkout').replace(/^c/, 'C')} for more headroom${visitClause}.`
    case 'activation_required':
      return `Heads up — this plan still needs activation. Call the \`activate_plan\` tool with a \`planRef\`${visitClause}.`
    case 'reactivation_required':
      return `Heads up — your plan is no longer active. ${callViewer('account').replace(/^c/, 'C')} to reactivate it${visitClause}.`
  }
}
