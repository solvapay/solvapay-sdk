/**
 * Catch-all SolvaPay API dispatcher.
 *
 * Every `@solvapay/next` helper is wired up in
 * `@solvapay/examples-shared/next-route-dispatcher`. Swap
 * `createStubSolvaPay()` for `createSolvaPay({ apiKey: ... })` when
 * integrating against the real backend.
 */

import { createStubSolvaPay } from '@solvapay/examples-shared/next-stub'
import { createSolvaPayRouteHandlers } from '@solvapay/examples-shared/next-route-dispatcher'

export const { GET, POST } = createSolvaPayRouteHandlers(createStubSolvaPay())
