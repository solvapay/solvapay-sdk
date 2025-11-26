/**
 * Next.js Adapter for App Router
 *
 * Handles Next.js App Router with Web Request/Response API
 */

import type { Adapter } from './base'
import { AdapterUtils } from './base'
import type { NextAdapterOptions } from '../types'
import { PaywallError } from '../paywall'

/**
 * Next.js context (Web Request + optional route context)
 */
type NextContext = [request: Request, context?: any]

/**
 * Next.js Adapter implementation
 */
export class NextAdapter implements Adapter<NextContext, Response> {
  constructor(private options: NextAdapterOptions = {}) {}

  async extractArgs([request, context]: NextContext): Promise<any> {
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
    if (this.options.getCustomerRef) {
      const ref = await this.options.getCustomerRef(request)
      return AdapterUtils.ensureCustomerRef(ref)
    }

    // Try to get from JWT token first
    const authHeader = request.headers.get('authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7)
      const jwtSub = await AdapterUtils.extractFromJWT(token)
      if (jwtSub) {
        return AdapterUtils.ensureCustomerRef(jwtSub)
      }
    }

    // Try x-user-id header (set by middleware, e.g., Supabase auth)
    const userId = request.headers.get('x-user-id')
    if (userId) {
      return AdapterUtils.ensureCustomerRef(userId)
    }

    // Fallback to x-customer-ref header
    const headerRef = request.headers.get('x-customer-ref')
    if (headerRef) {
      return AdapterUtils.ensureCustomerRef(headerRef)
    }

    // Default to demo_user for Next.js (common in examples)
    return 'demo_user'
  }

  formatResponse(result: any, _context: NextContext): Response {
    const transformed = this.options.transformResponse
      ? this.options.transformResponse(result)
      : result

    return new Response(JSON.stringify(transformed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  formatError(error: Error, _context: NextContext): Response {
    if (error instanceof PaywallError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Payment required',
          agent: error.structuredContent.agent,
          checkoutUrl: error.structuredContent.checkoutUrl,
          message: error.structuredContent.message,
        }),
        {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}
