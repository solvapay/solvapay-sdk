/**
 * Shared HTTP header names for SolvaPay identity bridging.
 *
 * Set by `@solvapay/next` middleware after session validation; consumed by
 * `@solvapay/server` `getAuthenticatedUserCore` and route helpers.
 */
export const SOLVAPAY_USER_ID_HEADER = 'x-user-id'

/** Standard Authorization header — may carry a claims JWT (e.g. Auth0 ID token) server-side only. */
export const SOLVAPAY_AUTHORIZATION_HEADER = 'authorization'
