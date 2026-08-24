import { describeAuthAdapterContract } from '../../test-utils/src/describeAuthAdapterContract'
import { createAuth0AuthAdapter } from './auth0'
import { MockAuthAdapter } from './mock'

describeAuthAdapterContract({
  name: 'Mock',
  createAdapter: () => new MockAuthAdapter(),
  authenticatedRequest: new Request('https://example.com', {
    headers: { 'x-mock-user-id': 'test-user-123' },
  }),
  unauthenticatedRequest: new Request('https://example.com'),
  expectedUserId: 'test-user-123',
})

describeAuthAdapterContract({
  name: 'Mock (override)',
  createAdapter: () => new MockAuthAdapter(),
  authenticatedRequest: new Request('https://example.com', {
    headers: { 'x-mock-user-id': 'override-user' },
  }),
  unauthenticatedRequest: new Request('https://example.com'),
  expectedUserId: 'override-user',
})

describeAuthAdapterContract({
  name: 'Auth0',
  createAdapter: () =>
    createAuth0AuthAdapter({
      auth0: {
        middleware: async () => new Response(),
        getSession: async request => {
          const pathname = new URL(request.url).pathname
          if (pathname.includes('/authenticated')) {
            return {
              user: { sub: 'auth0|contract-user' },
              tokenSet: { idToken: 'id.token.jwt' },
            }
          }
          return null
        },
      },
    }),
  authenticatedRequest: new Request('https://example.com/authenticated'),
  unauthenticatedRequest: new Request('https://example.com/unauthenticated'),
  expectedUserId: 'auth0|contract-user',
})
