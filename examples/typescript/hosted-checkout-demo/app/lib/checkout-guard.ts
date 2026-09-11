import { useSyncExternalStore } from 'react'

// Shared module-level guard — prevents concurrent checkout/customer-session requests
// across components (Navigation + page both render an Upgrade button). Module is
// evaluated once per JS context, so the lock is shared across all importers.
let inProgress = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach(fn => fn())
}

export function acquireCheckoutLock(): boolean {
  if (inProgress) return false
  inProgress = true
  notify()
  return true
}

export function releaseCheckoutLock(): void {
  inProgress = false
  notify()
}

export function useCheckoutInProgress(): boolean {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => inProgress,
    () => false,
  )
}
