import { describe, expect, it } from 'vitest'

import type { AuthAdapter } from '@solvapay/auth'

export interface AuthAdapterContractOptions {
  name: string
  createAdapter: () => AuthAdapter
  authenticatedRequest: Request
  unauthenticatedRequest: Request
  expectedUserId: string
}

/**
 * Shared contract tests for server-side `AuthAdapter` implementations.
 */
export function describeAuthAdapterContract(options: AuthAdapterContractOptions): void {
  describe(`${options.name} AuthAdapter contract`, () => {
    it('returns user id for authenticated requests', async () => {
      const adapter = options.createAdapter()
      const userId = await adapter.getUserIdFromRequest(options.authenticatedRequest)
      expect(userId).toBe(options.expectedUserId)
    })

    it('returns null for unauthenticated requests', async () => {
      const adapter = options.createAdapter()
      const userId = await adapter.getUserIdFromRequest(options.unauthenticatedRequest)
      expect(userId).toBeNull()
    })

    it('never throws on getUserIdFromRequest', async () => {
      const adapter = options.createAdapter()
      await expect(adapter.getUserIdFromRequest(options.unauthenticatedRequest)).resolves.toBeNull()
    })
  })
}
