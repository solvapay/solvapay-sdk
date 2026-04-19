/**
 * Canonical registry file (3/4).
 *
 * Catch-all dispatcher for every SolvaPay backend call. Reads the shared
 * SolvaPay instance from `lib/solvapay.ts` and forwards each route to the
 * matching `@solvapay/next` helper via
 * `@solvapay/examples-shared/next-route-dispatcher`.
 */

import { createSolvaPayRouteHandlers } from '@solvapay/examples-shared/next-route-dispatcher'
import { getSolvaPay } from '@/lib/solvapay'

export const { GET, POST } = createSolvaPayRouteHandlers(getSolvaPay())
