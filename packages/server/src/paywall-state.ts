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
 * Discriminated union describing which recovery path the customer
 * needs. Every state maps to exactly one primary recovery tool except
 * `reactivation_required`, which surfaces two alternatives (rare).
 */
export type PaywallState =
  | { kind: 'activation_required' }
  | { kind: 'topup_required' }
  | { kind: 'upgrade_required' }
  | { kind: 'reactivation_required' }

/**
 * Classify a `LimitResponseWithPlan` (or `null` on degraded paths) into
 * a `PaywallState`. Pure — safe to call multiple times per request.
 *
 * Precedence:
 *  1. `activationRequired === true` — trumps everything else; the
 *     backend explicitly flagged that no plan is live yet.
 *  2. Usage-based plan out of credits — the customer has a plan but
 *     ran out, so a topup is the right action. "Out of credits" is
 *     determined from (in order): the nested
 *     `balance.creditBalance === 0` block, the top-level
 *     `creditBalance === 0` field, or `remaining === 0` as a
 *     fallback for older backend responses that omit both credit
 *     fields on usage-based plans.
 *  3. Everything else → `upgrade_required`, including:
 *     - `limits === null` (defensive),
 *     - no active plan on the product,
 *     - recurring plan at period cap (`remaining <= 0`).
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

  return { kind: 'upgrade_required' }
}

/**
 * Produce the terminal-friendly gate message. Names exactly one
 * recovery tool (`upgrade` / `topup` / `activate_plan`), except for
 * the rare `reactivation_required` path which names two alternatives
 * (`manage_account` / `upgrade`). Inlines `gate.checkoutUrl` when
 * present so terminal-only MCP hosts (Claude Code, CLI clients) can
 * open a browser directly.
 *
 * Kept as a pure string so the adapter layer can concatenate it with
 * an optional narrator prefix without parsing structured copy.
 */
export function buildGateMessage(
  state: PaywallState,
  gate: PaywallStructuredContent,
): string {
  const url = gate.checkoutUrl && gate.checkoutUrl.length > 0 ? gate.checkoutUrl : null
  const openClause = url ? `, or open ${url} in a browser` : ''

  switch (state.kind) {
    case 'activation_required':
      return `Your plan needs activation before you can use this tool. Call the \`activate_plan\` tool to activate it${openClause}.`
    case 'topup_required':
      return `You're out of credits. Call the \`topup\` tool to add more${openClause}.`
    case 'upgrade_required':
      return `You don't have an active plan for this tool. Call the \`upgrade\` tool to pick a plan${openClause}.`
    case 'reactivation_required':
      // Two-alternative case, used sparingly. The caller is free to
      // swap `manage_account` with `upgrade` copy later if the
      // backend distinguishes "reactivate previous" from "new plan".
      return `Your previous plan is no longer active. Call the \`manage_account\` tool to reactivate it, or the \`upgrade\` tool to pick a new plan.`
  }
}

/**
 * Low-balance / approaching-cap nudge copy used as a plain text suffix
 * on a successful merchant response (no `structuredContent` switch, no
 * view switch). Mirrors the `buildGateMessage` surface so nudges feel
 * like a softer version of the same text-only nudge path.
 *
 * Receives the `PaywallState` the classifier would have produced if
 * the customer had tripped the gate. `upgrade_required` and
 * `topup_required` are the only kinds that currently produce nudge
 * copy; the others are no-ops (shouldn't happen — nudges only fire
 * on successful calls).
 */
export function buildNudgeMessage(
  state: PaywallState,
  limits: LimitResponseWithPlan | null,
): string {
  const url = limits?.checkoutUrl && limits.checkoutUrl.length > 0 ? limits.checkoutUrl : null
  const visitClause = url ? `, or visit ${url}` : ''

  switch (state.kind) {
    case 'topup_required':
      return `Heads up — running low on credits. Call the \`topup\` tool to add more${visitClause}.`
    case 'upgrade_required':
      return `Heads up — approaching your plan's limit this period. Call the \`upgrade\` tool for more headroom${visitClause}.`
    case 'activation_required':
      return `Heads up — this plan still needs activation. Call the \`activate_plan\` tool${visitClause}.`
    case 'reactivation_required':
      return `Heads up — your plan is no longer active. Call the \`manage_account\` tool to reactivate it${visitClause}.`
  }
}
