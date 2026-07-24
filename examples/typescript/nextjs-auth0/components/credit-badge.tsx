'use client'

import { BalanceBadge } from '@solvapay/react'

/**
 * Client wrapper around the SDK's `<BalanceBadge>` so it can be dropped into
 * the (server-rendered) site header. `@solvapay/react` pulls in client-only
 * context, so it must be imported from a `'use client'` module.
 *
 * Renders nothing until a credit balance loads (unauthenticated users, or
 * before the first balance fetch).
 */
export function CreditBadge() {
  return (
    <BalanceBadge className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground" />
  )
}
