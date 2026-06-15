import { describe, expect, it } from 'vitest'

import { describeClientAuthAdapterContract } from '../../../test-utils/src/describeClientAuthAdapterContract'
import { createAuth0ClientAuthAdapter } from './auth0'

describe('createAuth0ClientAuthAdapter', () => {
  it('returns auth0-session sentinel when user id is present', async () => {
    const adapter = createAuth0ClientAuthAdapter({ userId: 'auth0|user-1' })

    await expect(adapter.getToken()).resolves.toBe('auth0-session')
    await expect(adapter.getUserId()).resolves.toBe('auth0|user-1')
  })

  it('returns null when user id is absent', async () => {
    const adapter = createAuth0ClientAuthAdapter({ userId: null })

    await expect(adapter.getToken()).resolves.toBeNull()
    await expect(adapter.getUserId()).resolves.toBeNull()
  })
})

describeClientAuthAdapterContract({
  name: 'Auth0Client',
  createAuthenticatedAdapter: () => createAuth0ClientAuthAdapter({ userId: 'auth0|user-1' }),
  createUnauthenticatedAdapter: () => createAuth0ClientAuthAdapter({ userId: null }),
  expectedToken: 'auth0-session',
  expectedUserId: 'auth0|user-1',
})
