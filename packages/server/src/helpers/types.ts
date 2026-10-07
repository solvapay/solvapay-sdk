/**
 * Helper Types
 *
 * Shared types for route helpers
 */

/**
 * Error result returned by core helpers
 */
export interface ErrorResult {
  /** Text for the integrator's logs; the payer's copy is picked by `code`. */
  error: string
  status: number
  details?: string
  /** The backend's error key (`payment_declined`, `confirm_in_progress`, `card_not_found`), when it answered one. */
  code?: string
  /** Why a payment was not collected (402 `payment_declined`). */
  reason?: string
  /** Canonical decline code (402 `payment_declined`), when the rail gave one. */
  declineCode?: string
}

/**
 * Authenticated user information
 */
export interface AuthenticatedUser {
  userId: string
  email?: string | null
  name?: string | null
}
