/**
 * HTTP Adapter for Express and Fastify
 * 
 * Handles Express and Fastify HTTP frameworks with automatic detection
 * of request/response patterns.
 */

import type { Adapter } from './base';
import { AdapterUtils } from './base';
import type { HttpAdapterOptions } from '../types';
import { PaywallError } from '../paywall';

/**
 * HTTP context (Express or Fastify)
 */
type HttpContext = [req: any, reply: any];

/**
 * HTTP Adapter implementation
 */
export class HttpAdapter implements Adapter<HttpContext, any> {
  constructor(private options: HttpAdapterOptions = {}) {}

  extractArgs([req, _reply]: HttpContext): any {
    if (this.options.extractArgs) {
      return this.options.extractArgs(req);
    }
    
    // Default extraction from req.body, req.params, req.query
    return {
      ...(req.body as object || {}),
      ...(req.params as object || {}),
      ...(req.query as object || {})
    };
  }

  async getCustomerRef([req, _reply]: HttpContext): Promise<string> {
    if (this.options.getCustomerRef) {
      const ref = await this.options.getCustomerRef(req);
      return AdapterUtils.ensureCustomerRef(ref);
    }
    
    // Try x-customer-ref header first
    const headerRef = req.headers?.['x-customer-ref'];
    if (headerRef) {
      return AdapterUtils.ensureCustomerRef(headerRef);
    }
    
    // Try JWT token if available
    const authHeader = req.headers?.['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const jwtSub = await AdapterUtils.extractFromJWT(token);
      if (jwtSub) {
        return AdapterUtils.ensureCustomerRef(jwtSub);
      }
    }
    
    // Fallback to anonymous
    return 'anonymous';
  }

  formatResponse(result: any, [_req, reply]: HttpContext): any {
    if (this.options.transformResponse) {
      return this.options.transformResponse(result, reply);
    }
    
    // Express: has reply.status method
    if (reply && reply.status && typeof reply.json === 'function') {
      reply.json(result);
      return;
    }
    
    // Fastify: return value for auto-serialization
    return result;
  }

  formatError(error: Error, [_req, reply]: HttpContext): any {
    if (error instanceof PaywallError) {
      const errorResponse = {
        success: false,
        error: 'Payment required',
        agent: error.structuredContent.agent,
        checkoutUrl: error.structuredContent.checkoutUrl,
        message: error.structuredContent.message
      };
      
      // Express: has reply.status method
      if (reply && reply.status && typeof reply.json === 'function') {
        reply.status(402).json(errorResponse);
        return;
      }
      
      // Fastify: use reply.code
      if (reply && reply.code) {
        reply.code(402);
      }
      return errorResponse;
    }
    
    // Generic error
    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    };
    
    // Express: has reply.status method
    if (reply && reply.status && typeof reply.json === 'function') {
      reply.status(500).json(errorResponse);
      return;
    }
    
    // Fastify: use reply.code
    if (reply && reply.code) {
      reply.code(500);
    }
    return errorResponse;
  }
}

