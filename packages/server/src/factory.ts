/**
 * SolvaPay Factory
 *
 * Main entry point for creating SolvaPay instances with the unified payable API
 */

import type {
  SolvaPayClient,
  PayableOptions,
  PaywallArgs,
  PaywallDecision,
  PaywallMetadata,
  HttpAdapterOptions,
  NextAdapterOptions,
  McpAdapterOptions,
  McpToolExtra,
  CustomerResponseMapped,
  McpBootstrapRequest,
  McpBootstrapResponse,
  ConfigureMcpPlansRequest,
  ConfigureMcpPlansResponse,
  TrackUsageRequest,
  TrackUsageResponse,
  TrackUsageBulkRequest,
  TrackUsageBulkResponse,
  AssignCreditsRequest,
  AssignCreditsResponse,
} from './types'
import { createSolvaPayClient } from './client'
import { PaywallError, SolvaPayPaywall, paywallErrorToClientPayload } from './paywall'
import { HttpAdapter, NextAdapter, McpAdapter, createAdapterHandler } from './adapters'
import { SolvaPayError, getSolvaPayConfig } from '@solvapay/core'
import { createVirtualTools } from './virtual-tools'
import type { VirtualToolsOptions, VirtualToolDefinition } from './virtual-tools'
import type { PaywallStructuredContent } from './types'
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
 * Result of `payable.gate(req, opts)` when the customer is gated.
 *
 * Carries a fully-built 402 `Response` plus the structured content for
 * callers that prefer to format their own response (alternate codecs,
 * SSE preamble, etc.).
 *
 * @since 1.2.0
 */
export interface PayablePaywallResult {
  kind: 'paywall'
  /** Pre-built 402 response with `application/json` body. */
  response: Response
  /** Same content the response carries — for callers formatting their own response. */
  content: PaywallStructuredContent
}

/**
 * Result of `payable.gate(req, opts)` when the customer is allowed.
 *
 * Includes the raw decision (limits / customerRef) and bound usage
 * trackers so the caller can record success / failure once the
 * downstream response has finalised.
 *
 * @since 1.2.0
 */
export interface PayableAllowResult {
  kind: 'allow'
  decision: Extract<import('./types').PaywallDecision<PaywallArgs>, { outcome: 'allow' }>
  customerRef: string
  /**
   * Record a successful usage event for this allowed request.
   *
   * Safe to call multiple times — each invocation is a separate
   * `trackUsage` event. This is the canonical pattern for per-step
   * metering in agent loops (AI SDK `onStepFinish`, LangChain
   * `handleLLMEnd`, OpenAI `response.completed`).
   *
   * `metadata` is forwarded verbatim. Standardise on
   * `inputTokens`, `outputTokens`, `totalTokens`, `finishReason`,
   * `stepType` so cross-provider dashboards aggregate cleanly.
   */
  trackSuccess: (opts?: { duration?: number; metadata?: Record<string, unknown> }) => void
  /**
   * Record a failed usage event for this allowed request. The error
   * is recorded on `metadata.error` (string-coerced) so dashboards can
   * filter failure modes without losing the message.
   */
  trackFail: (
    err: unknown,
    opts?: { duration?: number; metadata?: Record<string, unknown> },
  ) => void
}

/**
 * Decision-shaped result returned from `payable.gate(req, opts)`.
 *
 * @since 1.2.0
 */
export type PayableGateResult = PayablePaywallResult | PayableAllowResult

/**
 * Options for `payable.gate(req, opts)`.
 *
 * @since 1.2.0
 */
export interface PayableGateOptions {
  /**
   * Resolve the customer ref from the incoming request. Overrides the
   * default header-based lookup (`x-customer-ref` → `'anonymous'`).
   * Useful for JWT-based auth, signed cookies, or app-specific header
   * conventions.
   */
  getCustomerRef?: (req: Request) => string | Promise<string>
  /**
   * Workers `ExecutionContext` (or any object with a `waitUntil`
   * method). When provided, `trackSuccess` / `trackFail` route their
   * underlying `trackUsage` promise through `ctx.waitUntil` so the
   * Workers runtime keeps the request alive past the response close.
   * On Node, omit this — the event loop keeps the floated promise
   * alive without it.
   */
  ctx?: { waitUntil(p: Promise<unknown>): void }
  /**
   * Optional adapter metadata override. Falls back to the
   * `productRef` / `usageType` configured on `payable({ … })` when
   * omitted.
   */
  metadata?: import('./types').PaywallMetadata
}

/**
 * Payable function that provides explicit adapters for different frameworks.
 *
 * Use the appropriate adapter method for your framework:
 * - `http()` - Express.js, Fastify, and other HTTP frameworks
 * - `next()` - Next.js App Router API routes
 * - `mcp()` - Model Context Protocol servers
 * - `function()` - Pure functions, background jobs, or testing
 * - `gate()` - Decision-shaped primitive for streaming / SSE / multi-step flows
 *
 * @example
 * ```typescript
 * const payable = solvaPay.payable({ product: 'prd_myapi' });
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
 *
 * // Streaming chatbot (decision-shaped)
 * const result = await payable.gate(req);
 * if (result.kind === 'paywall') return result.response;
 * // … stream LLM output, then result.trackSuccess({ duration, metadata })
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

  /**
   * Decision-shaped primitive for streaming / SSE / multi-step flows.
   *
   * Unlike `http()` / `next()` / `mcp()` (handler-shaped — SDK runs
   * your business logic and emits the protocol response), `gate()`
   * returns the verdict and lets you own the response. This is the
   * right shape when one request maps to many response chunks (LLM
   * streams), many tool steps (agent loops), or a non-JSON wire
   * format (SSE, NDJSON, multipart).
   *
   * @example
   * ```typescript
   * const payable = solvaPay.payable({ productRef: 'prd_chat' })
   *
   * export async function handleChat(req: Request, ctx?: ExecutionContext) {
   *   const result = await payable.gate(req, { ctx })
   *   if (result.kind === 'paywall') return result.response
   *
   *   const start = Date.now()
   *   return new Response(new ReadableStream({
   *     async start(controller) {
   *       try {
   *         for await (const chunk of llmStream) controller.enqueue(encode(chunk))
   *         controller.close()
   *         result.trackSuccess({ duration: Date.now() - start })
   *       } catch (err) {
   *         result.trackFail(err, { duration: Date.now() - start })
   *         controller.error(err)
   *       }
   *     },
   *   }), { headers: { 'content-type': 'application/x-ndjson' } })
   * }
   * ```
   *
   * @since 1.2.0
   */
  gate(req: Request, options?: PayableGateOptions): Promise<PayableGateResult>
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
 * const payable = solvaPay.payable({ product: 'prd_myapi' });
 *
 * // Manage customers
 * const customerRef = await solvaPay.ensureCustomer('user_123', 'user_123', {
 *   email: 'user@example.com'
 * });
 * ```
 */
export interface SolvaPay {
  /**
   * Create a payable handler with explicit adapters for different frameworks.
   *
   * @param options - Payable options including product reference and usage type
   * @returns PayableFunction with framework-specific adapters
   *
   * @example
   * ```typescript
   * const payable = solvaPay.payable({ product: 'prd_myapi' });
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
    productRef?: string
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
   * @param params.actionType - Action type category
   * @param params.units - Number of units consumed (default 1)
   * @param params.outcome - Action outcome ('success', 'paywall', or 'fail')
   * @param params.productRef - Product reference
   * @param params.metadata - Additional metadata (e.g. tool name, endpoint)
   * @param params.duration - Action duration in milliseconds
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
  trackUsage(params: TrackUsageRequest): Promise<TrackUsageResponse>

  /**
   * Track usage events in bulk.
   */
  trackUsageBulk(params: TrackUsageBulkRequest): Promise<TrackUsageBulkResponse>

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
   * Assign credits to a customer balance.
   */
  assignCredits(params: AssignCreditsRequest): Promise<AssignCreditsResponse>

  /**
   * Get credits for a customer.
   *
   * @param params - Credits query parameters
   * @param params.customerRef - Customer reference
   * @returns Customer reference, credits, and display currency
   */
  getCustomerBalance(params: {
    customerRef: string
  }): Promise<{
    customerRef: string
    credits: number
    displayCurrency: string
    creditsPerMinorUnit: number
    displayExchangeRate: number
  }>

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
   * Decision-shaped paywall surface — exposes the kernel
   * `decide(args, metadata)` routine so streaming / SSE / multi-step
   * handlers can route gate outcomes themselves without going through
   * the handler-shaped adapters (`http` / `next` / `mcp`).
   *
   * Prefer `solvaPay.payable({...}).gate(req)` for the common case —
   * `paywall.decide()` is the lower-level primitive when you need raw
   * `PaywallArgs` access.
   *
   * @since 1.2.0
   */
  paywall: {
    decide<TArgs extends PaywallArgs>(
      args: TArgs,
      metadata?: PaywallMetadata,
      getCustomerRef?: (args: TArgs) => string,
    ): Promise<PaywallDecision<TArgs>>
  }

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
 * const payable = solvaPay.payable({ product: 'prd_myapi' });
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

    // Decision-shaped paywall surface — exposes `decide()` directly so
    // streaming / SSE / multi-step handlers can consume the kernel
    // verdict without the handler-shaped adapter envelope.
    paywall: {
      decide<TArgs extends PaywallArgs>(
        args: TArgs,
        metadata?: PaywallMetadata,
        getCustomerRef?: (args: TArgs) => string,
      ): Promise<PaywallDecision<TArgs>> {
        return paywall.decide<TArgs>(args, metadata, getCustomerRef)
      },
    },

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

    trackUsageBulk(params) {
      if (!apiClient.trackUsageBulk) {
        throw new SolvaPayError('trackUsageBulk is not available on this API client')
      }
      return apiClient.trackUsageBulk(params)
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

    assignCredits(params) {
      if (!apiClient.assignCredits) {
        throw new SolvaPayError('assignCredits is not available on this API client')
      }
      return apiClient.assignCredits(params)
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

    async registerVirtualToolsMcp(server: McpServerLike, options: RegisterVirtualToolsMcpOptions) {
      await registerVirtualToolsMcpImpl(server, apiClient, options)
    },

    // Payable API for framework-specific handlers
    payable(options: PayableOptions = {}): PayableFunction {
      const product =
        options.productRef || options.product || process.env.SOLVAPAY_PRODUCT || 'default-product'

      const usageType = options.usageType || 'requests'
      const metadata = { product, usageType }

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
            const configuredRef = options.getCustomerRef?.(
              args as unknown as Record<string, unknown>,
            )
            if (typeof configuredRef === 'string') {
              return configuredRef
            }
            return args.auth?.customer_ref || 'anonymous'
          }
          return paywall.protect(businessLogic, metadata, getCustomerRef)
        },

        async gate(req: Request, gateOptions: PayableGateOptions = {}): Promise<PayableGateResult> {
          const inputCustomerRef = await resolveCustomerRefFromRequest(req, gateOptions)
          const args: PaywallArgs = { auth: { customer_ref: inputCustomerRef } }

          const decideMetadata = gateOptions.metadata ?? metadata
          const decision = await paywall.decide(
            args,
            decideMetadata,
            (a: PaywallArgs) => a.auth?.customer_ref || 'anonymous',
          )

          if (decision.outcome === 'gate') {
            const errorMessage =
              decision.gate.kind === 'activation_required'
                ? 'Activation required'
                : 'Payment required'
            const body = paywallErrorToClientPayload(new PaywallError(errorMessage, decision.gate))
            const response = new Response(JSON.stringify(body), {
              status: 402,
              headers: { 'content-type': 'application/json' },
            })
            return { kind: 'paywall', response, content: decision.gate }
          }

          const productRef = decideMetadata.product || metadata.product || product
          const meterName = decision.limits.meterName || decideMetadata.usageType || 'requests'
          const customerRef = decision.customerRef
          const ctx = gateOptions.ctx

          const keepAlive = (p: Promise<unknown>) => {
            const guarded = p.catch(() => undefined)
            if (ctx) {
              ctx.waitUntil(guarded)
            } else {
              void guarded
            }
          }

          const trackOnce = (
            outcome: 'success' | 'fail',
            opts?: { duration?: number; metadata?: Record<string, unknown>; error?: unknown },
          ) => {
            const requestId = `gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            const errMeta =
              opts?.error !== undefined
                ? {
                    error: opts.error instanceof Error ? opts.error.message : String(opts.error),
                  }
                : {}
            const trackPromise = apiClient.trackUsage({
              customerRef,
              productRef,
              actionType: 'api_call',
              units: 1,
              outcome,
              ...(opts?.duration !== undefined ? { duration: opts.duration } : {}),
              metadata: {
                action: meterName,
                requestId,
                ...errMeta,
                ...(opts?.metadata ?? {}),
              },
              timestamp: new Date().toISOString(),
            })
            keepAlive(trackPromise)
          }

          return {
            kind: 'allow',
            decision,
            customerRef,
            trackSuccess: opts => trackOnce('success', opts),
            trackFail: (err, opts) => trackOnce('fail', { ...opts, error: err }),
          }
        },
      }
    },
  }
}

/**
 * Resolve the customer ref for a `payable.gate(req)` call.
 * Precedence: `options.getCustomerRef(req)` → `x-customer-ref` header
 * → `'anonymous'`. Trims whitespace and treats empty strings as
 * absent so a stray empty header doesn't masquerade as a real ref.
 */
async function resolveCustomerRefFromRequest(
  req: Request,
  options: PayableGateOptions,
): Promise<string> {
  if (options.getCustomerRef) {
    const resolved = await options.getCustomerRef(req)
    if (typeof resolved === 'string' && resolved.trim().length > 0) {
      return resolved.trim()
    }
  }
  const header = req.headers.get('x-customer-ref')
  if (header && header.trim().length > 0) return header.trim()
  return 'anonymous'
}
