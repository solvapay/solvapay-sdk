/**
 * Canonical registry file (2/4).
 *
 * Returns the process-wide SolvaPay instance used by every catch-all route
 * under `app/api/solvapay/[...solvapay]`. Replace the stub fallback with
 * your production wiring (typically `createSolvaPay({ apiKey: env.KEY })`)
 * when integrating.
 */

import { createSolvaPay, type SolvaPay } from '@solvapay/server'
import { createStubSolvaPay } from '@solvapay/examples-shared/next-stub'

let cached: SolvaPay | null = null

export function getSolvaPay(): SolvaPay {
  if (cached) return cached
  if (process.env.SOLVAPAY_SECRET_KEY) {
    cached = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY })
    return cached
  }
  cached = createStubSolvaPay()
  return cached
}
