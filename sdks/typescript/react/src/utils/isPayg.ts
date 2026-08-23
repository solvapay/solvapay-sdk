/**
 * Shared helper for detecting "pay as you go" / usage-based plans.
 *
 * Accepts the structural subset of a plan that any of the SDK's plan-shaped
 * types satisfy (`Plan` from `../types`, `BootstrapPlanLike` from the MCP
 * views, `LimitPlanSummary` from `@solvapay/server`). A plan is considered
 * PAYG when its `type` (or `planType` fallback used by bootstrap payloads)
 * is `'usage-based'` or `'hybrid'`.
 */
export interface PaygPlanLike {
  type?: string | null
  planType?: string | null
}

export function isPaygPlan(plan: PaygPlanLike | null | undefined): boolean {
  if (!plan) return false
  const type = plan.planType ?? plan.type
  return type === 'usage-based' || type === 'hybrid'
}
