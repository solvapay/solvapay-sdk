/**
 * Base error class for SolvaPay SDK errors.
 *
 * All SolvaPay SDK errors extend this class, making it easy to catch
 * and handle SDK-specific errors separately from other errors.
 *
 * @example
 * ```typescript
 * import { SolvaPayError } from '@solvapay/core';
 *
 * try {
 *   const config = getSolvaPayConfig();
 * } catch (error) {
 *   if (error instanceof SolvaPayError) {
 *     // Handle SolvaPay-specific error
 *     console.error('SolvaPay error:', error.message);
 *   } else {
 *     // Handle other errors
 *     throw error;
 *   }
 * }
 * ```
 *
 * @since 1.0.0
 */
export class SolvaPayError extends Error {
  /**
   * HTTP status code associated with the error, when the error
   * originated from an upstream API response. Optional so existing
   * `new SolvaPayError(message)` callsites stay valid.
   */
  readonly status?: number

  /**
   * Optional short code for programmatic branching (e.g.
   * `'missing_secret'`, `'merchant_not_found'`). Free-form by design;
   * callers should not depend on an exhaustive enum.
   */
  readonly code?: string

  /**
   * Creates a new SolvaPayError instance.
   *
   * @param message - Error message
   * @param init - Optional `{ status, code }` metadata. Both fields
   *   are preserved on the instance so downstream consumers
   *   (`handleRouteError`, MCP trace wrappers) can branch on HTTP
   *   status without parsing the message string.
   */
  constructor(message: string, init: { status?: number; code?: string } = {}) {
    super(message)
    this.name = 'SolvaPayError'
    this.status = init.status
    this.code = init.code
  }
}
