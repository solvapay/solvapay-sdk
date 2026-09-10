/**
 * Hosted-portal deep links minted from a customer session URL.
 *
 * Phase 1 suffixes the already-minted `customerUrl` in the SDK so the
 * MCP widget can land on the auto-recharge form without a new network
 * call or a platform deploy. The query params are the same ones the
 * customer-app manage page already parses (`tab=credits&intent=autorecharge`).
 *
 * Keep this constant in lockstep with
 * `apps/customer-app/src/pages/customer/manage/index.tsx`. A rename
 * there without a matching change here degrades to the Credits tab
 * without the form open — not a dead link, but not the intended
 * destination either.
 */

export const PORTAL_AUTO_RECHARGE_QUERY = 'tab=credits&intent=autorecharge'

/**
 * Suffix a minted customer-portal URL so it opens the auto-recharge
 * form (or the Credits summary when auto-recharge is already on).
 *
 * Returns `null` for a missing or non-http URL — the same guard
 * `narrate.ts` uses. No silent default: a missing portal URL yields
 * `null` and the widget renders status without an action.
 */
export function autoRechargeUrlFrom(customerUrl: string | null | undefined): string | null {
  if (typeof customerUrl !== 'string' || !/^https?:\/\//i.test(customerUrl)) {
    return null
  }
  const separator = customerUrl.includes('?') ? '&' : '?'
  return `${customerUrl}${separator}${PORTAL_AUTO_RECHARGE_QUERY}`
}
