/**
 * Shared helper for detecting "pay as you go" / usage-based plans.
 *
 * Accepts the structural subset of a plan that any of the SDK's plan-shaped
 * types satisfy (`Plan` from `../types`, `BootstrapPlanLike` from the MCP
 * views, `LimitPlanSummary` from `@solvapay/server`). A plan is PAYG when
 * the backend's derived `type` label is `'usage-based'` or `'hybrid'` —
 * the catalog, limits and bootstrap wires all carry that same field.
 */
export interface PaygPlanLike {
  type?: string | null
}

export function isPaygPlan(plan: PaygPlanLike | null | undefined): boolean {
  return plan?.type === 'usage-based' || plan?.type === 'hybrid'
}
