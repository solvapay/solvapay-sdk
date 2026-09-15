import { createSolvaPay, type SolvaPay } from '@solvapay/server'
import { createStubSolvaPay } from '@solvapay/examples-shared/next-stub'

let cached: SolvaPay | null = null

export function getSolvaPay(): SolvaPay {
  if (cached) return cached
  if (process.env.SOLVAPAY_SECRET_KEY) {
    cached = createSolvaPay()
    return cached
  }
  cached = createStubSolvaPay()
  return cached
}
