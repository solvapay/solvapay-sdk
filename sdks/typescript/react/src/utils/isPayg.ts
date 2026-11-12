/**
 * Shared helper for detecting "pay as you go" / usage-based plans.
 *
 * Accepts the structural subset of a plan that any of the SDK's plan-shaped
 * types satisfy (`Plan` from `../types`, `BootstrapPlanLike` from the MCP
 * views, `LimitPlanSummary` from `@solvapay/server`). A plan is PAYG only
 * when the backend's derived `type` label is `'usage-based'` — metered with
 * no billing cycle and no upfront charge. `'hybrid'` is a recurring plan
 * that also meters usage; it carries an upfront charge and must take the
 * card path, not activate-then-top-up. The catalog, limits and bootstrap
 * wires all carry that same `type` field.
 */
export interface PaygPlanLike {
  type?: string | null
}

export function isPaygPlan(plan: PaygPlanLike | null | undefined): boolean {
  return plan?.type === 'usage-based'
}
