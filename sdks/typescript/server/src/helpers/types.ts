/**
 * Helper Types
 *
 * Shared types for route helpers
 */

/**
 * Error result returned by core helpers
 */
export interface ErrorResult {
  error: string
  status: number
  details?: string
}

/**
 * Authenticated user information
 */
export interface AuthenticatedUser {
  userId: string
  email?: string | null
  name?: string | null
}
