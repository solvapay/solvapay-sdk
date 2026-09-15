import { BALANCE_RECONCILE_DELAYS_MS } from '@solvapay/core'

export function BALANCE_RECONCILE_GRACE_MS(): number {
  return BALANCE_RECONCILE_DELAYS_MS().reduce((sum, delay) => sum + delay, 0) + 1000
}
