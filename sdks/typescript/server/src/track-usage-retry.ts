import { shouldRetryUsageError } from './native-decisions'
import type { TrackUsageRequest, TrackUsageResponse } from './types'
import { withRetry } from './utils'

/**
 * Single usage-emission retry policy for the gate driver and `trackUsageCore`.
 *
 * Matches the frozen `withRetry` defaults (2 retries, 500ms, fixed) and the
 * core `shouldRetryUsageError` predicate so both paths retry the same failures.
 */
export async function trackUsageWithRetry(
  trackUsage: (request: TrackUsageRequest) => Promise<TrackUsageResponse>,
  request: TrackUsageRequest,
): Promise<TrackUsageResponse> {
  return withRetry(() => trackUsage(request), {
    maxRetries: 2,
    initialDelay: 500,
    shouldRetry: error => shouldRetryUsageError(error.message),
    onRetry: (_error, attempt) => {
      console.warn(`⚠️  Customer not found (attempt ${attempt + 1}/3), retrying in 500ms...`)
    },
  })
}
