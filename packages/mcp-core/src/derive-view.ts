/**
 * Server-side default for the viewer tool's optional `view` argument.
 *
 * The three surfaces share one payload; omitting `view` must still land
 * somewhere useful instead of failing. Rule:
 *   - no active plan → checkout (plans)
 *   - active plan and zero credits → topup
 *   - otherwise → account
 *
 * When the preferred view is disabled on this server, fall through the
 * same priority order to the first enabled view. Omitting `view` is
 * never a failure if at least one view is enabled.
 */

import type { BootstrapCustomer, BootstrapPayload, SolvaPayMcpViewKind } from './types'
import { SOLVAPAY_MCP_VIEW_KINDS } from './types'

const VIEW_PRIORITY: readonly SolvaPayMcpViewKind[] = ['checkout', 'topup', 'account']

function isPlanPurchase(purchase: { planSnapshot?: unknown; metadata?: { purpose?: string } }): boolean {
  return !!purchase.planSnapshot && purchase.metadata?.purpose !== 'credit_topup'
}

function hasActivePlan(customer: BootstrapCustomer | null | undefined): boolean {
  const purchases = customer?.purchase?.purchases ?? []
  return purchases.some(isPlanPurchase)
}

function isOutOfCredits(customer: BootstrapCustomer | null | undefined): boolean {
  const credits = customer?.balance?.credits
  return credits === 0
}

/**
 * Pick the landing view from a bootstrap snapshot. Pure — does not
 * fetch. Call after `buildBootstrapPayload` (the view argument there
 * is only an echoed label) and stamp the result onto `payload.view`.
 */
export function deriveDefaultView(
  data: Pick<BootstrapPayload, 'customer'>,
  enabledViews: ReadonlySet<SolvaPayMcpViewKind> = new Set(SOLVAPAY_MCP_VIEW_KINDS),
): SolvaPayMcpViewKind {
  const customer = data.customer
  const preferred: SolvaPayMcpViewKind = !hasActivePlan(customer)
    ? 'checkout'
    : isOutOfCredits(customer)
      ? 'topup'
      : 'account'

  if (enabledViews.has(preferred)) return preferred

  for (const view of VIEW_PRIORITY) {
    if (enabledViews.has(view)) return view
  }

  throw new Error(
    'deriveDefaultView: no enabled views — the viewer tool should not be registered',
  )
}
