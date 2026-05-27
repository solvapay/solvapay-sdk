/**
 * Validate optional `selections.plans` entries against the SolvaPay
 * default-plan guardrail (`Only free recurring or usage-based plans can
 * be set as default`) and the auto-enroll contract for MCP products.
 *
 * Used by `scaffold.mjs` as a pre-flight check so agents get a clear
 * error before posting to the plan-create API.
 */

const VALID_PLAN_KINDS = new Set(['recurring', 'one-time', 'usage-based', 'hybrid'])

export function getPlanKind(plan) {
  return plan?.type ?? plan?.kind
}

export function planRequiresPayment(plan) {
  if (typeof plan.requiresPayment === 'boolean') return plan.requiresPayment
  const kind = getPlanKind(plan)
  if (kind === 'usage-based') return Number(plan.creditsPerUnit ?? 0) > 0
  if (kind === 'hybrid') return true
  return Number(plan.price ?? 0) > 0
}

/** Mirrors `PlanCoreLib.isPlanEligibleForDefault` in solvapay-backend. */
export function isPlanEligibleForDefault(plan) {
  const kind = getPlanKind(plan)
  if (kind === 'usage-based') return true
  if (kind !== 'recurring') return false
  return !planRequiresPayment(plan)
}

/**
 * @param {unknown[]} plans
 * @returns {string[]} non-fatal reminders (e.g. missing freeUnits on a free default)
 */
export function collectPlanSelectionReminders(plans) {
  const reminders = []
  for (const [index, raw] of plans.entries()) {
    if (!raw || typeof raw !== 'object') continue
    const plan = /** @type {Record<string, unknown>} */ (raw)
    if (plan.default !== true) continue
    const kind = getPlanKind(plan)
    if (kind === 'recurring' && !planRequiresPayment(plan) && Number(plan.freeUnits ?? 0) <= 0) {
      reminders.push(
        `selections.plans[${index}]: free recurring default has no freeUnits — ` +
          `set freeUnits > 0 so the first checkLimits call auto-enrolls with a usable quota.`,
      )
    }
  }
  return reminders
}

/**
 * @param {unknown} plans
 * @throws {Error}
 */
export function validatePlanSelections(plans) {
  if (plans === undefined) return
  if (!Array.isArray(plans)) {
    throw new Error('selections.json: `plans` must be an array when provided.')
  }

  let defaultCount = 0

  for (const [index, raw] of plans.entries()) {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`selections.json: plans[${index}] must be an object.`)
    }
    const plan = /** @type {Record<string, unknown>} */ (raw)
    const kind = getPlanKind(plan)
    if (typeof kind !== 'string' || !VALID_PLAN_KINDS.has(kind)) {
      throw new Error(
        `selections.json: plans[${index}].type must be one of ${[...VALID_PLAN_KINDS].join(', ')}.`,
      )
    }

    if (plan.default === true) {
      defaultCount += 1
      if (!isPlanEligibleForDefault(plan)) {
        const label = plan.name ?? plan.reference ?? `plans[${index}]`
        throw new Error(
          `selections.json: ${label} cannot be the default plan — ` +
            `the SolvaPay API only accepts free recurring or usage-based defaults ` +
            `(paid recurring, one-time, and hybrid defaults are rejected). ` +
            `Use a free recurring plan (price: 0, freeUnits > 0) for MCP auto-enrollment on first tool call.`,
        )
      }
    }
  }

  if (defaultCount > 1) {
    throw new Error(
      'selections.json: at most one plan may set `default: true`.',
    )
  }
}
