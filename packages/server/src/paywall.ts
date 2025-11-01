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
} from './types';
import { withRetry } from './utils';

// Re-export types for convenience
export type {
  PaywallArgs,
  PaywallMetadata,
  PaywallStructuredContent,
  PaywallToolResult,
  SolvaPayClient,
};

export class PaywallError extends Error {
  constructor(
    message: string,
    public structuredContent: PaywallStructuredContent
  ) {
    super(message);
    this.name = 'PaywallError';
  }
}

/**
 * Universal SolvaPay Protection - One API for everything
 */
export class SolvaPayPaywall {
  private customerCreationAttempts = new Set<string>();
  private customerRefMapping = new Map<string, string>(); // input ref -> backend ref
  private debug: boolean;
  
  constructor(private apiClient: SolvaPayClient, options: { debug?: boolean } = {}) {
    this.debug = options.debug ?? process.env.SOLVAPAY_DEBUG === 'true';
  }
  
  private log(...args: any[]): void {
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  }

  private resolveAgent(metadata: PaywallMetadata): string {
    return metadata.agent || 
           process.env.SOLVAPAY_AGENT || 
           this.getPackageJsonName() || 
           'default-agent';
  }

  private getPackageJsonName(): string | undefined {
    try {
      const pkg = require(process.cwd() + '/package.json');
      return pkg.name;
    } catch {
      return undefined;
    }
  }

  private generateRequestId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `solvapay_${timestamp}_${random}`;
  }

  /**
   * Core protection method - works for both MCP and HTTP
   */
  async protect<TArgs extends PaywallArgs, TResult = any>(
    handler: (args: TArgs) => Promise<TResult>,
    metadata: PaywallMetadata = {},
    getCustomerRef?: (args: TArgs) => string
  ): Promise<(args: TArgs) => Promise<TResult>> {
    const agent = this.resolveAgent(metadata);
    const toolName = handler.name || 'anonymous';
    
    return async (args: TArgs): Promise<TResult> => {
      const startTime = Date.now();
      const requestId = this.generateRequestId();
      const inputCustomerRef = getCustomerRef ? getCustomerRef(args) : args.auth?.customer_ref || 'anonymous';

      // Auto-create customer if needed and get the backend reference
      const backendCustomerRef = await this.ensureCustomer(inputCustomerRef);

      try {
        // Check limits with backend using the backend customer reference
        const planRef = metadata.plan || toolName;
        this.log(`🔍 Checking limits for customer: ${backendCustomerRef}, agent: ${agent}, plan: ${planRef}`);
        
        const limitsCheck = await this.apiClient.checkLimits({
          customerRef: backendCustomerRef,
          agentRef: agent
        });
        
        this.log(`✓ Limits check passed:`, limitsCheck);

        if (!limitsCheck.withinLimits) {
          const latencyMs = Date.now() - startTime;
          this.log(`🚫 Paywall triggered - tracking usage`);
          await this.trackUsage(backendCustomerRef, agent, planRef, toolName, 'paywall', requestId, latencyMs);
          
          throw new PaywallError('Payment required', {
            kind: 'payment_required',
            agent,
            checkoutUrl: limitsCheck.checkoutUrl || '',
            message: `Plan subscription required. Remaining: ${limitsCheck.remaining}`
          });
        }

        // Execute the protected handler
        this.log(`⚡ Executing handler: ${toolName}`);
        const result = await handler(args);
        this.log(`✓ Handler completed successfully`);
        
        // Track successful usage
        const latencyMs = Date.now() - startTime;
        this.log(`📊 Tracking successful usage`);
        await this.trackUsage(backendCustomerRef, agent, planRef, toolName, 'success', requestId, latencyMs);
        this.log(`✅ Request completed successfully`);
        
        return result;

      } catch (error) {
        this.log(`❌ Error in paywall:`, error);
        const latencyMs = Date.now() - startTime;
        const outcome = error instanceof PaywallError ? 'paywall' : 'fail';
        const planRef = metadata.plan || toolName;
        await this.trackUsage(backendCustomerRef, agent, planRef, toolName, outcome, requestId, latencyMs);
        throw error;
      }
    };
  }

  /**
   * Ensures a customer exists in the backend, creating them if necessary.
   * This is a public helper for testing, pre-creating customers, and internal use.
   * Only attempts creation once per customer (idempotent).
   * Returns the backend customer reference to use in API calls.
   * 
   * @param customerRef - The customer reference (e.g., Supabase user ID)
   * @param externalRef - Optional external reference for backend lookup (e.g., Supabase user ID)
   *   If provided, will lookup existing customer by externalRef before creating new one
   * @param options - Optional customer details (email, name) for customer creation
   */
  async ensureCustomer(customerRef: string, externalRef?: string, options?: { email?: string; name?: string }): Promise<string> {
    // Return cached mapping if exists
    if (this.customerRefMapping.has(customerRef)) {
      return this.customerRefMapping.get(customerRef)!;
    }
    
    // Skip for anonymous users
    if (customerRef === 'anonymous') {
      return customerRef;
    }
    
    // If externalRef is provided, try to lookup existing customer first
    if (externalRef && this.apiClient.getCustomerByExternalRef) {
      try {
        this.log(`🔍 Looking up customer by externalRef: ${externalRef}`);
        const existingCustomer = await this.apiClient.getCustomerByExternalRef({ externalRef });
        
        if (existingCustomer && existingCustomer.customerRef) {
          const backendRef = existingCustomer.customerRef;
          this.log(`✅ Found existing customer by externalRef: ${externalRef} -> ${backendRef}`);
          
          // Store the mapping for future use
          this.customerRefMapping.set(customerRef, backendRef);
          
          // Also track that we've attempted creation for this externalRef to prevent duplicates
          this.customerCreationAttempts.add(customerRef);
          if (externalRef !== customerRef) {
            this.customerCreationAttempts.add(externalRef);
          }
          
          return backendRef;
        }
      } catch (error) {
        // 404 means customer doesn't exist yet - this is expected, continue to creation
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('404') || errorMessage.includes('not found')) {
          this.log(`🔍 Customer not found by externalRef, will create new: ${externalRef}`);
        } else {
          // Unexpected error - log but continue to fallback behavior
          this.log(`⚠️  Error looking up customer by externalRef: ${errorMessage}`);
        }
      }
    }
    
    // If already attempted but no mapping, use original ref
    // Check both customerRef and externalRef to prevent duplicates
    if (this.customerCreationAttempts.has(customerRef) || 
        (externalRef && this.customerCreationAttempts.has(externalRef))) {
      // If we have a mapping, use it; otherwise return the original ref
      const mappedRef = this.customerRefMapping.get(customerRef);
      return mappedRef || customerRef;
    }
    
    // Skip if createCustomer is not available
    if (!this.apiClient.createCustomer) {
      // eslint-disable-next-line no-console
      console.warn(`⚠️  Cannot auto-create customer ${customerRef}: createCustomer method not available on API client`);
      return customerRef;
    }
    
    this.customerCreationAttempts.add(customerRef);
    
    try {
      this.log(`🔧 Auto-creating customer: ${customerRef}${externalRef ? ` (externalRef: ${externalRef})` : ''}`);
      
      // Prepare customer creation params
      // Use provided email/name, or fallback to auto-generated values
      const createParams: any = {
        email: options?.email || `${customerRef}@auto-created.local`,
        name: options?.name || customerRef
      };
      
      // Include externalRef if provided
      if (externalRef) {
        createParams.externalRef = externalRef;
      }
      
      const result = await this.apiClient.createCustomer(createParams);
      
      // Extract the backend reference from the response
      const backendRef = (result as any).customerRef || (result as any).reference || customerRef;
      
      this.log(`✅ Successfully created customer: ${customerRef} -> ${backendRef}`, result);
      
      this.log(`🔍 DEBUG - ensureCustomer analysis:`);
      this.log(`   - Input customerRef: ${customerRef}`);
      this.log(`   - ExternalRef: ${externalRef || 'none'}`);
      this.log(`   - Backend customerRef: ${backendRef}`);
      this.log(`   - Has plan in response: ${(result as any).plan ? 'YES - ' + (result as any).plan : 'NO'}`);
      this.log(`   - Has subscription in response: ${(result as any).subscription ? 'YES' : 'NO'}`);
      
      // Store the mapping
      this.customerRefMapping.set(customerRef, backendRef);
      
      return backendRef;
    } catch (error) {
      this.log(`❌ Failed to auto-create customer ${customerRef}:`, error instanceof Error ? error.message : error);
      // Continue anyway - use the original ref
      return customerRef;
    }
  }

  async trackUsage(customerRef: string, agentRef: string, planRef: string, toolName: string, outcome: 'success' | 'paywall' | 'fail', requestId: string, actionDuration: number): Promise<void> {
    // TODO: review if we should use withRetry for all API calls
    await withRetry(
      () => this.apiClient.trackUsage({ 
        customerRef, 
        agentRef,
        planRef,
        outcome,
        action: toolName,
        requestId, 
        actionDuration, 
        timestamp: new Date().toISOString() 
      }),
      {
        maxRetries: 2,
        initialDelay: 500,
        shouldRetry: (error) => error.message.includes('Customer not found'), // TODO: review if this is needed and what to check for 
        onRetry: (error, attempt) => {
          // eslint-disable-next-line no-console
          console.warn(`⚠️  Customer not found (attempt ${attempt + 1}/3), retrying in 500ms...`);
        }
      }
    ).catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Usage tracking failed:', error);
      // Don't throw - tracking is not critical
    });
  }
}

/**
 * Universal SolvaPay factory - One API for MCP and HTTP
 */
export function createPaywall(config: { 
  apiClient: SolvaPayClient;
}) {
  const paywall = new SolvaPayPaywall(config.apiClient);

  // Functional approach - works for both MCP and HTTP
  function protect<TArgs extends PaywallArgs, TResult = any>(
    metadata: PaywallMetadata = {}
  ) {
    return function(handler: (args: TArgs) => Promise<TResult>) {
      return paywall.protect(handler, metadata);
    };
  }

  // Class-based decorator
  function Paywall(metadata: PaywallMetadata = {}) {
    return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
      // Handle both descriptor and direct property assignment
      const method = descriptor?.value || target[propertyKey];
      
      if (typeof method !== 'function') {
        throw new Error('@Paywall decorator can only be applied to methods');
      }

      // Store metadata on the method
      method._paywallMetadata = metadata;
      
      if (descriptor) {
        // Standard method decorator
        descriptor.value = method;
        return descriptor;
      } else {
        // Legacy decorator or direct property
        target[propertyKey] = method;
        return target;
      }
    };
  }

  // HTTP framework integration
  function createHttpHandler(
    methodOrMetadata: Function | PaywallMetadata,
    handlerOrOptions?: ((args: any) => Promise<any>) | {
      extractArgs?: (req: any) => any;
      transformResponse?: (result: any, reply: any) => any;
      getCustomerRef?: (req: any) => string;
    }
  ) {
    // Handle decorated method
    if (typeof methodOrMetadata === 'function') {
      const method = methodOrMetadata;
      const metadata = (method as any)._paywallMetadata as PaywallMetadata;
      const options = handlerOrOptions as any;
      
      if (!metadata) {
        throw new Error('Method must be decorated with @Paywall');
      }

      return async (req: any, reply: any) => {
        try {
          const extractArgs = options?.extractArgs || defaultExtractArgs;
          const getCustomerRef = options?.getCustomerRef || ((req: any) => req.auth?.customer_ref || 'anonymous');
          
          const args = extractArgs(req);
          const protectedMethod = await paywall.protect(method as any, metadata, getCustomerRef);
          const result = await protectedMethod(args);
          
          const transformResponse = options?.transformResponse || ((result: any) => result);
          return transformResponse(result, reply);
          
        } catch (error) {
          return handleHttpError(error, reply);
        }
      };
    }
    
    // Handle inline metadata + handler
    const metadata = methodOrMetadata;
    const handler = handlerOrOptions as (args: any) => Promise<any>;
    
    return async (req: any, reply: any) => {
      try {
        const args = defaultExtractArgs(req);
        const getCustomerRef = (args: any) => args.auth?.customer_ref || 'anonymous';
        
        const protectedHandler = await paywall.protect(handler, metadata, getCustomerRef);
        const result = await protectedHandler(args);
        
        // Handle Express response (has res.status) vs Fastify (has reply.code)
        if (reply && reply.status && typeof reply.json === 'function') {
          // Express: call res.json() and don't return a value
          reply.json(result);
          return;
        }
        
        // Fastify: return the result for auto-serialization
        return result;
        
      } catch (error) {
        return handleHttpError(error, reply);
      }
    };
  }

  // MCP integration
  function createMCPHandler(methodOrMetadata: Function | PaywallMetadata, handler?: (args: any) => Promise<any>) {
    // Handle decorated method
    if (typeof methodOrMetadata === 'function') {
      const method = methodOrMetadata;
      const metadata = (method as any)._paywallMetadata as PaywallMetadata;
      
      if (!metadata) {
        throw new Error('Method must be decorated with @Paywall');
      }

      const getCustomerRef = (args: any) => args.auth?.customer_ref || 'anonymous';
      return paywall.protect(method as any, metadata, getCustomerRef);
    }
    
    // Handle inline metadata + handler
    const metadata = methodOrMetadata;
    const getCustomerRef = (args: any) => args.auth?.customer_ref || 'anonymous';
    return paywall.protect(handler!, metadata, getCustomerRef);
  }

  // Next.js API route integration
  function createNextHandler(
    metadata: PaywallMetadata,
    handler: (args: any) => Promise<any>,
    options?: {
      extractArgs?: (request: Request, context?: any) => Promise<any> | any;
      getCustomerRef?: (request: Request) => Promise<string> | string;
      transformResponse?: (result: any) => any;
    }
  ) {
    return async (request: Request, context?: any) => {
      try {
        const extractArgs = options?.extractArgs || defaultExtractNextArgs;
        const getCustomerRef = options?.getCustomerRef || defaultGetCustomerRef;
        const transformResponse = options?.transformResponse || ((result: any) => result);
        
        const args = await extractArgs(request, context);
        const customerRef = await getCustomerRef(request);
        
        // Add auth info to args
        args.auth = { customer_ref: customerRef };
        
        const protectedHandler = await paywall.protect(handler, metadata, (args: any) => args.auth.customer_ref);
        const result = await protectedHandler(args);
        
        const transformedResult = transformResponse(result);
        return new Response(JSON.stringify(transformedResult), {
          headers: { 'Content-Type': 'application/json' }
        });
        
      } catch (error) {
        return handleNextError(error);
      }
    };
  }

  return {
    protect,          // Function wrapper
    Paywall,          // Class decorator
    createHttpHandler,
    createMCPHandler,
    createNextHandler, // Next.js API routes
    ensureCustomer: (customerRef: string) => paywall.ensureCustomer(customerRef), // Customer creation helper
    paywall           // Low-level access
  };
}

// Helper functions
function defaultExtractArgs(req: any): any {
  return {
    ...(req.body as object || {}),
    ...(req.params as object || {}),
    ...(req.query as object || {}),
    auth: { customer_ref: req.headers?.['x-customer-ref'] || req.auth?.customer_ref }
  };
}

function handleHttpError(error: any, reply: any) {
  if (error instanceof PaywallError) {
    const errorResponse = {
      success: false,
      error: 'Payment required',
      agent: error.structuredContent.agent,
      checkoutUrl: error.structuredContent.checkoutUrl,
      message: error.structuredContent.message
    };
    
    // Express (has reply.status)
    if (reply && reply.status && typeof reply.json === 'function') {
      reply.status(402).json(errorResponse);
      return;
    }
    
    // Fastify (has reply.code)
    if (reply && reply.code) {
      reply.code(402);
    }
    return errorResponse;
  }
  
  const errorResponse = {
    success: false,
    error: error instanceof Error ? error.message : 'Internal server error'
  };
  
  // Express (has reply.status)
  if (reply && reply.status && typeof reply.json === 'function') {
    reply.status(500).json(errorResponse);
    return;
  }
  
  // Fastify (has reply.code)
  if (reply && reply.code) {
    reply.code(500);
  }
  return errorResponse;
}

// Next.js helper functions
async function defaultExtractNextArgs(request: Request, context?: any): Promise<any> {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  
  // Parse request body if present
  let body = {};
  try {
    if (request.method !== 'GET' && request.headers.get('content-type')?.includes('application/json')) {
      body = await request.json();
    }
  } catch (error) {
    // If parsing fails, continue with empty body
  }
  
  // Handle route parameters if provided
  let routeParams = {};
  if (context?.params) {
    if (typeof context.params === 'object' && 'then' in context.params) {
      // Handle Promise<params> case (Next.js 13+ app router)
      routeParams = await context.params;
    } else {
      routeParams = context.params;
    }
  }
  
  return {
    ...body,
    ...query,
    ...routeParams
  };
}

async function defaultGetCustomerRef(request: Request): Promise<string> {
  // Try to get from JWT token first
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      // Dynamic import to avoid requiring jose if not used
      const { jwtVerify } = await import('jose');
      const token = authHeader.substring(7);
      const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
      const { payload } = await jwtVerify(token, jwtSecret, {
        issuer: process.env.OAUTH_ISSUER!,
        audience: process.env.OAUTH_CLIENT_ID || 'test-client-id'
      });
      
      if (payload.sub) {
        return ensureCustomerRef(payload.sub as string);
      }
    } catch (error) {
      if (process.env.SOLVAPAY_DEBUG !== 'false') {
        // eslint-disable-next-line no-console
        console.log('Failed to verify JWT token:', error);
      }
      // Fall through to use header fallback
    }
  }
  
  // Fallback to x-customer-ref header or default
  const customerRef = request.headers.get('x-customer-ref') || 'demo_user';
  return ensureCustomerRef(customerRef);
}

export function ensureCustomerRef(customerRef: string): string {
  // Ensure customer ref is properly formatted
  if (!customerRef.startsWith('customer_') && !customerRef.startsWith('demo_')) {
    return `customer_${customerRef.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }
  return customerRef;
}

function handleNextError(error: any): Response {
  if (error instanceof PaywallError) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Payment required',
      agent: error.structuredContent.agent,
      checkoutUrl: error.structuredContent.checkoutUrl,
      message: error.structuredContent.message
    }), {
      status: 402,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : 'Internal server error'
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
}

// All exports are already defined above where each item is declared
