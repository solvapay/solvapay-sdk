import { describe, expect, it } from 'vitest'

import { describeClientAuthAdapterContract } from '../../../test-utils/src/describeClientAuthAdapterContract'
import { createSessionAuthAdapter } from './session-auth'

describe('createSessionAuthAdapter', () => {
  it('returns sentinel token when user id is present', async () => {
    const adapter = createSessionAuthAdapter({
      getUserId: () => 'auth0|user-1',
    })

    await expect(adapter.getToken()).resolves.toBe('session-authenticated')
    await expect(adapter.getUserId()).resolves.toBe('auth0|user-1')
  })

  it('returns null when user id is absent', async () => {
    const adapter = createSessionAuthAdapter({
      getUserId: () => null,
    })

    await expect(adapter.getToken()).resolves.toBeNull()
    await expect(adapter.getUserId()).resolves.toBeNull()
  })

  it('supports custom sentinel token', async () => {
    const adapter = createSessionAuthAdapter({
      getUserId: () => 'auth0|user-1',
      sentinelToken: 'auth0-session',
    })

    await expect(adapter.getToken()).resolves.toBe('auth0-session')
  })

  it('prefers explicit getToken when provided', async () => {
    const adapter = createSessionAuthAdapter({
      getUserId: () => 'auth0|user-1',
      getToken: () => 'custom-token',
    })

    await expect(adapter.getToken()).resolves.toBe('custom-token')
  })
})

describeClientAuthAdapterContract({
  name: 'SessionAuth',
  createAuthenticatedAdapter: () =>
    createSessionAuthAdapter({
      getUserId: () => 'auth0|user-1',
      sentinelToken: 'session-authenticated',
    }),
  createUnauthenticatedAdapter: () =>
    createSessionAuthAdapter({
      getUserId: () => null,
    }),
  expectedToken: 'session-authenticated',
  expectedUserId: 'auth0|user-1',
})
