/**
 * SolvaPay Factory
 *
 * Main entry point for creating SolvaPay instances with the unified payable API
 */

import type {
  SolvaPayClient,
  PayableOptions,
  HttpAdapterOptions,
  NextAdapterOptions,
  McpAdapterOptions,
  CustomerResponseMapped,
} from './types'
import { createSolvaPayClient } from './client'
import { SolvaPayPaywall } from './paywall'
import { HttpAdapter, NextAdapter, McpAdapter, createAdapterHandler } from './adapters'
import { SolvaPayError, getSolvaPayConfig } from '@solvapay/core'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Configuration for creating a SolvaPay instance.
 *
 * You can provide either an `apiKey` (for production) or an `apiClient` (for testing).
 * If neither is provided, the SDK will attempt to read `SOLVAPAY_SECRET_KEY` from
 * environment variables. If no API key is found, the SDK runs in stub mode.
 *
 * @example
 * ```typescript
 * // Production: Use API key
 * const config: CreateSolvaPayConfig = {
 *   apiKey: process.env.SOLVAPAY_SECRET_KEY
 * };
 *
 * // Testing: Use mock client
 * const config: CreateSolvaPayConfig = {
 *   apiClient: mockClient
 * };
 * ```
 */
export interface CreateSolvaPayConfig {
  /**
   * API key for production use (creates client automatically).
   * Defaults to `SOLVAPAY_SECRET_KEY` environment variable if not provided.
   */
  apiKey?: string

  /**
   * API client for testing or custom implementations.
   * Use this for stub mode, testing, or custom client implementations.
   */
  apiClient?: SolvaPayClient

  /**
   * Optional API base URL override (only used with apiKey).
   * Defaults to production API URL if not provided.
   */
  apiBaseUrl?: string
}

/**
 * Payable function that provides explicit adapters for different frameworks.
 *
 * Use the appropriate adapter method for your framework:
 * - `http()` - Express.js, Fastify, and other HTTP frameworks
 * - `next()` - Next.js App Router API routes
 * - `mcp()` - Model Context Protocol servers
 * - `function()` - Pure functions, background jobs, or testing
 *
 * @example
 * ```typescript
 * const payable = solvaPay.payable({ agent: 'agt_myapi', plan: 'pln_premium' });
 *
 * // Express.js
 * app.post('/tasks', payable.http(createTask));
 *
 * // Next.js
 * export const POST = payable.next(createTask);
 *
 * // MCP Server
 * const handler = payable.mcp(createTask);
 *
 * // Pure function
 * const protectedFn = await payable.function(createTask);
 * ```
 */
export interface PayableFunction {
  /**
   * HTTP adapter for Express.js, Fastify, and other HTTP frameworks.
   *
   * @param businessLogic - Your business logic function
   * @param options - Optional adapter configuration
   * @returns HTTP route handler function
   *
   * @example
   * ```typescript
   * app.post('/tasks', payable.http(async (req) => {
   *   const { title } = req.body;
   *   return { success: true, task: { title } };
   * }));
   * ```
   */
  http<T = any>(
    businessLogic: (args: any) => Promise<T>,
    options?: HttpAdapterOptions,
  ): (req: any, reply: any) => Promise<any>

  /**
   * Next.js adapter for App Router API routes.
   *
   * @param businessLogic - Your business logic function
   * @param options - Optional adapter configuration
   * @returns Next.js route handler function
   *
   * @example
   * ```typescript
   * // app/api/tasks/route.ts
   * export const POST = payable.next(async (request) => {
   *   const body = await request.json();
   *   return Response.json({ success: true });
   * });
   * ```
   */
  next<T = any>(
    businessLogic: (args: any) => Promise<T>,
    options?: NextAdapterOptions,
  ): (request: Request, context?: any) => Promise<Response>

  /**
   * MCP adapter for Model Context Protocol servers.
   *
   * @param businessLogic - Your tool implementation function
   * @param options - Optional adapter configuration
   * @returns MCP tool handler function
   *
   * @example
   * ```typescript
   * const handler = payable.mcp(async (args) => {
   *   return { success: true, result: 'tool output' };
   * });
   * ```
   */
  mcp<T = any>(
    businessLogic: (args: any) => Promise<T>,
    options?: McpAdapterOptions,
  ): (args: any) => Promise<any>

  /**
   * Pure function adapter for direct function protection.
   *
   * Use this for testing, background jobs, or non-framework contexts.
   *
   * @param businessLogic - Your business logic function
   * @returns Protected function that requires customer reference in args
   *
   * @example
   * ```typescript
   * const protectedFn = await payable.function(async (args) => {
   *   return { result: 'processed' };
   * });
   *
   * // Call with customer reference
   * const result = await protectedFn({
   *   auth: { customer_ref: 'user_123' },
   *   // ... other args
   * });
   * ```
   */
  function<T = any>(businessLogic: (args: any) => Promise<T>): Promise<(args: any) => Promise<T>>
}

/**
 * SolvaPay instance with payable method and common API methods.
 *
 * This interface provides the main API for interacting with SolvaPay.
 * Use `createSolvaPay()` to create an instance.
 *
 * @example
 * ```typescript
 * const solvaPay = createSolvaPay();
 *
 * // Create payable handlers
 * const payable = solvaPay.payable({ agent: 'agt_myapi', plan: 'pln_premium' });
 *
 * // Manage customers
 * const customerRef = await solvaPay.ensureCustomer('user_123', 'user_123', {
 *   email: 'user@example.com'
 * });
 *
 * // Create payment intents
 * const intent = await solvaPay.createPaymentIntent({
 *   agentRef: 'agt_myapi',
 *   planRef: 'pln_premium',
 *   customerRef: 'user_123'
 * });
 * ```
 */
export interface SolvaPay {
  /**
   * Create a payable handler with explicit adapters for different frameworks.
   *
   * @param options - Payable options including agent and plan references
   * @returns PayableFunction with framework-specific adapters
   *
   * @example
   * ```typescript
   * const payable = solvaPay.payable({
   *   agent: 'agt_myapi',
   *   plan: 'pln_premium'
   * });
   *
   * app.post('/tasks', payable.http(createTask));
   * ```
   */
  payable(options?: PayableOptions): PayableFunction

  /**
   * Ensure customer exists in SolvaPay backend (idempotent).
   *
   * Creates a customer if they don't exist, or returns existing customer reference.
   * This is automatically called by the paywall system, but you can call it
   * explicitly for setup or testing.
   *
   * @param customerRef - The customer reference used as a cache key (e.g., Supabase user ID)
   * @param externalRef - Optional external reference for backend lookup (e.g., Supabase user ID).
   *   If provided, will lookup existing customer by externalRef before creating new one.
   *   The externalRef is stored on the SolvaPay backend for customer lookup.
   * @param options - Optional customer details for customer creation
   * @param options.email - Customer email address
   * @param options.name - Customer name
   * @returns Customer reference (backend customer ID)
   *
   * @example
   * ```typescript
   * // Ensure customer exists before processing payment
   * const customerRef = await solvaPay.ensureCustomer(
   *   'user_123',           // customerRef (your user ID)
   *   'user_123',           // externalRef (same or different)
   *   {
   *     email: 'user@example.com',
   *     name: 'John Doe'
   *   }
   * );
   * ```
   */
  ensureCustomer(
    customerRef: string,
    externalRef?: string,
    options?: { email?: string; name?: string },
  ): Promise<string>

  /**
   * Create a Stripe payment intent for a customer to purchase to a plan.
   *
   * This creates a payment intent that can be confirmed on the client side
   * using Stripe.js. After confirmation, call `processPayment()` to complete
   * the purchase.
   *
   * @param params - Payment intent parameters
   * @param params.agentRef - Agent reference
   * @param params.planRef - Plan reference to purchase to
   * @param params.customerRef - Customer reference
   * @param params.idempotencyKey - Optional idempotency key for retry safety
   * @returns Payment intent with client secret and publishable key
   *
   * @example
   * ```typescript
   * const intent = await solvaPay.createPaymentIntent({
   *   agentRef: 'agt_myapi',
   *   planRef: 'pln_premium',
   *   customerRef: 'user_123',
   *   idempotencyKey: 'unique-key-123'
   * });
   *
   * // Use intent.clientSecret with Stripe.js on client
   * ```
   */
  createPaymentIntent(params: {
    agentRef: string
    planRef: string
    customerRef: string
    idempotencyKey?: string
  }): Promise<{
    id: string
    clientSecret: string
    publishableKey: string
    accountId?: string
  }>

  /**
   * Process a payment intent after client-side Stripe confirmation.
   *
   * Creates purchase or purchase immediately, eliminating webhook delay.
   * Call this after the client has confirmed the payment intent with Stripe.js.
   *
   * @param params - Payment processing parameters
   * @param params.paymentIntentId - Stripe payment intent ID from client confirmation
   * @param params.agentRef - Agent reference
   * @param params.customerRef - Customer reference
   * @param params.planRef - Optional plan reference (if not in payment intent)
   * @returns Payment processing result with purchase details
   *
   * @example
   * ```typescript
   * // After client confirms payment with Stripe.js
   * const result = await solvaPay.processPayment({
   *   paymentIntentId: 'pi_1234567890',
   *   agentRef: 'agt_myapi',
   *   customerRef: 'user_123',
   *   planRef: 'pln_premium'
   * });
   *
   * if (result.success) {
   *   console.log('Purchase created:', result.purchaseRef);
   * }
   * ```
   */
  processPayment(params: {
    paymentIntentId: string
    agentRef: string
    customerRef: string
    planRef?: string
  }): Promise<import('./types/client').ProcessPaymentResult>

  /**
   * Check if customer is within usage limits for an agent.
   *
   * This method checks purchase status and usage limits without
   * executing business logic. Use `payable()` for automatic protection.
   *
   * @param params - Limit check parameters
   * @param params.customerRef - Customer reference
   * @param params.agentRef - Agent reference
   * @returns Limit check result with remaining usage and checkout URL if needed
   *
   * @example
   * ```typescript
   * const limits = await solvaPay.checkLimits({
   *   customerRef: 'user_123',
   *   agentRef: 'agt_myapi'
   * });
   *
   * if (!limits.withinLimits) {
   *   // Redirect to checkout
   *   window.location.href = limits.checkoutUrl;
   * }
   * ```
   */
  checkLimits(params: { customerRef: string; agentRef: string }): Promise<{
    withinLimits: boolean
    remaining: number
    plan: string
    checkoutUrl?: string
  }>

  /**
   * Track usage for a customer action.
   *
   * This is automatically called by the paywall system. You typically
   * don't need to call this manually unless implementing custom tracking.
   *
   * @param params - Usage tracking parameters
   * @param params.customerRef - Customer reference
   * @param params.agentRef - Agent reference
   * @param params.planRef - Plan reference
   * @param params.outcome - Action outcome ('success', 'paywall', or 'fail')
   * @param params.action - Optional action name for analytics
   * @param params.requestId - Unique request ID
   * @param params.actionDuration - Action duration in milliseconds
   * @param params.timestamp - ISO timestamp of the action
   *
   * @example
   * ```typescript
   * await solvaPay.trackUsage({
   *   customerRef: 'user_123',
   *   agentRef: 'agt_myapi',
   *   planRef: 'pln_premium',
   *   outcome: 'success',
   *   action: 'api_call',
   *   requestId: 'req_123',
   *   actionDuration: 150,
   *   timestamp: new Date().toISOString()
   * });
   * ```
   */
  trackUsage(params: {
    customerRef: string
    agentRef: string
    planRef: string
    outcome: 'success' | 'paywall' | 'fail'
    action?: string
    requestId: string
    actionDuration: number
    timestamp: string
  }): Promise<void>

  /**
   * Create a new customer in SolvaPay backend.
   *
   * Note: `ensureCustomer()` is usually preferred as it's idempotent.
   * Use this only if you need explicit control over customer creation.
   *
   * @param params - Customer creation parameters
   * @param params.email - Customer email address (required)
   * @param params.name - Optional customer name
   * @returns Created customer reference
   *
   * @example
   * ```typescript
   * const { customerRef } = await solvaPay.createCustomer({
   *   email: 'user@example.com',
   *   name: 'John Doe'
   * });
   * ```
   */
  createCustomer(params: { email: string; name?: string }): Promise<{ customerRef: string }>

  /**
   * Get customer details including purchases and usage.
   *
   * Returns full customer information from the SolvaPay backend, including
   * all active purchases, usage history, and customer metadata.
   *
   * @param params - Customer lookup parameters
   * @param params.customerRef - Optional customer reference (SolvaPay ID)
   * @param params.externalRef - Optional external reference (e.g., Supabase ID)
   * @returns Customer details with purchases and metadata
   *
   * @example
   * ```typescript
   * // Lookup by SolvaPay customer ID
   * const customer = await solvaPay.getCustomer({
   *   customerRef: 'cust_123'
   * });
   *
   * // Lookup by external ID (e.g. Supabase user ID)
   * const customer = await solvaPay.getCustomer({
   *   externalRef: 'user_123'
   * });
   * ```
   */
  getCustomer(params: {
    customerRef?: string
    externalRef?: string
  }): Promise<CustomerResponseMapped>

  /**
   * Create a hosted checkout session for a customer.
   *
   * This creates a Stripe Checkout session that redirects the customer
   * to a hosted payment page. After payment, customer is redirected back.
   *
   * @param params - Checkout session parameters
   * @param params.agentRef - Agent reference
   * @param params.customerRef - Customer reference
   * @param params.planRef - Optional plan reference (if not specified, shows plan selector)
   * @param params.returnUrl - URL to redirect to after successful payment
   * @returns Checkout session with redirect URL
   *
   * @example
   * ```typescript
   * const session = await solvaPay.createCheckoutSession({
   *   agentRef: 'agt_myapi',
   *   customerRef: 'user_123',
   *   planRef: 'pln_premium',
   *   returnUrl: 'https://myapp.com/success'
   * });
   *
   * // Redirect customer to checkout
   * window.location.href = session.checkoutUrl;
   * ```
   */
  createCheckoutSession(params: {
    agentRef: string
    customerRef: string
    planRef?: string
    returnUrl?: string
  }): Promise<{
    sessionId: string
    checkoutUrl: string
  }>

  /**
   * Create a customer portal session for managing purchases.
   *
   * This creates a Stripe Customer Portal session that allows customers
   * to manage their purchases, update payment methods, and view invoices.
   *
   * @param params - Customer session parameters
   * @param params.customerRef - Customer reference
   * @returns Customer portal session with redirect URL
   *
   * @example
   * ```typescript
   * const session = await solvaPay.createCustomerSession({
   *   customerRef: 'user_123'
   * });
   *
   * // Redirect customer to portal
   * window.location.href = session.customerUrl;
   * ```
   */
  createCustomerSession(params: { customerRef: string }): Promise<{
    sessionId: string
    customerUrl: string
  }>

  /**
   * Direct access to the API client for advanced operations.
   *
   * Use this for operations not exposed by the SolvaPay interface,
   * such as agent/plan management or custom API calls.
   *
   * @example
   * ```typescript
   * // Access API client directly for custom operations
   * const agents = await solvaPay.apiClient.listAgents();
   * ```
   */
  apiClient: SolvaPayClient
}

/**
 * Create a SolvaPay instance with paywall protection capabilities.
 *
 * This factory function creates a SolvaPay instance that can be used to
 * protect API endpoints, functions, and MCP tools with usage limits and
 * purchase checks.
 *
 * @param config - Optional configuration object
 * @param config.apiKey - API key for production use (defaults to `SOLVAPAY_SECRET_KEY` env var)
 * @param config.apiClient - Custom API client for testing or advanced use cases
 * @param config.apiBaseUrl - Optional API base URL override
 * @returns SolvaPay instance with payable() method and API client access
 *
 * @example
 * ```typescript
 * // Production: Use environment variable (recommended)
 * const solvaPay = createSolvaPay();
 *
 * // Production: Pass API key explicitly
 * const solvaPay = createSolvaPay({
 *   apiKey: process.env.SOLVAPAY_SECRET_KEY
 * });
 *
 * // Testing: Use mock client
 * const solvaPay = createSolvaPay({
 *   apiClient: mockClient
 * });
 *
 * // Create payable handlers for your agent
 * const payable = solvaPay.payable({
 *   agent: 'agt_myapi',
 *   plan: 'pln_premium'
 * });
 *
 * // Protect endpoints with framework-specific adapters
 * app.post('/tasks', payable.http(createTask));      // Express/Fastify
 * export const POST = payable.next(createTask);      // Next.js App Router
 * const handler = payable.mcp(createTask);           // MCP servers
 * ```
 *
 * @see {@link SolvaPay} for the returned instance interface
 * @see {@link CreateSolvaPayConfig} for configuration options
 * @since 1.0.0
 */
export function createSolvaPay(config?: CreateSolvaPayConfig): SolvaPay {
  // If no config provided, read from environment variables
  let resolvedConfig: CreateSolvaPayConfig
  if (!config) {
    const envConfig = getSolvaPayConfig()
    resolvedConfig = {
      apiKey: envConfig.apiKey,
      apiBaseUrl: envConfig.apiBaseUrl,
    }
  } else {
    resolvedConfig = config
  }

  // Create or use provided API client
  const apiClient =
    resolvedConfig.apiClient ||
    createSolvaPayClient({
      apiKey: resolvedConfig.apiKey!,
      apiBaseUrl: resolvedConfig.apiBaseUrl,
    })

  // Create paywall instance with debug flag controlled by environment variable
  const paywall = new SolvaPayPaywall(apiClient, {
    debug: process.env.SOLVAPAY_DEBUG !== 'false',
  })

  return {
    // Direct access to API client for advanced operations
    apiClient,

    // Common API methods exposed directly for convenience
    ensureCustomer(
      customerRef: string,
      externalRef?: string,
      options?: { email?: string; name?: string },
    ) {
      return paywall.ensureCustomer(customerRef, externalRef, options)
    },

    createPaymentIntent(params) {
      if (!apiClient.createPaymentIntent) {
        throw new SolvaPayError('createPaymentIntent is not available on this API client')
      }
      return apiClient.createPaymentIntent(params)
    },

    processPayment(params) {
      if (!apiClient.processPayment) {
        throw new SolvaPayError('processPayment is not available on this API client')
      }
      return apiClient.processPayment(params)
    },

    checkLimits(params) {
      return apiClient.checkLimits(params)
    },

    trackUsage(params) {
      return apiClient.trackUsage(params)
    },

    createCustomer(params) {
      if (!apiClient.createCustomer) {
        throw new SolvaPayError('createCustomer is not available on this API client')
      }
      return apiClient.createCustomer(params)
    },

    getCustomer(params) {
      return apiClient.getCustomer(params)
    },

    createCheckoutSession(params) {
      return apiClient.createCheckoutSession(params)
    },

    createCustomerSession(params) {
      return apiClient.createCustomerSession(params)
    },

    // Payable API for framework-specific handlers
    payable(options: PayableOptions = {}): PayableFunction {
      // Resolve agent name (support both agentRef and agent for backward compatibility)
      const agent =
        options.agentRef ||
        options.agent ||
        process.env.SOLVAPAY_AGENT ||
        getPackageJsonName() ||
        'default-agent'
      // Resolve plan (support both planRef and plan for backward compatibility)
      const plan = options.planRef || options.plan || agent

      const metadata = { agent, plan }

      return {
        // HTTP adapter for Express/Fastify
        http<T = any>(
          businessLogic: (args: any) => Promise<T>,
          adapterOptions?: HttpAdapterOptions,
        ) {
          const adapter = new HttpAdapter(adapterOptions)
          return async (req: any, reply: any) => {
            const handler = await createAdapterHandler(adapter, paywall, metadata, businessLogic)
            return handler([req, reply])
          }
        },

        // Next.js adapter for App Router
        next<T = any>(
          businessLogic: (args: any) => Promise<T>,
          adapterOptions?: NextAdapterOptions,
        ) {
          const adapter = new NextAdapter(adapterOptions)
          return async (request: Request, context?: any) => {
            const handler = await createAdapterHandler(adapter, paywall, metadata, businessLogic)
            return handler([request, context])
          }
        },

        // MCP adapter for Model Context Protocol
        mcp<T = any>(businessLogic: (args: any) => Promise<T>, adapterOptions?: McpAdapterOptions) {
          const adapter = new McpAdapter(adapterOptions)
          return async (args: any) => {
            const handler = await createAdapterHandler(adapter, paywall, metadata, businessLogic)
            return handler(args)
          }
        },

        // Pure function adapter for direct protection
        async function<T = any>(
          businessLogic: (args: any) => Promise<T>,
        ): Promise<(args: any) => Promise<T>> {
          const getCustomerRef = (args: any) => args.auth?.customer_ref || 'anonymous'
          return paywall.protect(businessLogic, metadata, getCustomerRef)
        },
      }
    },
  }
}

/**
 * Helper to get package name from package.json
 * Edge-safe: returns undefined in edge runtimes where process.cwd() is not available
 */
function getPackageJsonName(): string | undefined {
  try {
    // Check if we're in an edge runtime (process.cwd may not be available)
    if (typeof process === 'undefined' || typeof process.cwd !== 'function') {
      return undefined
    }
    const packageJsonPath = join(process.cwd(), 'package.json')
    const pkgContent = readFileSync(packageJsonPath, 'utf-8')
    const pkg = JSON.parse(pkgContent)
    return pkg.name
  } catch {
    return undefined
  }
}
