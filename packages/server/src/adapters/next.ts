/**
 * Next.js Adapter for App Router
 *
 * Handles Next.js App Router with Web Request/Response API
 */

import type { Adapter } from './base'
import { AdapterUtils } from './base'
import type { NextAdapterOptions, PaywallStructuredContent } from '../types'
import { PaywallError, paywallErrorToClientPayload } from '../paywall'
import {
  identifyRequest,
  identityLabel,
  isUnauthorized,
  type RequestIdentity,
} from '../request-identity'

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

  /**
   * `getCustomerRef` when given; otherwise a verified bearer token, the
   * `x-user-id` your middleware sets after verifying the session (a user),
   * `x-customer-ref` behind a trusted gateway, or anonymous. There is no
   * default customer. See `identifyRequest`.
   */
  async getIdentity([request]: NextContext): Promise<RequestIdentity> {
    if (this.options.getCustomerRef) {
      const ref = AdapterUtils.ensureCustomerRef(await this.options.getCustomerRef(request))
      return ref === 'anonymous' ? { kind: 'anonymous' } : { kind: 'customer', customerRef: ref }
    }
    const hasBearer = /^bearer\s+/i.test(request.headers.get('authorization')?.trim() ?? '')
    const userId = request.headers.get('x-user-id')?.trim()
    if (userId && !hasBearer) return { kind: 'user', userId }
    return identifyRequest(name => request.headers.get(name))
  }

  async getCustomerRef(context: NextContext): Promise<string> {
    return identityLabel(await this.getIdentity(context))
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
    return new Response(
      JSON.stringify(paywallErrorToClientPayload(new PaywallError(gate.message, gate))),
      {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  formatError(error: Error, _context: NextContext): Response {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        status: isUnauthorized(error) ? 401 : 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}
