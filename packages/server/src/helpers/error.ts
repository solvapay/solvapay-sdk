/**
 * Error Handling Helper
 *
 * Generic error handling utilities for route helpers
 */

import { SolvaPayError } from '@solvapay/core'
import type { ErrorResult } from './types'

/**
 * Check if a result is an error result
 */
export function isErrorResult(result: unknown): result is ErrorResult {
  return typeof result === 'object' && result !== null && 'error' in result && 'status' in result
}

/**
 * Handle route errors and convert to ErrorResult
 */
export function handleRouteError(
  error: unknown,
  operationName: string,
  defaultMessage?: string,
): ErrorResult {
  console.error(`[${operationName}] Error:`, error)

  // Handle SolvaPay errors. `SolvaPayError.status` carries the
  // upstream HTTP status when the error came from a backend response
  // (e.g. 404 from `GET /v1/sdk/merchant`). Configuration errors and
  // other client-side throws have no status — those collapse to 500
  // as before.
  if (error instanceof SolvaPayError) {
    const errorMessage = error.message
    return {
      error: errorMessage,
      status: error.status ?? 500,
      details: errorMessage,
    }
  }

  const errorMessage = error instanceof Error ? error.message : 'Unknown error'
  const message = defaultMessage || `${operationName} failed`

  return {
    error: message,
    status: 500,
    details: errorMessage,
  }
}
