/**
 * Route-error types (Step 31 / Step 52). Helpers are Rust-only in `native-helpers.ts`.
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
