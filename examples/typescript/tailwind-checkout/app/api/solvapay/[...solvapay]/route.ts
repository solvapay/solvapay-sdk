/**
 * Catch-all SolvaPay API dispatcher.
 *
 * Uses the real SolvaPay backend when SOLVAPAY_SECRET_KEY is present in the
 * environment, otherwise falls back to the stub for local development without
 * credentials.
 */

import { createSolvaPayRouteHandlers } from '@solvapay/examples-shared/next-route-dispatcher'
import { getSolvaPay } from '@/lib/solvapay'

const { GET: getHandler, POST: postHandler } = createSolvaPayRouteHandlers(getSolvaPay())

type RouteContext = { params: Promise<{ solvapay: string[] }> }

export async function GET(request: Request, ctx: RouteContext) {
  return getHandler(request, ctx)
}

export async function POST(request: Request, ctx: RouteContext) {
  return postHandler(request, ctx)
}
