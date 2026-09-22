/**
 * Identity headers for this demo's own `/api/*` routes.
 *
 * Supabase mode sends the session JWT, which `proxy.ts` verifies. Anonymous
 * mode sends the browser-local customer ref, which `proxy.ts` promotes to
 * `x-user-id`. Either way the API routes see one authenticated customer.
 */

import { getOrCreateAnonymousCustomerRef } from '@solvapay/react'
import { demoAuthMode } from './auth-mode'
import { getAccessToken } from './supabase'

export async function identityHeaders(): Promise<Record<string, string>> {
  if (demoAuthMode === 'anonymous') {
    return { 'x-customer-ref': getOrCreateAnonymousCustomerRef() }
  }

  const accessToken = await getAccessToken()
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
}
