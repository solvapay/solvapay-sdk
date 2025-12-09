/**
 * SolvaPay SDK - Universal Paywall Protection
 *
 * One API that works everywhere:
 * - HTTP frameworks (Fastify, Express)
 * - MCP servers
 * - Class-based and functional programming
 */

import type {
  PaywallArgs,
  PaywallMetadata,
  PaywallStructuredContent,
  PaywallToolResult,
  SolvaPayClient,
} from './types'
import { withRetry, createRequestDeduplicator } from './utils'
import { readFileSync } from 'fs'
import { join } from 'path'

// Re-export types for convenience
export type {
  PaywallArgs,
  PaywallMetadata,
  PaywallStructuredContent,
  PaywallToolResult,
  SolvaPayClient,
}

/**
 * Error thrown when a paywall is triggered (subscription required or usage limit exceeded).
 *
 * This error is automatically thrown by the paywall protection system when:
 * - Customer doesn't have required subscription
 * - Customer has exceeded usage limits
 * - Customer needs to upgrade their plan
 *
 * The error includes structured content with checkout URLs and metadata for
 * building custom paywall UIs.
 *
 * @example
 * ```typescript
 * import { PaywallError } from '@solvapay/server';
 *
 * try {
 *   const result = await payable.http(createTask)(req, res);
 *   return result;
 * } catch (error) {
 *   if (error instanceof PaywallError) {
 *     // Custom paywall handling
 *     return res.status(402).json({
 *       error: error.message,
 *       checkoutUrl: error.structuredContent.checkoutUrl,
 *       // Additional metadata available in error.structuredContent
 *     });
 *   }
 *   throw error;
 * }
 * ```
 *
 * @see {@link PaywallStructuredContent} for the structured content format
 * @since 1.0.0
 */
export class PaywallError extends Error {
  /**
   * Creates a new PaywallError instance.
   *
   * @param message - Error message
   * @param structuredContent - Structured content with checkout URLs and metadata
   */
  constructor(
    message: string,
    public structuredContent: PaywallStructuredContent,
  ) {
    super(message)
    this.name = 'PaywallError'
  }
}

/**
 * Shared customer lookup deduplicator across all SolvaPay instances
 *
 * This prevents duplicate customer lookups when multiple SolvaPay instances
 * are created in the same process (e.g., in different API routes).
 *
 * Features:
 * - Deduplicates concurrent requests (multiple requests share the same promise)
 * - Caches results for 60 seconds (prevents duplicate sequential requests)
 * - Automatic cleanup of expired cache entries
 * - Memory-safe with max cache size
 */
const sharedCustomerLookupDeduplicator = createRequestDeduplicator<string>({
  cacheTTL: 60000, // Cache results for 60 seconds (reduces API calls significantly)
  maxCacheSize: 1000, // Maximum cache entries
  cacheErrors: false, // Don't cache errors - retry on next request
})

/**
 * Universal SolvaPay Protection - One API for everything
 */
export class SolvaPayPaywall {
  private customerCreationAttempts = new Set<string>()
  private customerRefMapping = new Map<string, string>() // input ref -> backend ref
  private debug: boolean

  constructor(
    private apiClient: SolvaPayClient,
    options: { debug?: boolean } = {},
  ) {
    this.debug = options.debug ?? process.env.SOLVAPAY_DEBUG === 'true'
  }

  private log(...args: any[]): void {
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log(...args)
    }
  }

  private resolveAgent(metadata: PaywallMetadata): string {
    return (
      metadata.agent || process.env.SOLVAPAY_AGENT || this.getPackageJsonName() || 'default-agent'
    )
  }

  private getPackageJsonName(): string | undefined {
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

  private generateRequestId(): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 11)
    return `solvapay_${timestamp}_${random}`
  }

  /**
   * Core protection method - works for both MCP and HTTP
   */
  async protect<TArgs extends PaywallArgs, TResult = any>(
    handler: (args: TArgs) => Promise<TResult>,
    metadata: PaywallMetadata = {},
    getCustomerRef?: (args: TArgs) => string,
  ): Promise<(args: TArgs) => Promise<TResult>> {
    const agent = this.resolveAgent(metadata)
    const toolName = handler.name || 'anonymous'

    return async (args: TArgs): Promise<TResult> => {
      const startTime = Date.now()
      const requestId = this.generateRequestId()
      const inputCustomerRef = getCustomerRef
        ? getCustomerRef(args)
        : args.auth?.customer_ref || 'anonymous'

      // Auto-create customer if needed and get the backend reference
      // Pass inputCustomerRef as both customerRef (cache key) and externalRef (for backend lookup)
      let backendCustomerRef: string

      // If the input ref is already a SolvaPay customer ID (starts with 'cus_'), 
      // use it directly without attempting lookup/creation by externalRef.
      if (inputCustomerRef.startsWith('cus_')) {
        backendCustomerRef = inputCustomerRef
      } else {
        // Auto-create customer if needed and get the backend reference
        // Pass inputCustomerRef as both customerRef (cache key) and externalRef (for backend lookup)
        backendCustomerRef = await this.ensureCustomer(inputCustomerRef, inputCustomerRef)
      }

      try {
        // Check limits with backend using the backend customer reference
        const planRef = metadata.plan || toolName

        const limitsCheck = await this.apiClient.checkLimits({
          customerRef: backendCustomerRef,
          agentRef: agent,
        })

        if (!limitsCheck.withinLimits) {
          const latencyMs = Date.now() - startTime
          await this.trackUsage(
            backendCustomerRef,
            agent,
            planRef,
            toolName,
            'paywall',
            requestId,
            latencyMs,
          )

          throw new PaywallError('Payment required', {
            kind: 'payment_required',
            agent,
            checkoutUrl: limitsCheck.checkoutUrl || '',
            message: `Plan subscription required. Remaining: ${limitsCheck.remaining}`,
          })
        }

        // Execute the protected handler
        const result = await handler(args)

        // Track successful usage
        const latencyMs = Date.now() - startTime
        await this.trackUsage(
          backendCustomerRef,
          agent,
          planRef,
          toolName,
          'success',
          requestId,
          latencyMs,
        )

        return result
      } catch (error) {
        // Log error details for debugging, but format it clearly without full stack traces
        if (error instanceof Error) {
          const errorType = error instanceof PaywallError ? 'PaywallError' : 'API Error'
          this.log(`❌ Error in paywall [${errorType}]: ${error.message}`)
        } else {
          this.log(`❌ Error in paywall:`, error)
        }
        const latencyMs = Date.now() - startTime
        const outcome = error instanceof PaywallError ? 'paywall' : 'fail'
        const planRef = metadata.plan || toolName
        await this.trackUsage(
          backendCustomerRef,
          agent,
          planRef,
          toolName,
          outcome,
          requestId,
          latencyMs,
        )
        throw error
      }
    }
  }

  /**
   * Ensures a customer exists in the backend, creating them if necessary.
   * This is a public helper for testing, pre-creating customers, and internal use.
   * Only attempts creation once per customer (idempotent).
   * Returns the backend customer reference to use in API calls.
   *
   * @param customerRef - The customer reference used as a cache key (e.g., Supabase user ID)
   * @param externalRef - Optional external reference for backend lookup (e.g., Supabase user ID)
   *   If provided, will lookup existing customer by externalRef before creating new one.
   *   The externalRef is stored on the SolvaPay backend for customer lookup.
   * @param options - Optional customer details (email, name) for customer creation
   */
  async ensureCustomer(
    customerRef: string,
    externalRef?: string,
    options?: { email?: string; name?: string },
  ): Promise<string> {
    // Return cached mapping if exists (per-instance cache)
    if (this.customerRefMapping.has(customerRef)) {
      return this.customerRefMapping.get(customerRef)!
    }

    // Skip for anonymous users
    if (customerRef === 'anonymous') {
      return customerRef
    }

    // If customerRef is already a SolvaPay ID (starts with 'cus_'),
    // return it directly. We cannot "ensure" (create) a customer with a specific ID,
    // and using it as an externalRef causes issues.
    if (customerRef.startsWith('cus_')) {
      return customerRef
    }

    // Use shared deduplicator to prevent duplicate lookups across all instances
    // This is especially important when multiple routes call ensureCustomer concurrently
    const cacheKey = externalRef || customerRef

    // Check if we have a cached result in per-instance cache first (fast path)
    if (this.customerRefMapping.has(customerRef)) {
      const cached = this.customerRefMapping.get(customerRef)!
      return cached
    }

    // Use shared deduplicator (handles both concurrent requests and cache)
    const backendRef = await sharedCustomerLookupDeduplicator.deduplicate(cacheKey, async () => {
      // If externalRef is provided, try to lookup existing customer first
      if (externalRef) {
        try {
          const existingCustomer = await this.apiClient.getCustomer({ externalRef })

          if (existingCustomer && existingCustomer.customerRef) {
            const ref = existingCustomer.customerRef

            // Store the mapping for future use (per-instance cache)
            this.customerRefMapping.set(customerRef, ref)

            // Also track that we've attempted creation for this externalRef to prevent duplicates
            this.customerCreationAttempts.add(customerRef)
            if (externalRef !== customerRef) {
              this.customerCreationAttempts.add(externalRef)
            }

            return ref
          }
        } catch (error) {
          // 404 means customer doesn't exist yet - this is expected, continue to creation
          const errorMessage = error instanceof Error ? error.message : String(error)
          if (!errorMessage.includes('404') && !errorMessage.includes('not found')) {
            // Unexpected error - log but continue to fallback behavior
            this.log(`⚠️  Error looking up customer by externalRef: ${errorMessage}`)
          }
        }
      }

      // If already attempted but no mapping, use original ref
      // Check both customerRef and externalRef to prevent duplicates
      if (
        this.customerCreationAttempts.has(customerRef) ||
        (externalRef && this.customerCreationAttempts.has(externalRef))
      ) {
        // If we have a mapping, use it; otherwise return the original ref
        const mappedRef = this.customerRefMapping.get(customerRef)
        return mappedRef || customerRef
      }

      // Skip if createCustomer is not available
      if (!this.apiClient.createCustomer) {
         
        console.warn(
          `⚠️  Cannot auto-create customer ${customerRef}: createCustomer method not available on API client`,
        )
        return customerRef
      }

      this.customerCreationAttempts.add(customerRef)

      try {
        // Prepare customer creation params
        // Use provided email/name, or fallback to auto-generated values
        // Use a timestamp-based email to avoid conflicts with old orphaned records
        const createParams: any = {
          email: options?.email || `${customerRef}-${Date.now()}@auto-created.local`,
        }

        // Only include name if explicitly provided (don't fallback to customerRef)
        // This prevents externalRef from being used as the name when both are the same value
        if (options?.name) {
          createParams.name = options.name
        }

        // Include externalRef if provided
        if (externalRef) {
          createParams.externalRef = externalRef
        }

        const result = await this.apiClient.createCustomer(createParams)

        // Extract the backend reference from the response
        const ref = (result as any).customerRef || (result as any).reference || customerRef

        // Store the mapping (per-instance cache)
        this.customerRefMapping.set(customerRef, ref)

        return ref
      } catch (error: any) {
        // Handle existing customer conflict (409)
        // If customer already exists, we should try to fetch it to get the correct backend ID
        if (error.message && (error.message.includes('409') || error.message.includes('already exists'))) {
           // Try to lookup by externalRef first if available
           if (externalRef) {
             try {
               const searchResult = await this.apiClient.getCustomer({ externalRef })
               if (searchResult && searchResult.customerRef) {
                 this.customerRefMapping.set(customerRef, searchResult.customerRef)
                 return searchResult.customerRef
               }
             } catch (lookupError: any) {
               // Fallback to original behavior if lookup fails
               this.log(`⚠️ Failed to lookup existing customer by externalRef after 409:`, lookupError instanceof Error ? lookupError.message : lookupError)
             }
           }
        }

        this.log(
          `❌ Failed to auto-create customer ${customerRef}:`,
          error instanceof Error ? error.message : error,
        )
        // Continue anyway - use the original ref
        return customerRef
      }
    })

    // Store the mapping in per-instance cache for faster subsequent lookups
    if (backendRef !== customerRef) {
      this.customerRefMapping.set(customerRef, backendRef)
    }

    return backendRef
  }

  async trackUsage(
    customerRef: string,
    agentRef: string,
    planRef: string,
    toolName: string,
    outcome: 'success' | 'paywall' | 'fail',
    requestId: string,
    actionDuration: number,
  ): Promise<void> {
    // TODO: review if we should use withRetry for all API calls
    await withRetry(
      () =>
        this.apiClient.trackUsage({
          customerRef,
          agentRef,
          planRef,
          outcome,
          action: toolName,
          requestId,
          actionDuration,
          timestamp: new Date().toISOString(),
        }),
      {
        maxRetries: 2,
        initialDelay: 500,
        shouldRetry: error => error.message.includes('Customer not found'), // TODO: review if this is needed and what to check for
        onRetry: (error, attempt) => {
           
          console.warn(`⚠️  Customer not found (attempt ${attempt + 1}/3), retrying in 500ms...`)
        },
      },
    ).catch(error => {
       
      console.error('Usage tracking failed:', error)
      // Don't throw - tracking is not critical
    })
  }
}

/**
 * Universal SolvaPay factory - One API for MCP and HTTP
 */
export function createPaywall(config: { apiClient: SolvaPayClient }) {
  const paywall = new SolvaPayPaywall(config.apiClient)

  // Functional approach - works for both MCP and HTTP
  function protect<TArgs extends PaywallArgs, TResult = any>(metadata: PaywallMetadata = {}) {
    return function (handler: (args: TArgs) => Promise<TResult>) {
      return paywall.protect(handler, metadata)
    }
  }

  // Class-based decorator
  function Paywall(metadata: PaywallMetadata = {}) {
    return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
      // Handle both descriptor and direct property assignment
      const method = descriptor?.value || target[propertyKey]

      if (typeof method !== 'function') {
        throw new Error('@Paywall decorator can only be applied to methods')
      }

      // Store metadata on the method
      method._paywallMetadata = metadata

      if (descriptor) {
        // Standard method decorator
        descriptor.value = method
        return descriptor
      } else {
        // Legacy decorator or direct property
        target[propertyKey] = method
        return target
      }
    }
  }

  // HTTP framework integration
  function createHttpHandler(
    methodOrMetadata: ((...args: any[]) => any) | PaywallMetadata,
    handlerOrOptions?:
      | ((args: any) => Promise<any>)
      | {
          extractArgs?: (req: any) => any
          transformResponse?: (result: any, reply: any) => any
          getCustomerRef?: (req: any) => string
        },
  ) {
    // Handle decorated method
    if (typeof methodOrMetadata === 'function') {
      const method = methodOrMetadata
      const metadata = (method as any)._paywallMetadata as PaywallMetadata
      const options = handlerOrOptions as any

      if (!metadata) {
        throw new Error('Method must be decorated with @Paywall')
      }

      return async (req: any, reply: any) => {
        try {
          const extractArgs = options?.extractArgs || defaultExtractArgs
          const getCustomerRef =
            options?.getCustomerRef || ((req: any) => req.auth?.customer_ref || 'anonymous')

          const args = extractArgs(req)
          const protectedMethod = await paywall.protect(method as any, metadata, getCustomerRef)
          const result = await protectedMethod(args)

          const transformResponse = options?.transformResponse || ((result: any) => result)
          return transformResponse(result, reply)
        } catch (error) {
          return handleHttpError(error, reply)
        }
      }
    }

    // Handle inline metadata + handler
    const metadata = methodOrMetadata
    const handler = handlerOrOptions as (args: any) => Promise<any>

    return async (req: any, reply: any) => {
      try {
        const args = defaultExtractArgs(req)
        const getCustomerRef = (args: any) => args.auth?.customer_ref || 'anonymous'

        const protectedHandler = await paywall.protect(handler, metadata, getCustomerRef)
        const result = await protectedHandler(args)

        // Handle Express response (has res.status) vs Fastify (has reply.code)
        if (reply && reply.status && typeof reply.json === 'function') {
          // Express: call res.json() and don't return a value
          reply.json(result)
          return
        }

        // Fastify: return the result for auto-serialization
        return result
      } catch (error) {
        return handleHttpError(error, reply)
      }
    }
  }

  // MCP integration
  function createMCPHandler(
    methodOrMetadata: ((...args: any[]) => any) | PaywallMetadata,
    handler?: (args: any) => Promise<any>,
  ) {
    // Handle decorated method
    if (typeof methodOrMetadata === 'function') {
      const method = methodOrMetadata
      const metadata = (method as any)._paywallMetadata as PaywallMetadata

      if (!metadata) {
        throw new Error('Method must be decorated with @Paywall')
      }

      const getCustomerRef = (args: any) => args.auth?.customer_ref || 'anonymous'
      return paywall.protect(method as any, metadata, getCustomerRef)
    }

    // Handle inline metadata + handler
    const metadata = methodOrMetadata
    const getCustomerRef = (args: any) => args.auth?.customer_ref || 'anonymous'
    return paywall.protect(handler!, metadata, getCustomerRef)
  }

  // Next.js API route integration
  function createNextHandler(
    metadata: PaywallMetadata,
    handler: (args: any) => Promise<any>,
    options?: {
      extractArgs?: (request: Request, context?: any) => Promise<any> | any
      getCustomerRef?: (request: Request) => Promise<string> | string
      transformResponse?: (result: any) => any
    },
  ) {
    return async (request: Request, context?: any) => {
      try {
        const extractArgs = options?.extractArgs || defaultExtractNextArgs
        const getCustomerRef = options?.getCustomerRef || defaultGetCustomerRef
        const transformResponse = options?.transformResponse || ((result: any) => result)

        const args = await extractArgs(request, context)
        const customerRef = await getCustomerRef(request)

        // Add auth info to args
        args.auth = { customer_ref: customerRef }

        const protectedHandler = await paywall.protect(
          handler,
          metadata,
          (args: any) => args.auth.customer_ref,
        )
        const result = await protectedHandler(args)

        const transformedResult = transformResponse(result)
        return new Response(JSON.stringify(transformedResult), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return handleNextError(error)
      }
    }
  }

  return {
    protect, // Function wrapper
    Paywall, // Class decorator
    createHttpHandler,
    createMCPHandler,
    createNextHandler, // Next.js API routes
    ensureCustomer: (customerRef: string) => paywall.ensureCustomer(customerRef), // Customer creation helper
    paywall, // Low-level access
  }
}

// Helper functions
function defaultExtractArgs(req: any): any {
  return {
    ...((req.body as object) || {}),
    ...((req.params as object) || {}),
    ...((req.query as object) || {}),
    auth: { customer_ref: req.headers?.['x-customer-ref'] || req.auth?.customer_ref },
  }
}

function handleHttpError(error: any, reply: any) {
  if (error instanceof PaywallError) {
    const errorResponse = {
      success: false,
      error: 'Payment required',
      agent: error.structuredContent.agent,
      checkoutUrl: error.structuredContent.checkoutUrl,
      message: error.structuredContent.message,
    }

    // Express (has reply.status)
    if (reply && reply.status && typeof reply.json === 'function') {
      reply.status(402).json(errorResponse)
      return
    }

    // Fastify (has reply.code)
    if (reply && reply.code) {
      reply.code(402)
    }
    return errorResponse
  }

  const errorResponse = {
    success: false,
    error: error instanceof Error ? error.message : 'Internal server error',
  }

  // Express (has reply.status)
  if (reply && reply.status && typeof reply.json === 'function') {
    reply.status(500).json(errorResponse)
    return
  }

  // Fastify (has reply.code)
  if (reply && reply.code) {
    reply.code(500)
  }
  return errorResponse
}

// Next.js helper functions
async function defaultExtractNextArgs(request: Request, context?: any): Promise<any> {
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
      // Handle Promise<params> case (Next.js 13+ app router)
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

async function defaultGetCustomerRef(request: Request): Promise<string> {
  // Try to get from JWT token first
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      // Dynamic import to avoid requiring jose if not used
      const { jwtVerify } = await import('jose')
      const token = authHeader.substring(7)
      const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!)
      const { payload } = await jwtVerify(token, jwtSecret, {
        issuer: process.env.OAUTH_ISSUER!,
        audience: process.env.OAUTH_CLIENT_ID || 'test-client-id',
      })

      if (payload.sub) {
        return ensureCustomerRef(payload.sub as string)
      }
    } catch {
      // Fall through to use header fallback
    }
  }

  // Fallback to x-customer-ref header or default
  const customerRef = request.headers.get('x-customer-ref') || 'demo_user'
  return ensureCustomerRef(customerRef)
}

export function ensureCustomerRef(customerRef: string): string {
  // Ensure customer ref is properly formatted
  // Return customer ref as-is (preserve UUIDs with hyphens, etc.)
  if (!customerRef || customerRef === 'anonymous') {
    return 'anonymous'
  }
  return customerRef
}

function handleNextError(error: any): Response {
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

// All exports are already defined above where each item is declared
