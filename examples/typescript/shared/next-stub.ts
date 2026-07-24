/**
 * Shared Next.js SolvaPay factory for examples.
 *
 * Wraps a stubbed SolvaPayClient in a `createSolvaPay()` instance so the
 * examples/typescript/tailwind-checkout and examples/typescript/shadcn-checkout trees can share a
 * single wiring helper. The returned instance is cached per process so every
 * `@solvapay/next` route handler sees the same in-memory (or file-backed)
 * customer + free-tier state.
 *
 * In a real app, replace this helper with `createSolvaPay({ apiKey })` and
 * drop the stub entirely.
 */

import { createSolvaPay, type SolvaPay } from '@solvapay/server'
import { createStubClient, type StubClientOptions } from './stub-api-client'

let cached: SolvaPay | null = null

export function createStubSolvaPay(options: StubClientOptions = {}): SolvaPay {
  if (cached) return cached
  cached = createSolvaPay({
    apiClient: createStubClient({
      useFileStorage: process.env.NODE_ENV !== 'production',
      freeTierLimit: 5,
      ...options,
    }),
  })
  return cached
}
