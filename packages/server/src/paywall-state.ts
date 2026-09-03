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

import type { LimitResponseWithPlan, PaywallStructuredContent } from './types'

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

/**
 * Classify a `LimitResponseWithPlan` (or `null` on degraded paths) into
 * a `PaywallState`. Pure — safe to call multiple times per request.
 *
 * Precedence:
 *  1. `activationRequired === true` — trumps everything else; the
 *     backend explicitly flagged that no plan is live yet.
 *  2. Authoritative `needsTopUp` / `needsUpgrade` flags from
 *     `decideLimit`, when the backend sent them. Prefer these over
 *     the credit-balance heuristic so a top-up deny and an
 *     auto-upgrade deny are not re-derived from plan type.
 *  3. Usage-based plan out of credits — the customer has a plan but
 *     ran out, so a topup is the right action. "Out of credits" is
 *     determined from (in order): the nested
 *     `balance.creditBalance === 0` block, the top-level
 *     `creditBalance === 0` field, or `remaining === 0` as a
 *     fallback for older backend responses that omit both credit
 *     fields on usage-based plans.
 *  4. Active plan at included cap (`plan` is a non-empty ref and
 *     `remaining <= 0`) → `limit_reached`. This is the "on Free, used
 *     3 of 3" case — not "no plan".
 *  5. Everything else → `upgrade_required`, including:
 *     - `limits === null` (defensive),
 *     - no active plan on the product.
 *
 * `reactivation_required` is deferred — it needs a distinct backend
 * signal (future `LimitResponse.inactivePurchaseRef`) which isn't
 * emitted yet. Kept in the type so downstream code compiles against
 * the full discriminated union; `classifyPaywallState` will never
 * return it under current backend behaviour.
 */
export function classifyPaywallState(
  limits: LimitResponseWithPlan | null,
): PaywallState {
  if (!limits) return { kind: 'upgrade_required' }

  if (limits.activationRequired === true) {
    return { kind: 'activation_required' }
  }

  if (limits.needsTopUp === true) {
    return { kind: 'topup_required' }
  }

  if (limits.needsUpgrade === true) {
    return { kind: 'upgrade_required' }
  }

  const activePlan = limits.plans?.find(p => p.reference === limits.plan)
  // A resolved plan with `type === 'usage-based'` is authoritative.
  // Presence of the `balance` block is an older-backend proxy for
  // "this response describes a usage-based customer" — every
  // backend that emits the structured balance uses it for
  // usage-based tiers. We treat either signal as usage-based so
  // the topup path fires when the plan list is missing.
  const isUsageBased =
    activePlan?.type === 'usage-based' || limits.balance !== undefined
  // Coalesce the two credit-balance channels. Nested wins when
  // present (richer schema on newer backends); fall back to the
  // top-level optional field. `undefined` means "we can't
  // determine the balance" and we defer to `remaining` below.
  const creditBalance = limits.balance?.creditBalance ?? limits.creditBalance

  if (isUsageBased) {
    if (creditBalance === 0) return { kind: 'topup_required' }
    // Fallback: when the response omits both credit-balance
    // channels on a usage-based plan, `remaining === 0` means the
    // customer is exhausted — the only actionable recovery is a
    // topup. Without this, usage-based customers on older backend
    // responses got sent to `upgrade` ("pick a plan") when they
    // should have been sent to `topup` ("add credits").
    if (creditBalance === undefined && limits.remaining === 0) {
      return { kind: 'topup_required' }
    }
  }

  if (limits.plan.length > 0 && limits.remaining <= 0) {
    return { kind: 'limit_reached' }
  }

  return { kind: 'upgrade_required' }
}

function formatMinor(amountMinor: number, currency: string): string {
  const major = amountMinor / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major)
  } catch {
    return `${currency.toUpperCase()} ${major.toFixed(2)}`
  }
}

function meterLabel(gate: PaywallStructuredContent): string {
  if (!gate.meterName) return 'units'
  return gate.meterName.replace(/_/g, ' ')
}

function namedCheckoutMarkdown(url: string): string {
  return `[Open checkout](${url})`
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
      return `${usedLine}${nextLine}${recoverClause(url, 'continue', 'checkout')} ${DOCS_HINT}`
    }
    case 'activation_required':
      return `Your plan needs activation.${recoverClause(url, 'activate', 'checkout')} Or call \`activate_plan\` with a \`planRef\`. ${DOCS_HINT}`
    case 'topup_required': {
      const currency = gate.currency ?? gate.balance?.currency ?? 'USD'
      const presets = [1000, 2500, 5000, 10_000].map(m => formatMinor(m, currency)).join(' · ')
      return `You're out of credits. Top up first (${presets}).${recoverClause(url, 'add credits', 'topup')} ${DOCS_HINT}`
    }
    case 'upgrade_required':
      return `You don't have an active plan for this tool.${recoverClause(url, 'pick a plan', 'checkout')} ${DOCS_HINT}`
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

  switch (state.kind) {
    case 'topup_required':
      return `Heads up — running low on credits. ${callViewer('topup').replace(/^c/, 'C')} to add more${visitClause}.`
    case 'upgrade_required':
    case 'limit_reached':
      return `Heads up — approaching your plan's limit this period. ${callViewer('checkout').replace(/^c/, 'C')} for more headroom${visitClause}.`
    case 'activation_required':
      return `Heads up — this plan still needs activation. Call the \`activate_plan\` tool with a \`planRef\`${visitClause}.`
    case 'reactivation_required':
      return `Heads up — your plan is no longer active. ${callViewer('account').replace(/^c/, 'C')} to reactivate it${visitClause}.`
  }
}
