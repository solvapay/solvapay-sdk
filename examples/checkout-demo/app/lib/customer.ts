/**
 * Customer Management Utility
 *
 * Handles customer ID retrieval from Supabase authentication.
 * In a production app, customer IDs come from your authentication system.
 */

import { getUserId } from './supabase'

/**
 * Get the current user's ID from Supabase session
 * Returns empty string if not authenticated (for React Provider compatibility)
 */
export async function getOrCreateCustomerId(): Promise<string> {
  const userId = await getUserId()
  return userId || ''
}

/**
 * Update customer ID (kept for compatibility, but Supabase handles this)
 * In practice, this is a no-op since userId comes from Supabase session
 */
export function updateCustomerId(_newCustomerId: string): void {
  // No-op: customer ID is managed by Supabase auth
  // This is kept for compatibility with SolvaPayProvider's onCustomerRefUpdate callback
}

/**
 * Clear customer session (sign out)
 * Used for testing purposes or logout functionality
 */
export async function clearCustomerId(): Promise<void> {
  const { supabase } = await import('./supabase')
  await supabase.auth.signOut()
}
