import { describe, expect, it } from 'vitest'

type ClientAuthAdapter = {
  getToken: () => Promise<string | null>
  getUserId: () => Promise<string | null>
}

export interface ClientAuthAdapterContractOptions {
  name: string
  createAuthenticatedAdapter: () => ClientAuthAdapter
  createUnauthenticatedAdapter: () => ClientAuthAdapter
  expectedToken: string
  expectedUserId: string
}

/**
 * Shared contract tests for client-side `AuthAdapter` implementations.
 */
export function describeClientAuthAdapterContract(
  options: ClientAuthAdapterContractOptions,
): void {
  describe(`${options.name} client AuthAdapter contract`, () => {
    it('returns token and user id for authenticated clients', async () => {
      const adapter = options.createAuthenticatedAdapter()
      await expect(adapter.getToken()).resolves.toBe(options.expectedToken)
      await expect(adapter.getUserId()).resolves.toBe(options.expectedUserId)
    })

    it('returns null values for unauthenticated clients', async () => {
      const adapter = options.createUnauthenticatedAdapter()
      await expect(adapter.getToken()).resolves.toBeNull()
      await expect(adapter.getUserId()).resolves.toBeNull()
    })

    it('never throws when auth is unavailable', async () => {
      const adapter = options.createUnauthenticatedAdapter()
      await expect(adapter.getToken()).resolves.toBeNull()
      await expect(adapter.getUserId()).resolves.toBeNull()
    })
  })
}
