import { createSessionAuthAdapter } from './session-auth'

export interface Auth0ClientAuthAdapterOptions {
  userId: string | null | undefined
  subscribe?: ReturnType<typeof createSessionAuthAdapter>['subscribe']
}

/**
 * Client adapter for `@auth0/nextjs-auth0` httpOnly session cookies.
 *
 * Pair with `createAuth0AuthAdapter` server middleware — the real credential
 * is the session cookie; this adapter only reports sign-in state to the SDK.
 */
export function createAuth0ClientAuthAdapter(options: Auth0ClientAuthAdapterOptions) {
  return createSessionAuthAdapter({
    getUserId: () => options.userId ?? null,
    sentinelToken: 'auth0-session',
    subscribe: options.subscribe,
  })
}
