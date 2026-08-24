/**
 * The plan every spec checks out.
 *
 * Read from the live catalog rather than hard-coded, so the suite works against
 * whatever product the operator points it at. Usage-based plans are skipped:
 * they route the stepped checkouts through an extra amount step, and a fixed
 * plan → payment shape keeps the five specs comparable.
 */

import { resolveMerchantEnv } from './env'
import { assertPayableCatalog, type PaidPlan } from './platform'

let pending: Promise<PaidPlan> | null = null

export function checkoutPlan(): Promise<PaidPlan> {
  pending ??= (async () => {
    const env = resolveMerchantEnv()
    const payable = await assertPayableCatalog(env)
    const plan = payable.find(candidate => candidate.type !== 'usage-based')

    if (!plan) {
      throw new Error(
        `[examples-e2e] Product ${env.productRef} only exposes usage-based paid plans. ` +
          'Add a recurring or one-time paid plan — the specs assert the plan → payment flow.',
      )
    }
    if (!plan.name) {
      throw new Error(
        `[examples-e2e] Plan ${plan.reference} has no name, so the specs cannot pick its ` +
          'card out of the plan grid. Name the plan in the provider console.',
      )
    }

    return plan
  })()

  return pending
}
