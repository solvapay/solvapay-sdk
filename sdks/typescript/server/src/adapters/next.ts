/**
 * Next.js Adapter for App Router
 *
 * Handles Next.js App Router with Web Request/Response API
 */

import type { Adapter } from './base'
import { AdapterUtils } from './base'
import type { NextAdapterOptions, PaywallStructuredContent } from '../types'
import { PaywallError, paywallErrorToClientPayload } from '../paywall'
import { SolvaPayError } from '@solvapay/core'
import { mapRouteError, resolveCustomerRef } from '../native-decisions'

/**
 * Next.js context (Web Request + optional route context)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NextContext = [request: Request, context?: any]

/**
 * Next.js Adapter implementation
 */
export class NextAdapter implements Adapter<NextContext, Response> {
  constructor(private options: NextAdapterOptions = {}) {}

  async extractArgs([request, context]: NextContext): Promise<Record<string, unknown>> {
    if (this.options.extractArgs) {
      return await this.options.extractArgs(request, context)
    }

    // Default extraction from URL, body, and route params
    const url = new URL(request.url)
    const query = Object.fromEntries(url.searchParams.entries())

    // Parse request body if present
    let body = {}
    try {
      if (
        request.method !== 'GET' &&
        request.headers.get('content-type')?.includes('application/json')
      ) {
        body = await request.json()
      }
    } catch {
      // If parsing fails, continue with empty body
    }

    // Handle route parameters if provided
    let routeParams = {}
    if (context?.params) {
      if (typeof context.params === 'object' && 'then' in context.params) {
        // Handle Promise<params> case (Next.js 15+ app router)
        routeParams = await context.params
      } else {
        routeParams = context.params
      }
    }

    return {
      ...body,
      ...query,
      ...routeParams,
    }
  }

  async getCustomerRef([request]: NextContext): Promise<string> {
    let hookRef: string | undefined
    if (this.options.getCustomerRef) {
      const ref = await this.options.getCustomerRef(request)
      if (typeof ref === 'string' && ref.trim()) {
        hookRef = ref.trim()
      }
    }

    let verifiedJwtSub: string | undefined
    const authHeader = request.headers.get('authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const jwtSub = await AdapterUtils.extractFromJWT(authHeader.substring(7))
      if (jwtSub) {
        verifiedJwtSub = jwtSub
      }
    }

    return resolveCustomerRef(
      hookRef,
      verifiedJwtSub,
      request.headers.get('x-user-id') ?? undefined,
      request.headers.get('x-customer-ref') ?? undefined,
      undefined,
      undefined,
      undefined,
    )
  }

  formatResponse(result: unknown, _context: NextContext): Response {
    const transformed = this.options.transformResponse
      ? this.options.transformResponse(result)
      : result

    return new Response(JSON.stringify(transformed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Emit a 402 Payment Required `Response` with the same JSON body
   * REST consumers have always received. Reuses
   * `paywallErrorToClientPayload` so HTTP / Next / hosted-proxy
   * clients don't have to branch on an SDK version.
   */
  formatGate(gate: PaywallStructuredContent, _context: NextContext): Response {
    const mapped = mapRouteError({
      kind: 'paywall',
      message: gate.message,
      operationName: 'paywall',
    })
    return new Response(
      JSON.stringify(paywallErrorToClientPayload(new PaywallError(gate.message, gate))),
      {
        status: mapped.status,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  formatError(error: Error, _context: NextContext): Response {
    const mapped = mapRouteError({
      kind: error instanceof PaywallError ? 'paywall' : error instanceof SolvaPayError ? 'solvapay' : 'error',
      message: error.message,
      status: error instanceof SolvaPayError ? (error.status ?? null) : null,
      operationName: 'paywall',
      defaultMessage: 'Internal server error',
    })
    return new Response(JSON.stringify({ success: false, error: mapped.error }), {
      status: mapped.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
