/**
 * Catch-all SolvaPay API dispatcher.
 *
 * Uses the real SolvaPay backend when SOLVAPAY_SECRET_KEY is present in the
 * environment, otherwise falls back to the stub for local development without
 * credentials.
 */

import { createSolvaPayRouteHandlers } from '@solvapay/examples-shared/next-route-dispatcher'
import { getSolvaPay } from '@/lib/solvapay'

export const { GET, POST } = createSolvaPayRouteHandlers(getSolvaPay())
