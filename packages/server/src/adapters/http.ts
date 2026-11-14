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
import {
  identifyRequest,
  identityLabel,
  isUnauthorized,
  type RequestIdentity,
} from '../request-identity'

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

  /**
   * `getCustomerRef` when given; otherwise a verified bearer token (a user),
   * `x-customer-ref` behind a trusted gateway, or anonymous. See
   * `identifyRequest`.
   */
  async getIdentity([req, _reply]: HttpContext): Promise<RequestIdentity> {
    if (this.options.getCustomerRef) {
      const ref = AdapterUtils.ensureCustomerRef(await this.options.getCustomerRef(req))
      return ref === 'anonymous' ? { kind: 'anonymous' } : { kind: 'customer', customerRef: ref }
    }
    return identifyRequest(name => {
      const value = req.headers?.[name]
      return Array.isArray(value) ? value[0] : value
    })
  }

  async getCustomerRef(context: HttpContext): Promise<string> {
    return identityLabel(await this.getIdentity(context))
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

    // Express: has reply.status method
    if (reply && reply.status && typeof reply.json === 'function') {
      reply.status(402).json(errorResponse)
      return
    }

    // Fastify: use reply.code
    if (reply && reply.code) {
      reply.code(402)
    }
    return errorResponse
  }

  formatError(error: Error, [_req, reply]: HttpContext): unknown {
    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }

    // Express: has reply.status method
    if (reply && reply.status && typeof reply.json === 'function') {
      reply.status(isUnauthorized(error) ? 401 : 500).json(errorResponse)
      return
    }

    // Fastify: use reply.code
    if (reply && reply.code) {
      reply.code(isUnauthorized(error) ? 401 : 500)
    }
    return errorResponse
  }
}
