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
   * Envelope kind (`Api`, `Webhook`, `Transport`, …) when the error
   * was reconstructed from a native or WASM call.
   */
  readonly kind?: string

  /**
   * Whether the caller should retry. Present when core set it on the
   * envelope; absent when the failure is not a transport decision.
   */
  readonly retryable?: boolean

  /**
   * Creates a new SolvaPayError instance.
   *
   * @param message - Error message
   * @param init - Optional metadata. Fields are preserved on the instance
   *   so downstream consumers can branch without parsing the message.
   */
  constructor(
    message: string,
    init: { status?: number; code?: string; kind?: string; retryable?: boolean } = {},
  ) {
    super(message)
    this.name = 'SolvaPayError'
    this.status = init.status
    this.code = init.code
    this.kind = init.kind
    this.retryable = init.retryable
  }
}
