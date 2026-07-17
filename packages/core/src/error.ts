/**
 * Pure route-error decision cores (Step 31).
 *
 * `console.error` and `instanceof` narrowing stay in `@solvapay/server`.
 */

export type RouteErrorResult = {
  error: string
  status: number
  details?: string
}

export type RouteErrorKind = 'solvapay' | 'error' | 'unknown'

export interface RouteErrorInput {
  kind: RouteErrorKind
  message: string | null
  status?: number | null
  operationName: string
  defaultMessage?: string | null
}

/**
 * Map a narrowed route error into the helper ErrorResult shape.
 *
 * - `solvapay` → `{ error: message, status: status ?? 500, details: message }`
 * - `error` / `unknown` → `{ error: defaultMessage || \`${operationName} failed\`, status: 500, details }`
 */
export function mapRouteError(input: RouteErrorInput): RouteErrorResult {
  if (input.kind === 'solvapay') {
    const errorMessage = input.message ?? ''
    return {
      error: errorMessage,
      status: input.status ?? 500,
      details: errorMessage,
    }
  }

  const details = input.kind === 'error' ? (input.message ?? 'Unknown error') : 'Unknown error'
  const message = input.defaultMessage || `${input.operationName} failed`

  return {
    error: message,
    status: 500,
    details,
  }
}

/**
 * Check if a result is an error result (`error` + `status` keys).
 */
export function isErrorResult(result: unknown): result is RouteErrorResult {
  return typeof result === 'object' && result !== null && 'error' in result && 'status' in result
}
