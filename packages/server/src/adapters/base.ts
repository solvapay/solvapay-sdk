/**
 * Base Adapter Interface
 * 
 * Defines the contract for all framework adapters.
 * Each adapter handles extraction, transformation, and formatting for its specific context.
 */

import type { SolvaPayPaywall } from '../paywall';
import type { PaywallMetadata } from '../types';

/**
 * Base adapter interface that all framework adapters implement
 */
export interface Adapter<TContext = any, TResult = any> {
  /**
   * Extract plain arguments from the framework-specific context
   */
  extractArgs(context: TContext): Promise<any> | any;
  
  /**
   * Extract customer reference from the context
   */
  getCustomerRef(context: TContext): Promise<string> | string;
  
  /**
   * Format the business logic result for the framework
   */
  formatResponse(result: any, context: TContext): TResult;
  
  /**
   * Format errors for the framework
   */
  formatError(error: Error, context: TContext): TResult;
}

/**
 * Shared utilities for adapters
 */
export class AdapterUtils {
  /**
   * Ensure customer reference is properly formatted
   */
  static ensureCustomerRef(customerRef: string): string {
    if (!customerRef || customerRef === 'anonymous') {
      return 'anonymous';
    }
    
    // Ensure customer ref is properly formatted
    if (!customerRef.startsWith('customer_') && !customerRef.startsWith('demo_')) {
      return `customer_${customerRef.replace(/[^a-zA-Z0-9]/g, '_')}`;
    }
    
    return customerRef;
  }

  /**
   * Extract customer ref from JWT token
   */
  static async extractFromJWT(token: string, options?: {
    secret?: string;
    issuer?: string;
    audience?: string;
  }): Promise<string | null> {
    try {
      const { jwtVerify } = await import('jose');
      const jwtSecret = new TextEncoder().encode(
        options?.secret || process.env.OAUTH_JWKS_SECRET || 'test-jwt-secret'
      );
      
      const { payload } = await jwtVerify(token, jwtSecret, {
        issuer: options?.issuer || process.env.OAUTH_ISSUER || 'http://localhost:3000',
        audience: options?.audience || process.env.OAUTH_CLIENT_ID || 'test-client-id'
      });
      
      return payload.sub as string || null;
    } catch (error) {
      // JWT verification failed, return null
      return null;
    }
  }
}

/**
 * Create a protected handler using an adapter
 */
export async function createAdapterHandler<TContext, TResult>(
  adapter: Adapter<TContext, TResult>,
  paywall: SolvaPayPaywall,
  metadata: PaywallMetadata,
  businessLogic: (args: any) => Promise<any>
): Promise<(context: TContext) => Promise<TResult>> {
  return async (context: TContext): Promise<TResult> => {
    try {
      // Extract args and customer ref using the adapter
      const args = await adapter.extractArgs(context);
      const customerRef = await adapter.getCustomerRef(context);
      
      // Add auth info to args
      args.auth = { customer_ref: customerRef };
      
      // Create protected handler
      const getCustomerRef = (args: any) => args.auth.customer_ref;
      const protectedHandler = await paywall.protect(businessLogic, metadata, getCustomerRef);
      
      // Execute protected handler
      const result = await protectedHandler(args);
      
      // Format response using the adapter
      return adapter.formatResponse(result, context);
      
    } catch (error) {
      // Format error using the adapter
      return adapter.formatError(error as Error, context);
    }
  };
}

