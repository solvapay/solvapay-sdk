/**
 * HTTP Adapter for Express and Fastify
 *
 * Handles Express and Fastify HTTP frameworks with automatic detection
 * of request/response patterns.
 */

import type { Adapter } from './base'
import { AdapterUtils } from './base'
import type { HttpAdapterOptions, PaywallStructuredContent } from '../types'
import { PaywallError, paywallErrorToClientPayload } from '../paywall'
import { SolvaPayError } from '@solvapay/core'
import { mapRouteError, resolveCustomerRef } from '../native-decisions'

/**
 * HTTP context (Express or Fastify)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HttpContext = [req: any, reply: any]

/**
 * HTTP Adapter implementation
 */
export class HttpAdapter implements Adapter<HttpContext, unknown> {
  constructor(private options: HttpAdapterOptions = {}) {}

  extractArgs([req, _reply]: HttpContext): Record<string, unknown> {
    if (this.options.extractArgs) {
      return this.options.extractArgs(req)
    }

    // Default extraction from req.body, req.params, req.query
    return {
      ...((req.body as object) || {}),
      ...((req.params as object) || {}),
      ...((req.query as object) || {}),
    }
  }

  async getCustomerRef([req, _reply]: HttpContext): Promise<string> {
    let hookRef: string | undefined
    if (this.options.getCustomerRef) {
      const ref = await this.options.getCustomerRef(req)
      if (typeof ref === 'string' && ref.trim()) {
        hookRef = ref.trim()
      }
    }

    let verifiedJwtSub: string | undefined
    const authHeader = req.headers?.['authorization']
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const jwtSub = await AdapterUtils.extractFromJWT(authHeader.substring(7))
      if (jwtSub) {
        verifiedJwtSub = jwtSub
      }
    }

    const headerRef = req.headers?.['x-customer-ref']
    return resolveCustomerRef(
      hookRef,
      verifiedJwtSub,
      undefined,
      typeof headerRef === 'string' ? headerRef : undefined,
      undefined,
      undefined,
      undefined,
    )
  }

  formatResponse(result: unknown, [_req, reply]: HttpContext): unknown {
    if (this.options.transformResponse) {
      return this.options.transformResponse(result, reply)
    }

    // Express: has reply.status method
    if (reply && reply.status && typeof reply.json === 'function') {
      reply.json(result)
      return
    }

    // Fastify: return value for auto-serialization
    return result
  }

  /**
   * Emit a 402 Payment Required response with the same JSON body shape
   * REST consumers have always received (`{success:false, error, product,
   * checkoutUrl, message, ...}`). The shape is reused via
   * `paywallErrorToClientPayload` so HTTP / Next / hosted-proxy clients
   * don't have to branch on an SDK version.
   */
  formatGate(gate: PaywallStructuredContent, [_req, reply]: HttpContext): unknown {
    const errorResponse = paywallErrorToClientPayload(new PaywallError(gate.message, gate))
    const mapped = mapRouteError({
      kind: 'paywall',
      message: gate.message,
      operationName: 'paywall',
    })

    if (reply && reply.status && typeof reply.json === 'function') {
      reply.status(mapped.status).json(errorResponse)
      return
    }
    if (reply && reply.code) {
      reply.code(mapped.status)
    }
    return errorResponse
  }

  formatError(error: Error, [_req, reply]: HttpContext): unknown {
    const mapped = mapRouteError({
      kind:
        error instanceof PaywallError
          ? 'paywall'
          : error instanceof SolvaPayError
            ? 'solvapay'
            : 'error',
      message: error.message,
      status: error instanceof SolvaPayError ? (error.status ?? null) : null,
      operationName: 'paywall',
      defaultMessage: 'Internal server error',
    })
    const errorResponse = {
      success: false,
      error: mapped.error,
    }

    if (reply && reply.status && typeof reply.json === 'function') {
      reply.status(mapped.status).json(errorResponse)
      return
    }
    if (reply && reply.code) {
      reply.code(mapped.status)
    }
    return errorResponse
  }
}
