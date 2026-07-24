/**
 * Error Handling Helper
 *
 * Generic error handling utilities for route helpers.
 * Decision core lives in `@solvapay/core` (`mapRouteError` / `isErrorResult`);
 * this shim owns `console.error` and `instanceof` narrowing.
 */

import { SolvaPayError, type RouteErrorResult } from '@solvapay/core'
import { isErrorResult, mapRouteError } from '../native-decisions'

export type { RouteErrorResult }
export { isErrorResult }

/**
 * Handle route errors and convert to ErrorResult
 */
export function handleRouteError(
  error: unknown,
  operationName: string,
  defaultMessage?: string,
): RouteErrorResult {
  console.error(`[${operationName}] Error:`, error)

  // Handle SolvaPay errors. `SolvaPayError.status` carries the
  // upstream HTTP status when the error came from a backend response
  // (e.g. 404 from `GET /v1/sdk/merchant`). Configuration errors and
  // other client-side throws have no status — those collapse to 500
  // as before.
  if (error instanceof SolvaPayError) {
    return mapRouteError({
      kind: 'solvapay',
      message: error.message,
      status: error.status ?? null,
      operationName,
      defaultMessage,
    })
  }

  if (error instanceof Error) {
    return mapRouteError({
      kind: 'error',
      message: error.message,
      operationName,
      defaultMessage,
    })
  }

  return mapRouteError({
    kind: 'unknown',
    message: null,
    operationName,
    defaultMessage,
  })
}
