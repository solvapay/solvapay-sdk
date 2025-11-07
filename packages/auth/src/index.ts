/**
 * @solvapay/auth
 * 
 * Authentication adapters for extracting user IDs from requests.
 * Provides adapters for Supabase and mock/testing scenarios.
 */

// Export the interface
export type { AuthAdapter, RequestLike } from './adapter';

// Export mock adapter (no dependencies)
export { MockAuthAdapter } from './mock';
export type { MockAuthAdapter as MockAuthAdapterType } from './mock';

// Export Next.js route utilities
export { getUserIdFromRequest, requireUserId, getUserEmailFromRequest, getUserNameFromRequest } from './next-utils';

// Note: SupabaseAuthAdapter is exported from ./supabase.ts directly
// Users import it via: import { SupabaseAuthAdapter } from '@solvapay/auth/supabase'
// This keeps the main export lean if users don't need Supabase

