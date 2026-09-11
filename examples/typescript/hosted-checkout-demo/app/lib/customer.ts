/**
 * Customer Management Utility
 *
 * Resolves the SolvaPay customer ref from whichever identity source the demo
 * runs on (see `auth-mode.ts`). In a production app this always comes from your
 * authentication system.
 */

import { getOrCreateAnonymousCustomerRef } from '@solvapay/react'
import { demoAuthMode } from './auth-mode'
import { getUserId } from './supabase'

/**
 * Get the current customer ref: the Supabase user id, or a browser-local
 * anonymous ref when the demo runs without Supabase.
 * Returns empty string if not authenticated (for React Provider compatibility)
 */
export async function getOrCreateCustomerId(): Promise<string> {
  if (demoAuthMode === 'anonymous') {
    return getOrCreateAnonymousCustomerRef()
  }
  const userId = await getUserId()
  return userId || ''
}
