/**
 * SolvaPay Factory
 * 
 * Main entry point for creating SolvaPay instances with the unified payable API
 */

import type { SolvaPayClient, PayableOptions, HttpAdapterOptions, NextAdapterOptions, McpAdapterOptions } from './types';
import { createSolvaPayClient } from './client';
import { SolvaPayPaywall } from './paywall';
import { HttpAdapter, NextAdapter, McpAdapter, createAdapterHandler } from './adapters';
import { SolvaPayError, getSolvaPayConfig } from '@solvapay/core';

/**
 * Configuration for creating a SolvaPay instance
 */
export interface CreateSolvaPayConfig {
  /**
   * API key for production use (creates client automatically)
   */
  apiKey?: string;
  
  /**
   * API client for testing or custom implementations
   */
  apiClient?: SolvaPayClient;
  
  /**
   * Optional API base URL (only used with apiKey)
   */
  apiBaseUrl?: string;
}

/**
 * Payable function that provides explicit adapters
 */
export interface PayableFunction {
  /**
   * HTTP adapter for Express/Fastify
   */
  http<T = any>(
    businessLogic: (args: any) => Promise<T>,
    options?: HttpAdapterOptions
  ): (req: any, reply: any) => Promise<any>;
  
  /**
   * Next.js adapter for App Router
   */
  next<T = any>(
    businessLogic: (args: any) => Promise<T>,
    options?: NextAdapterOptions
  ): (request: Request, context?: any) => Promise<Response>;
  
  /**
   * MCP adapter for Model Context Protocol servers
   */
  mcp<T = any>(
    businessLogic: (args: any) => Promise<T>,
    options?: McpAdapterOptions
  ): (args: any) => Promise<any>;
  
  /**
   * Pure function adapter for direct function protection
   * Use this for testing, background jobs, or non-framework contexts
   */
  function<T = any>(
    businessLogic: (args: any) => Promise<T>,
  ): Promise<(args: any) => Promise<T>>;
}

/**
 * SolvaPay instance with payable method and common API methods
 */
export interface SolvaPay {
  /**
   * Create a payable handler with explicit adapters
   */
  payable(options?: PayableOptions): PayableFunction;
  
  /**
   * Ensure customer exists (for testing/setup)
   * Only attempts creation once per customer (idempotent).
   * 
   * @param customerRef - The customer reference (e.g., Supabase user ID)
   * @param externalRef - Optional external reference for backend lookup (e.g., Supabase user ID)
   *   If provided, will lookup existing customer by externalRef before creating new one
   * @param options - Optional customer details (email, name) for customer creation
   */
  ensureCustomer(customerRef: string, externalRef?: string, options?: { email?: string; name?: string }): Promise<string>;
  
  /**
   * Create a payment intent for a customer to subscribe to a plan
   */
  createPaymentIntent(params: {
    agentRef: string;
    planRef: string;
    customerRef: string;
    idempotencyKey?: string;
  }): Promise<{
    id: string;
    clientSecret: string;
    publishableKey: string;
    accountId?: string;
  }>;
  
  /**
   * Process a payment intent after client-side confirmation
   * Creates subscription or purchase immediately, eliminating webhook delay
   */
  processPayment(params: {
    paymentIntentId: string;
    agentRef: string;
    customerRef: string;
    planRef?: string;
  }): Promise<import('./types/client').ProcessPaymentResult>;
  
  /**
   * Check if customer is within usage limits
   */
  checkLimits(params: {
    customerRef: string;
    agentRef: string;
  }): Promise<{
    withinLimits: boolean;
    remaining: number;
    plan: string;
    checkoutUrl?: string;
  }>;
  
  /**
   * Track usage for a customer action
   */
  trackUsage(params: {
    customerRef: string;
    agentRef: string;
    planRef: string;
    outcome: 'success' | 'paywall' | 'fail';
    action?: string;
    requestId: string;
    actionDuration: number;
    timestamp: string;
  }): Promise<void>;
  
  /**
   * Create a new customer
   */
  createCustomer(params: {
    email: string;
    name?: string;
  }): Promise<{ customerRef: string }>;
  
  /**
   * Get customer details
   */
  getCustomer(params: {
    customerRef: string;
  }): Promise<{
    customerRef: string;
    email?: string;
    name?: string;
    plan?: string;
    subscriptions?: Array<{
      reference: string;
      planName: string;
      agentName: string;
      status: string;
      startDate: string;
    }>;
  }>;
  
  /**
   * Create a checkout session for a customer
   */
  createCheckoutSession(params: {
    agentRef: string;
    customerRef: string;
    planRef?: string;
  }): Promise<{
    sessionId: string;
    checkoutUrl: string;
  }>;
  
  /**
   * Create a customer session for accessing customer-specific functionality
   */
  createCustomerSession(params: {
    customerRef: string;
  }): Promise<{
    sessionId: string;
    customerUrl: string;
  }>;
  
  /**
   * Direct access to the API client for advanced operations
   * (agent/plan management, etc.)
   */
  apiClient: SolvaPayClient;
}

/**
 * Create a SolvaPay instance
 * 
 * @param config - Optional configuration with either apiKey or apiClient. If not provided, reads from environment variables.
 * @returns SolvaPay instance with payable() method
 * 
 * @example
 * ```typescript
 * // Production: Read from environment variables (recommended)
 * const solvaPay = createSolvaPay();
 * 
 * // Production: Pass API key explicitly
 * const solvaPay = createSolvaPay({ 
 *   apiKey: process.env.SOLVAPAY_SECRET_KEY 
 * });
 * 
 * // Testing: Pass mock client
 * const solvaPay = createSolvaPay({ 
 *   apiClient: mockClient 
 * });
 * 
 * // Create payable handlers
 * const payable = solvaPay.payable({ agent: 'my-api' });
 * app.post('/tasks', payable.http(createTask));
 * export const POST = payable.next(createTask);
 * ```
 */
export function createSolvaPay(config?: CreateSolvaPayConfig): SolvaPay {
  // If no config provided, read from environment variables
  let resolvedConfig: CreateSolvaPayConfig;
  if (!config) {
    const envConfig = getSolvaPayConfig();
    resolvedConfig = {
      apiKey: envConfig.apiKey,
      apiBaseUrl: envConfig.apiBaseUrl,
    };
  } else {
    resolvedConfig = config;
  }

  // Create or use provided API client
  const apiClient = resolvedConfig.apiClient || createSolvaPayClient({
    apiKey: resolvedConfig.apiKey!,
    apiBaseUrl: resolvedConfig.apiBaseUrl
  });
  
  // Create paywall instance with debug flag controlled by environment variable
  const paywall = new SolvaPayPaywall(apiClient, {
    debug: process.env.SOLVAPAY_DEBUG !== 'false'
  });
  
  return {
    // Direct access to API client for advanced operations
    apiClient,
    
    // Common API methods exposed directly for convenience
    ensureCustomer(customerRef: string, externalRef?: string, options?: { email?: string; name?: string }) {
      return paywall.ensureCustomer(customerRef, externalRef, options);
    },
    
    createPaymentIntent(params) {
      if (!apiClient.createPaymentIntent) {
        throw new SolvaPayError('createPaymentIntent is not available on this API client');
      }
      return apiClient.createPaymentIntent(params);
    },
    
    processPayment(params) {
      if (!apiClient.processPayment) {
        throw new SolvaPayError('processPayment is not available on this API client');
      }
      return apiClient.processPayment(params);
    },
    
    checkLimits(params) {
      return apiClient.checkLimits(params);
    },
    
    trackUsage(params) {
      return apiClient.trackUsage(params);
    },
    
    createCustomer(params) {
      if (!apiClient.createCustomer) {
        throw new SolvaPayError('createCustomer is not available on this API client');
      }
      return apiClient.createCustomer(params);
    },
    
    getCustomer(params) {
      if (!apiClient.getCustomer) {
        throw new SolvaPayError('getCustomer is not available on this API client');
      }
      return apiClient.getCustomer(params);
    },
    
    createCheckoutSession(params) {
      return apiClient.createCheckoutSession(params);
    },
    
    createCustomerSession(params) {
      return apiClient.createCustomerSession(params);
    },
    
    // Payable API for framework-specific handlers
    payable(options: PayableOptions = {}): PayableFunction {
      // Resolve agent name (support both agentRef and agent for backward compatibility)
      const agent = options.agentRef || options.agent || process.env.SOLVAPAY_AGENT || getPackageJsonName() || 'default-agent';
      // Resolve plan (support both planRef and plan for backward compatibility)
      const plan = options.planRef || options.plan || agent;
      
      const metadata = { agent, plan };
      
      return {
        // HTTP adapter for Express/Fastify
        http<T = any>(
          businessLogic: (args: any) => Promise<T>,
          adapterOptions?: HttpAdapterOptions
        ) {
          const adapter = new HttpAdapter(adapterOptions);
          return async (req: any, reply: any) => {
            const handler = await createAdapterHandler(
              adapter,
              paywall,
              metadata,
              businessLogic
            );
            return handler([req, reply]);
          };
        },
        
        // Next.js adapter for App Router
        next<T = any>(
          businessLogic: (args: any) => Promise<T>,
          adapterOptions?: NextAdapterOptions
        ) {
          const adapter = new NextAdapter(adapterOptions);
          return async (request: Request, context?: any) => {
            const handler = await createAdapterHandler(
              adapter,
              paywall,
              metadata,
              businessLogic
            );
            return handler([request, context]);
          };
        },
        
        // MCP adapter for Model Context Protocol
        mcp<T = any>(
          businessLogic: (args: any) => Promise<T>,
          adapterOptions?: McpAdapterOptions
        ) {
          const adapter = new McpAdapter(adapterOptions);
          return async (args: any) => {
            const handler = await createAdapterHandler(
              adapter,
              paywall,
              metadata,
              businessLogic
            );
            return handler(args);
          };
        },
        
        // Pure function adapter for direct protection
        async function<T = any>(
          businessLogic: (args: any) => Promise<T>,
        ): Promise<(args: any) => Promise<T>> {
          const getCustomerRef = (args: any) => args.auth?.customer_ref || 'anonymous';
          return paywall.protect(businessLogic, metadata, getCustomerRef);
        }
      };
    }
  };
}

/**
 * Helper to get package name from package.json
 */
function getPackageJsonName(): string | undefined {
  try {
    const pkg = require(process.cwd() + '/package.json');
    return pkg.name;
  } catch {
    return undefined;
  }
}

