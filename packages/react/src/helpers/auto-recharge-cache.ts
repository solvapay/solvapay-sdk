import { BALANCE_RECONCILE_DELAYS_MS } from '@solvapay/server'

export const BALANCE_RECONCILE_GRACE_MS =
  BALANCE_RECONCILE_DELAYS_MS.reduce((sum, delay) => sum + delay, 0) + 1000
