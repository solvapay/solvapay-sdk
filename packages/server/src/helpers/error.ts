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

  // Handle SolvaPay configuration errors
  if (error instanceof SolvaPayError) {
    const errorMessage = error.message
    return {
      error: errorMessage,
      status: 500,
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
