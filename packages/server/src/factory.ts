/**
 * SolvaPay Factory
 *
 * Main entry point for creating SolvaPay instances with the unified payable API
 */

import type {
  SolvaPayClient,
  PayableOptions,
  PaywallArgs,
  HttpAdapterOptions,
  NextAdapterOptions,
  McpAdapterOptions,
  McpToolExtra,
  CustomerResponseMapped,
  McpBootstrapRequest,
  McpBootstrapResponse,
  ConfigureMcpPlansRequest,
  ConfigureMcpPlansResponse,
} from './types'
import { createSolvaPayClient } from './client'
import { SolvaPayPaywall } from './paywall'
import { HttpAdapter, NextAdapter, McpAdapter, createAdapterHandler } from './adapters'
import { SolvaPayError, getSolvaPayConfig } from '@solvapay/core'
import { createVirtualTools } from './virtual-tools'
import type { VirtualToolsOptions, VirtualToolDefinition } from './virtual-tools'
import {
  registerVirtualToolsMcpImpl,
  type McpServerLike,
  type RegisterVirtualToolsMcpOptions,
} from './register-virtual-tools-mcp'

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

  /**
   * TTL in ms for the checkLimits cache (default 10 000).
   * Positive results are cached and optimistically decremented to avoid
   * redundant API calls during tool-call bursts.
   */
  limitsCacheTTL?: number
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
 * const payable = solvaPay.payable({ product: 'prd_myapi', plan: 'pln_premium' });
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  http<T = any>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    businessLogic: (args: any) => Promise<T>,
    options?: HttpAdapterOptions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): (req: any, reply: any) => Promise<unknown>

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  next<T = any>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    businessLogic: (args: any) => Promise<T>,
    options?: NextAdapterOptions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mcp<T = any>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    businessLogic: (args: any) => Promise<T>,
    options?: McpAdapterOptions,
  ): (args: Record<string, unknown>, extra?: McpToolExtra) => Promise<unknown>

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function<T = any>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    businessLogic: (args: any) => Promise<T>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<(args: any) => Promise<T>>
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
   * const payable = solvaPay.payable({ product: 'prd_myapi', plan: 'pln_premium' });
   *
   * // Manage customers
   * const customerRef = await solvaPay.ensureCustomer('user_123', 'user_123', {
   *   email: 'user@example.com'
   * });
   *
   * // Create payment intents
   * const intent = await solvaPay.createPaymentIntent({
   *   productRef: 'prd_myapi',
   *   planRef: 'pln_premium',
   *   customerRef: 'user_123'
   * });
 * ```
 */
export interface SolvaPay {
  /**
   * Create a payable handler with explicit adapters for different frameworks.
   *
   * @param options - Payable options including product and plan references
   * @returns PayableFunction with framework-specific adapters
   *
   * @example
   * ```typescript
   * const payable = solvaPay.payable({
   *   product: 'prd_myapi',
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
   * Create a payment intent for a customer to purchase a plan.
   *
   * This creates a payment intent that can be confirmed on the client side.
   * After confirmation, call `processPaymentIntent()` to complete the purchase.
   *
   * @param params - Payment intent parameters
   * @param params.productRef - Product reference
   * @param params.planRef - Plan reference to purchase
   * @param params.customerRef - Customer reference
   * @param params.idempotencyKey - Optional idempotency key for retry safety
   * @returns Payment intent with client secret and publishable key
   *
   * @example
   * ```typescript
   * const intent = await solvaPay.createPaymentIntent({
   *   productRef: 'prd_myapi',
   *   planRef: 'pln_premium',
   *   customerRef: 'user_123',
   *   idempotencyKey: 'unique-key-123'
   * });
   *
   * // Use intent.clientSecret on the client to confirm payment
   * ```
   */
  createPaymentIntent(params: {
    productRef: string
    planRef: string
    customerRef: string
    idempotencyKey?: string
  }): Promise<{
    processorPaymentId: string
    clientSecret: string
    publishableKey: string
    accountId?: string
  }>

  /**
   * Create a payment intent for a credit top-up.
   *
   * Unlike `createPaymentIntent`, this does not require a product or plan.
   * Credits are recorded via webhook after payment confirmation — no
   * `processPaymentIntent` call is needed.
   */
  createTopupPaymentIntent(params: {
    customerRef: string
    amount: number
    currency: string
    description?: string
    idempotencyKey?: string
  }): Promise<{
    processorPaymentId: string
    clientSecret: string
    publishableKey: string
    accountId?: string
  }>

  /**
   * Process a payment intent after client-side payment confirmation.
   *
   * Creates the purchase immediately, eliminating webhook delay.
   * Call this after the client has confirmed the payment intent.
   *
   * @param params - Payment processing parameters
   * @param params.paymentIntentId - Processor payment ID from client confirmation
   * @param params.productRef - Product reference
   * @param params.customerRef - Customer reference
   * @param params.planRef - Optional plan reference (if not in payment intent)
   * @returns Payment processing result with purchase details
   *
   * @example
   * ```typescript
   * // After client confirms payment
   * const result = await solvaPay.processPaymentIntent({
   *   paymentIntentId: 'pi_1234567890',
   *   productRef: 'prd_myapi',
   *   customerRef: 'user_123',
   *   planRef: 'pln_premium'
   * });
   *
   * if (result.success) {
   *   console.log('Purchase created:', result.purchase);
   * }
   * ```
   */
  processPaymentIntent(params: {
    paymentIntentId: string
    productRef: string
    customerRef: string
    planRef?: string
  }): Promise<import('./types/client').ProcessPaymentResult>

  /**
   * Check if customer is within usage limits for a product.
   *
   * This method checks purchase status and usage limits without
   * executing business logic. Use `payable()` for automatic protection.
   *
   * @param params - Limit check parameters
   * @param params.customerRef - Customer reference
   * @param params.productRef - Product reference
   * @returns Limit check result with remaining usage and checkout URL if needed
   *
   * @example
   * ```typescript
   * const limits = await solvaPay.checkLimits({
   *   customerRef: 'user_123',
   *   productRef: 'prd_myapi',
   *   planRef: 'pln_premium'
   * });
   *
   * if (!limits.withinLimits) {
   *   // Redirect to checkout
   *   window.location.href = limits.checkoutUrl;
   * }
   * ```
   */
  checkLimits(params: {
    customerRef: string
    productRef: string
    planRef?: string
    meterName?: string
    usageType?: string
  }): Promise<{
    withinLimits: boolean
    remaining: number
    plan: string
    checkoutUrl?: string
    meterName?: string
    creditBalance?: number
    creditsPerUnit?: number
    currency?: string
  }>

  /**
   * Track usage for a customer action.
   *
   * This is automatically called by the paywall system. You typically
   * don't need to call this manually unless implementing custom tracking.
   *
   * @param params - Usage tracking parameters
   * @param params.customerRef - Customer reference
   * @param params.productRef - Product reference
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
   *   customerRef: 'cus_3C4D5E6F',
   *   actionType: 'api_call',
   *   units: 1,
   *   outcome: 'success',
   *   metadata: { toolName: 'search', endpoint: '/search' },
   * });
   * ```
   */
  trackUsage(params: {
    customerRef: string
    actionType?: 'transaction' | 'api_call' | 'hour' | 'email' | 'storage' | 'custom'
    units?: number
    outcome?: 'success' | 'paywall' | 'fail'
    productRef?: string
    purchaseRef?: string
    description?: string
    metadata?: Record<string, unknown>
    duration?: number
    timestamp?: string
    idempotencyKey?: string
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
  createCustomer(params: {
    email: string
    name?: string
    metadata?: Record<string, unknown>
  }): Promise<{ customerRef: string }>

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
   * Get credits for a customer.
   *
   * @param params - Credits query parameters
   * @param params.customerRef - Customer reference
   * @returns Customer reference, credits, and display currency
   */
  getCustomerBalance(params: {
    customerRef: string
  }): Promise<{ customerRef: string; credits: number; displayCurrency: string; creditsPerMinorUnit: number }>

  /**
   * Create a hosted checkout session for a customer.
   *
   * This creates a checkout session that redirects the customer
   * to a hosted payment page. After payment, the customer is redirected back.
   *
   * @param params - Checkout session parameters
   * @param params.productRef - Product reference
   * @param params.customerRef - Customer reference
   * @param params.planRef - Optional plan reference (if not specified, shows plan selector)
   * @param params.returnUrl - URL to redirect to after successful payment
   * @returns Checkout session with redirect URL
   *
   * @example
   * ```typescript
   * const session = await solvaPay.createCheckoutSession({
   *   productRef: 'prd_myapi',
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
    productRef: string
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
   * This creates a customer portal session that allows customers
   * to manage their purchases, update payment methods, and view invoices.
   *
   * @param params - Customer session parameters
   * @param params.customerRef - Customer reference
   * @param params.productRef - Optional product reference for scoping portal view
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
  createCustomerSession(params: { customerRef: string; productRef?: string }): Promise<{
    sessionId: string
    customerUrl: string
  }>

  /**
   * Activate a plan for a customer (usage-based / free plans that don't require payment).
   *
   * Returns the activation result indicating whether the plan was activated,
   * is already active, requires a credit top-up, or requires payment.
   */
  activatePlan(params: {
    customerRef: string
    productRef: string
    planRef: string
  }): Promise<import('./types/client').ActivatePlanResult>

  /**
   * Bootstrap an MCP-enabled product with plans and tool mappings.
   *
   * This helper wraps the backend orchestration endpoint and is intended for
   * fast setup flows where you want one call for product + plans + MCP config.
   */
  bootstrapMcpProduct(params: McpBootstrapRequest): Promise<McpBootstrapResponse>

  /**
   * Configure MCP plans and tool mappings for an existing MCP product.
   *
   * This helper wraps the backend MCP plans endpoint and supports adding/removing
   * paid plans as well as remapping tool access.
   */
  configureMcpPlans(
    productRef: string,
    params: ConfigureMcpPlansRequest,
  ): Promise<ConfigureMcpPlansResponse>

  /**
   * Get virtual tool definitions with bound handlers for MCP server integration.
   *
   * Returns an array of tool objects (name, description, inputSchema, handler)
   * that provide self-service capabilities: user info, upgrade, and account management.
   * These tools bypass the paywall and are not usage-tracked.
   *
   * Register the returned tools on your MCP server alongside your own tools.
   *
   * @param options - Virtual tools configuration
   * @param options.product - Product reference (required)
   * @param options.getCustomerRef - Function to extract customer ref from tool args
   * @param options.exclude - Optional list of tool names to exclude
   * @returns Array of virtual tool definitions with handlers
   *
   * @example
   * ```typescript
   * const virtualTools = solvaPay.getVirtualTools({
   *   product: 'prd_myapi',
   *   getCustomerRef: (_args, extra) => String(extra?.authInfo?.extra?.customer_ref || 'anonymous'),
   * });
   *
   * // Register on your MCP server
   * for (const tool of virtualTools) {
   *   // Add to tools/list and tools/call handlers
   * }
   * ```
   */
  getVirtualTools(options: VirtualToolsOptions): VirtualToolDefinition[]

  /**
   * Register virtual tools directly on an MCP server with one call.
   *
   * This helper converts virtual tool JSON schemas to Zod schemas and registers
   * each tool on an MCP server that supports `registerTool()`.
   */
  registerVirtualToolsMcp(
    server: McpServerLike,
    options: RegisterVirtualToolsMcpOptions,
  ): Promise<void>

  /**
   * Direct access to the API client for advanced operations.
   *
   * Use this for operations not exposed by the SolvaPay interface,
   * such as product/plan management or custom API calls.
   *
   * @example
   * ```typescript
   * // Access API client directly for custom operations
   * const products = await solvaPay.apiClient.listProducts();
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
 * // Create payable handlers for your product
 * const payable = solvaPay.payable({
 *   product: 'prd_myapi',
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
    limitsCacheTTL: resolvedConfig.limitsCacheTTL,
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

    createTopupPaymentIntent(params) {
      if (!apiClient.createTopupPaymentIntent) {
        throw new SolvaPayError('createTopupPaymentIntent is not available on this API client')
      }
      return apiClient.createTopupPaymentIntent(params)
    },

    processPaymentIntent(params) {
      if (!apiClient.processPaymentIntent) {
        throw new SolvaPayError('processPaymentIntent is not available on this API client')
      }
      return apiClient.processPaymentIntent(params)
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
      return apiClient.createCustomer({ ...params, metadata: params.metadata ?? {} })
    },

    getCustomer(params) {
      return apiClient.getCustomer(params)
    },

    getCustomerBalance(params) {
      if (!apiClient.getCustomerBalance) {
        throw new SolvaPayError('getCustomerBalance is not available on this API client')
      }
      return apiClient.getCustomerBalance(params)
    },

    createCheckoutSession(params) {
      return apiClient.createCheckoutSession({
        customerRef: params.customerRef,
        productRef: params.productRef,
        planRef: params.planRef,
      })
    },

    createCustomerSession(params) {
      return apiClient.createCustomerSession(params)
    },

    activatePlan(params) {
      if (!apiClient.activatePlan) {
        throw new SolvaPayError('activatePlan is not available on this API client')
      }
      return apiClient.activatePlan(params)
    },

    bootstrapMcpProduct(params) {
      if (!apiClient.bootstrapMcpProduct) {
        throw new SolvaPayError('bootstrapMcpProduct is not available on this API client')
      }
      return apiClient.bootstrapMcpProduct(params)
    },

    configureMcpPlans(productRef, params) {
      if (!apiClient.configureMcpPlans) {
        throw new SolvaPayError('configureMcpPlans is not available on this API client')
      }
      return apiClient.configureMcpPlans(productRef, params)
    },

    getVirtualTools(options: VirtualToolsOptions) {
      return createVirtualTools(apiClient, options)
    },

    async registerVirtualToolsMcp(
      server: McpServerLike,
      options: RegisterVirtualToolsMcpOptions,
    ) {
      await registerVirtualToolsMcpImpl(server, apiClient, options)
    },

    // Payable API for framework-specific handlers
    payable(options: PayableOptions = {}): PayableFunction {
      // Resolve product name (support both productRef and product)
      const product =
        options.productRef ||
        options.product ||
        process.env.SOLVAPAY_PRODUCT ||
        'default-product'
      // Resolve plan (support both planRef and plan)
      const plan = options.planRef || options.plan

      const usageType = options.usageType || 'requests'
      const metadata = { product, plan, usageType }

      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        http<T = any>(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          businessLogic: (args: any) => Promise<T>,
          adapterOptions?: HttpAdapterOptions,
        ) {
          const adapter = new HttpAdapter({
            ...adapterOptions,
            getCustomerRef: adapterOptions?.getCustomerRef || options.getCustomerRef,
          })
          const handlerPromise = createAdapterHandler(adapter, paywall, metadata, businessLogic)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return async (req: any, reply: any) => {
            const handler = await handlerPromise
            return handler([req, reply])
          }
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        next<T = any>(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          businessLogic: (args: any) => Promise<T>,
          adapterOptions?: NextAdapterOptions,
        ) {
          const adapter = new NextAdapter({
            ...adapterOptions,
            getCustomerRef: adapterOptions?.getCustomerRef || options.getCustomerRef,
          })
          const handlerPromise = createAdapterHandler(adapter, paywall, metadata, businessLogic)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return async (request: Request, context?: any) => {
            const handler = await handlerPromise
            return handler([request, context])
          }
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mcp<T = any>(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          businessLogic: (args: any) => Promise<T>,
          adapterOptions?: McpAdapterOptions,
        ) {
          const adapter = new McpAdapter({
            ...adapterOptions,
            getCustomerRef: adapterOptions?.getCustomerRef || options.getCustomerRef,
          })
          const handlerPromise = createAdapterHandler(adapter, paywall, metadata, businessLogic)
          return async (args: Record<string, unknown>, extra?: McpToolExtra) => {
            const handler = await handlerPromise
            return handler(args, extra)
          }
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async function<T = any>(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          businessLogic: (args: any) => Promise<T>,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ): Promise<(args: any) => Promise<T>> {
          const getCustomerRef = (args: PaywallArgs): string => {
            const configuredRef = options.getCustomerRef?.(args as unknown as Record<string, unknown>)
            if (typeof configuredRef === 'string') {
              return configuredRef
            }
            return args.auth?.customer_ref || 'anonymous'
          }
          return paywall.protect(businessLogic, metadata, getCustomerRef)
        },
      }
    },
  }
}
