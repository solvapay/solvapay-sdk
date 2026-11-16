/**
 * SolvaPay SDK - Universal Paywall Protection
 *
 * One API that works everywhere:
 * - HTTP frameworks (Fastify, Express)
 * - MCP servers
 * - Class-based and functional programming
 */

import type {
  LimitResponseWithPlan,
  PaywallArgs,
  PaywallDecision,
  PaywallMetadata,
  PaywallStructuredContent,
  PaywallToolResult,
  SolvaPayClient,
} from './types'
import { buildPaywallGate } from './paywall-gate'
import { requireProductRef } from './resolve-product-ref'
import { withRetry, createRequestDeduplicator } from './utils'
import { SolvaPayError } from '@solvapay/core'

// Re-export types for convenience
export type {
  PaywallArgs,
  PaywallDecision,
  PaywallMetadata,
  PaywallStructuredContent,
  PaywallToolResult,
  SolvaPayClient,
}

/**
 * Error representing a paywall gate outcome (purchase required or usage
 * limit exceeded).
 *
 * Soft-deprecated since 1.1.0 as the internal control-flow signal —
 * `paywall.decide()` returns a typed `PaywallDecision<T>` union instead,
 * and adapters route gate outcomes through `formatGate` without
 * throwing. `PaywallError` is retained as a compat shim for three paths
 * that keep working without migration:
 *
 *  1. `paywall.protect(handler, ...)` still throws `PaywallError` on
 *     gate outcomes (the legacy throw-based API).
 *  2. Merchant code that `throw new PaywallError(...)` (or
 *     `ctx.gate(reason)`, which is implemented on top of
 *     `PaywallError`) — caught at the adapter boundary and routed
 *     through `formatGate` so transport responses stay consistent.
 *  3. Custom third-party adapters that didn't implement `formatGate` —
 *     `AbstractAdapter.formatGate` falls back to wrapping in
 *     `PaywallError` and delegating to `formatError`.
 *
 * The error includes structured content with checkout URLs and metadata
 * for building custom paywall UIs.
 *
 * @example Preferred (decide()/formatGate)
 * ```typescript
 * const decision = await solvaPay.paywall.decide(args, { product })
 * if (decision.outcome === 'gate') {
 *   return res.status(402).json(paywallErrorToClientPayload(
 *     new PaywallError(decision.gate.message, decision.gate),
 *   ))
 * }
 * ```
 *
 * @example Compat (try/catch on throw-based legacy path)
 * ```typescript
 * try {
 *   const result = await payable.http(createTask)(req, res);
 *   return result;
 * } catch (error) {
 *   if (error instanceof PaywallError) {
 *     return res.status(402).json({
 *       error: error.message,
 *       checkoutUrl: error.structuredContent.checkoutUrl,
 *     });
 *   }
 *   throw error;
 * }
 * ```
 *
 * @see {@link PaywallStructuredContent} for the structured content format
 * @see {@link PaywallDecision} for the preferred decision-based API
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

/** JSON body shape for HTTP adapters and MCP text content (stable fields for clients). */
export function paywallErrorToClientPayload(error: PaywallError): Record<string, unknown> {
  const sc = error.structuredContent
  const base: Record<string, unknown> = {
    success: false,
    error: sc.kind === 'activation_required' ? 'Activation required' : 'Payment required',
    product: sc.product,
    checkoutUrl: sc.checkoutUrl,
    message: sc.message,
  }
  if (sc.kind === 'activation_required') {
    base.kind = 'activation_required'
    if (sc.plans !== undefined) base.plans = sc.plans
    if (sc.balance !== undefined) base.balance = sc.balance
    if (sc.productDetails !== undefined) base.productDetails = sc.productDetails
    if (sc.confirmationUrl !== undefined) base.confirmationUrl = sc.confirmationUrl
  } else {
    base.kind = 'payment_required'
    if (sc.balance !== undefined) base.balance = sc.balance
    if (sc.productDetails !== undefined) base.productDetails = sc.productDetails
  }
  return base
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
 * Coalesce concurrent `checkLimits` fetches for the same
 * customer/product/meter. `cacheTTL: 0` means in-flight only — the
 * instance `limitsCache` still owns the TTL, and we skip the lazy
 * `setInterval` (Workers-safe).
 */
const sharedLimitsFetchDeduplicator = createRequestDeduplicator<LimitResponseWithPlan>({
  cacheTTL: 0,
  maxCacheSize: 1000,
  cacheErrors: false,
})

/**
 * How many callers have already claimed a unit from the current
 * in-flight `checkLimits` batch, keyed by the same
 * `${customerRef}:${product}:${meter}` string as the cache. Reset
 * inside the fetch callback so a later sequential miss starts at 0
 * even when the client returns a reused result object.
 */
const sharedLimitsFetchClaims = new Map<string, number>()

interface LimitsCacheEntry {
  remaining: number
  checkoutUrl?: string
  meterName?: string
  timestamp: number
  /**
   * Full `LimitResponseWithPlan` returned from the pre-check. Cached so
   * `ctx.customer` (balance / remaining / plan) stays populated on
   * cache hits within the TTL window — the spec's 10s-stale contract.
   */
  limits: LimitResponseWithPlan
}

/**
 * Handler-scoped context passed as the optional second positional
 * argument to handlers registered via `paywall.protect(...)`.
 *
 * Backwards-compatible: existing one-arg handlers `(args) => ...`
 * ignore the second argument and continue to work.
 *
 * Consumed by `@solvapay/mcp`'s `buildPayableHandler` to construct the
 * `ResponseContext` merchant tools receive as their second argument.
 */
export interface ProtectHandlerContext {
  /** Resolved backend customer ref (`cus_...`). */
  customerRef: string
  /**
   * The `LimitResponseWithPlan` consulted at pre-check time. Sourced
   * from either the fresh `checkLimits` call on cache-miss or the
   * cached entry on cache-hit. `null` only when the paywall is
   * operating in a degraded mode that couldn't produce a limit
   * response (defensive; normal flow always populates this).
   */
  limits: LimitResponseWithPlan | null
  /**
   * Transport-level extra passed through adapter chains (e.g. the MCP
   * adapter's `extra` bag holding `authInfo`). Opaque to `protect()`
   * itself; forwarded verbatim so adapter-aware handlers can use it.
   */
  extra?: unknown
}

/**
 * Internal marker field the adapter layer uses to forward its `extra`
 * bag through `protectedHandler(args)` without widening the public
 * `PaywallArgs` type. Stripped before the fresh `checkLimits` call.
 */
const EXTRA_FORWARD_KEY = '__solvapayExtra' as const

function trackUsageExtra(
  metadata: PaywallMetadata,
  outcome: 'success' | 'paywall' | 'fail',
  consequence?: 'overage',
): { meterName?: string; usageClass?: 'included' | 'overage' } | undefined {
  if (metadata.freeLimit) {
    return { meterName: metadata.freeLimit.meter }
  }
  if (outcome === 'success') {
    return { usageClass: consequence === 'overage' ? 'overage' : 'included' }
  }
  return undefined
}

/**
 * Universal SolvaPay Protection - One API for everything
 */
export class SolvaPayPaywall {
  private customerCreationAttempts = new Set<string>()
  private customerRefMapping = new Map<string, string>()
  /** userId → customer ref, for `ensureCustomerForUser` only. */
  private userCustomerRefs = new Map<string, string>()
  private debug: boolean
  private limitsCache = new Map<string, LimitsCacheEntry>()
  private limitsCacheTTL: number

  constructor(
    private apiClient: SolvaPayClient,
    options: { debug?: boolean; limitsCacheTTL?: number } = {},
  ) {
    this.debug = options.debug ?? process.env.SOLVAPAY_DEBUG === 'true'
    this.limitsCacheTTL = options.limitsCacheTTL ?? 10_000
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log(...args)
    }
  }

  /**
   * Drop cached limits for `customerRef`. When `product` is omitted every
   * meter/product entry for that customer is removed. Matches both the
   * backend `cus_…` ref and an unmapped external ref used as a cache key.
   */
  invalidateLimits(customerRef: string, product?: string): void {
    const aliases = new Set<string>([customerRef])
    const mapped = this.customerRefMapping.get(customerRef)
    if (mapped) aliases.add(mapped)
    if (!customerRef.startsWith('cus_')) aliases.add(`cus_${customerRef}`)

    for (const key of [...this.limitsCache.keys()]) {
      const [ref, prod] = key.split(':')
      if (!ref || !aliases.has(ref)) continue
      if (product && prod !== product) continue
      this.limitsCache.delete(key)
    }
  }

  private resolveProduct(metadata: PaywallMetadata): string {
    return requireProductRef(metadata.product)
  }

  private generateRequestId(): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 11)
    return `solvapay_${timestamp}_${random}`
  }

  /**
   * Pure decision routine — performs customer resolution, limits cache
   * lookup / fresh `checkLimits` fetch, and returns a `PaywallDecision`
   * describing whether the handler should run.
   *
   * Side effects kept in lockstep with the legacy `protect()` path:
   *  - creates the backend customer on first use (`ensureCustomer`),
   *  - updates the limits cache (consume-one-unit bookkeeping), and
   *  - emits a `paywall` usage event on gate outcomes.
   *
   * `trackUsage` for the `success` / `fail` outcome is emitted by the
   * caller (adapter or `protect()`) once it has actually invoked the
   * handler — `decide()` never counts handler execution as usage.
   *
   * @since 1.1.0
   */
  async decide<TArgs extends PaywallArgs>(
    args: TArgs,
    metadata: PaywallMetadata = {},
    getCustomerRef?: (args: TArgs) => string,
  ): Promise<PaywallDecision<TArgs>> {
    const product = this.resolveProduct(metadata)
    const usageType =
      metadata.freeLimit?.meter || metadata.meterName || metadata.usageType || 'requests'
    const requestId = this.generateRequestId()
    const startTime = Date.now()

    const inputCustomerRef = getCustomerRef
      ? getCustomerRef(args)
      : args.auth?.customer_ref || 'anonymous'

    if (metadata.freeLimit) {
      const resolved = typeof inputCustomerRef === 'string' ? inputCustomerRef.trim() : ''
      if (!resolved || resolved === 'anonymous') {
        throw new SolvaPayError('identity required', {
          status: 401,
          code: 'identity_required',
        })
      }
    }

    let backendCustomerRef: string
    if (inputCustomerRef.startsWith('cus_')) {
      backendCustomerRef = inputCustomerRef
    } else {
      backendCustomerRef = await this.ensureCustomer(inputCustomerRef, inputCustomerRef)
    }

    const limitsCacheKey = `${backendCustomerRef}:${product}:${usageType}`
    const cachedLimits = this.limitsCache.get(limitsCacheKey)
    const now = Date.now()

    let withinLimits: boolean
    let remaining: number
    let checkoutUrl: string | undefined
    let resolvedMeterName: string | undefined
    let lastLimitsCheck: LimitResponseWithPlan | undefined

    const hasFreshCachedLimits = cachedLimits && now - cachedLimits.timestamp < this.limitsCacheTTL

    if (hasFreshCachedLimits) {
      checkoutUrl = cachedLimits.checkoutUrl
      resolvedMeterName = cachedLimits.meterName
      // Surface the cached `LimitResponseWithPlan` so the downstream
      // handler context carries balance/plan even on cache hits.
      lastLimitsCheck = cachedLimits.limits

      if (cachedLimits.remaining > 0) {
        cachedLimits.remaining--
        if (cachedLimits.remaining <= 0) {
          this.limitsCache.delete(limitsCacheKey)
        }
        withinLimits = true
        remaining = cachedLimits.remaining
      } else {
        // A zero-remaining entry indicates we already consumed the final unit.
        // Block one immediate follow-up request from cache, then force re-check next time.
        withinLimits = false
        remaining = 0
        this.limitsCache.delete(limitsCacheKey)
      }
    } else {
      if (cachedLimits) {
        this.limitsCache.delete(limitsCacheKey)
      }
      const limitsCheck = await sharedLimitsFetchDeduplicator.deduplicate(
        limitsCacheKey,
        async () => {
          sharedLimitsFetchClaims.set(limitsCacheKey, 0)
          return this.apiClient.checkLimits({
            customerRef: backendCustomerRef,
            productRef: product,
            meterName: usageType,
            // `paywall.decide()` bakes `checkoutUrl` into the 402
            // `PaywallStructuredContent` (consumed by
            // `<PaywallNotice.HostedCheckoutLink>`), so we opt in. Other
            // callers of `apiClient.checkLimits` (notably
            // `checkLimitsCore`, which powers the React `useLimits` hook)
            // leave this unset and the backend skips the session-creation
            // side effect.
            includeCheckoutSession: true,
            ...(metadata.freeLimit ? { freeAllowance: metadata.freeLimit } : {}),
          })
        },
      )

      lastLimitsCheck = limitsCheck
      checkoutUrl = limitsCheck.checkoutUrl
      resolvedMeterName = limitsCheck.meterName

      // N callers sharing one resolved fetch must each consume a
      // distinct unit. Claim against the shared result, then project
      // the leftover into `limitsCache` for sequential follow-ups.
      if (!limitsCheck.withinLimits) {
        withinLimits = false
        remaining = limitsCheck.remaining
      } else if (limitsCheck.remaining === -1) {
        withinLimits = true
        remaining = limitsCheck.remaining
      } else if (limitsCheck.remaining > 0) {
        const claimed = (sharedLimitsFetchClaims.get(limitsCacheKey) ?? 0) + 1
        sharedLimitsFetchClaims.set(limitsCacheKey, claimed)
        if (claimed <= limitsCheck.remaining) {
          remaining = limitsCheck.remaining - claimed
          withinLimits = true
          this.limitsCache.set(limitsCacheKey, {
            remaining,
            checkoutUrl,
            meterName: resolvedMeterName,
            timestamp: Date.now(),
            limits: limitsCheck,
          })
        } else {
          withinLimits = false
          remaining = 0
        }
      } else {
        // `withinLimits: true` with `remaining: 0` is overage — the backend
        // granted access past the included cap. Do not gate.
        withinLimits = true
        remaining = limitsCheck.remaining
      }
    }

    if (!withinLimits) {
      const latencyMs = Date.now() - startTime
      // Awaited (not floated) so the call survives runtimes that
      // terminate the request context as soon as the response returns
      // (Cloudflare Workers, Vercel Edge, Supabase Edge). Without
      // this, the `POST /v1/sdk/usages` fetch gets dropped before it
      // reaches the backend and `sumForMeter` always returns 0 — the
      // paywall never decrements free-quota and never gates.
      // `trackUsage` never rejects: it logs a failed event itself, so a
      // tracking failure never escalates into a tool-call failure.
      await this.trackUsage(
        backendCustomerRef,
        product,
        resolvedMeterName || usageType,
        'paywall',
        requestId,
        latencyMs,
        metadata.toolName,
        metadata.freeLimit ? { meterName: metadata.freeLimit.meter } : undefined,
      )

      // Delegate gate construction to `buildPaywallGate` so adapter
      // paths and `payable.gate()` produce byte-identical wire shapes.
      //
      // When the SDK gates on its own count (the last cached unit is used,
      // or more parallel callers than units share one check), the limits
      // response it counted down from still says `withinLimits: true` with
      // units remaining. The gate describes the verdict instead: no units
      // left.
      const gateLimits: LimitResponseWithPlan = lastLimitsCheck
        ? lastLimitsCheck.withinLimits
          ? { ...lastLimitsCheck, withinLimits: false, remaining: 0 }
          : lastLimitsCheck
        : {
            withinLimits: false,
            remaining: 0,
            plan: '',
            ...(checkoutUrl !== undefined ? { checkoutUrl } : {}),
          }
      const gate = buildPaywallGate(product, gateLimits)

      return {
        outcome: 'gate',
        gate,
        limits: lastLimitsCheck ?? null,
        customerRef: backendCustomerRef,
        requestId,
      }
    }

    // `withinLimits` implies `lastLimitsCheck` was populated — the
    // cache-hit branch always sets it from the cached entry and the
    // cache-miss branch assigns `limitsCheck` directly. The non-null
    // assertion keeps the `allow` payload's `limits` field strictly
    // typed.
    const consequence = lastLimitsCheck!.overage ? 'overage' : undefined

    return {
      outcome: 'allow',
      args,
      limits: lastLimitsCheck!,
      customerRef: backendCustomerRef,
      requestId,
      ...(consequence ? { consequence } : {}),
    }
  }

  /**
   * Execute the handler for an already-obtained `allow` decision and
   * emit the post-handler `trackUsage('success' | 'fail', ...)` event.
   *
   * Exposed for adapter integration — the adapter layer drives the
   * paywall through `decide()` + `runAllow()` so `formatGate` can own
   * gate outcomes without routing through `PaywallError`. `protect()`
   * continues to offer the self-contained throw-based surface for
   * legacy consumers.
   *
   * `runAllow` intentionally does NOT re-throw `PaywallError` — if a
   * handler calls `ctx.gate(reason)` and throws from deep code, the
   * adapter catches that at the `formatGate` boundary instead.
   *
   * @since 1.1.0
   */
  async runAllow<TArgs extends PaywallArgs, TResult>(
    decision: Extract<PaywallDecision<TArgs>, { outcome: 'allow' }>,
    handler: (args: TArgs, handlerContext?: ProtectHandlerContext) => Promise<TResult>,
    metadata: PaywallMetadata,
    args: TArgs,
  ): Promise<TResult> {
    const product = this.resolveProduct(metadata)
    const usageType =
      metadata.freeLimit?.meter || metadata.meterName || metadata.usageType || 'requests'
    const requestId = decision.requestId
    const startTime = Date.now()

    const forwardedExtra = (args as unknown as Record<string, unknown>)[EXTRA_FORWARD_KEY]
    const handlerContext: ProtectHandlerContext = {
      customerRef: decision.customerRef,
      limits: decision.limits,
      ...(forwardedExtra !== undefined ? { extra: forwardedExtra } : {}),
    }

    try {
      const result = await handler(args, handlerContext)
      const latencyMs = Date.now() - startTime
      // See note on the `paywall` outcome above — awaited so the
      // usage event survives request-scoped runtimes (Workers /
      // Edge), where a floated fetch is killed when the response
      // returns and `sumForMeter` never sees the event.
      await this.trackUsage(
        decision.customerRef,
        product,
        decision.limits.meterName || usageType,
        'success',
        requestId,
        latencyMs,
        metadata.toolName,
        trackUsageExtra(metadata, 'success', decision.consequence),
      )
      return result
    } catch (error) {
      if (error instanceof Error) {
        const errorType = error instanceof PaywallError ? 'PaywallError' : 'API Error'
        this.log(`❌ Error in paywall [${errorType}]: ${error.message}`)
      } else {
        this.log(`❌ Error in paywall:`, error)
      }
      if (!(error instanceof PaywallError)) {
        const latencyMs = Date.now() - startTime
        await this.trackUsage(
          decision.customerRef,
          product,
          decision.limits.meterName || usageType,
          'fail',
          requestId,
          latencyMs,
          metadata.toolName,
          trackUsageExtra(metadata, 'fail'),
        )
      }
      throw error
    }
  }

  /**
   * Core protection method - works for both MCP and HTTP
   *
   * The `handler` may optionally declare a second positional argument
   * of type `ProtectHandlerContext` to receive the resolved customer
   * ref, the pre-check `LimitResponseWithPlan`, and an opaque `extra`
   * bag threaded through from the adapter layer. One-arg handlers
   * ignore the second argument and continue to work unchanged.
   *
   * Implemented on top of `decide()`: pre-check runs through the same
   * decision routine, and gate outcomes are raised as a `PaywallError`
   * to preserve the legacy throw-based signal for consumers that
   * haven't migrated to adapter-level `formatGate` routing.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async protect<TArgs extends PaywallArgs, TResult = any>(
    handler: (args: TArgs, handlerContext?: ProtectHandlerContext) => Promise<TResult>,
    metadata: PaywallMetadata = {},
    getCustomerRef?: (args: TArgs) => string,
  ): Promise<(args: TArgs) => Promise<TResult>> {
    return async (args: TArgs): Promise<TResult> => {
      // Pre-check + gate outcome handled by `decide()`. Infrastructure
      // failures (checkLimits down, ensureCustomer hard-failed) propagate
      // as regular errors — the original `protect()` behaviour was to
      // track them as `fail` from within the inner try/catch, but the
      // customer ref resolution lives inside `decide()` now so we can't
      // reliably attribute them. Observability loss is negligible — real
      // infra failures surface as backend logs on the checkLimits /
      // ensureCustomer path anyway.
      const decision = await this.decide(args, metadata, getCustomerRef)

      if (decision.outcome === 'gate') {
        const message =
          decision.gate.kind === 'activation_required' ? 'Activation required' : 'Payment required'
        this.log(`❌ Error in paywall [PaywallError]: ${message}`)
        throw new PaywallError(message, decision.gate)
      }

      return this.runAllow(decision, handler, metadata, args)
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
          if (!(error instanceof SolvaPayError && error.status === 404)) {
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
        const createParams: {
          email: string
          name?: string
          externalRef?: string
          metadata: Record<string, unknown>
        } = {
          email: options?.email || `${customerRef}-${Date.now()}@auto-created.local`,
          metadata: {},
        }

        if (options?.name) {
          createParams.name = options.name
        }

        if (externalRef) {
          createParams.externalRef = externalRef
        }

        const result = await this.apiClient.createCustomer(createParams)

        // Extract the backend reference from the response
        const resultObj = result as unknown as Record<string, string>
        const ref = resultObj.customerRef || resultObj.reference || customerRef

        // Store the mapping (per-instance cache)
        this.customerRefMapping.set(customerRef, ref)

        return ref
      } catch (error: unknown) {
        // The create did not produce a customer: don't leave the user marked
        // as attempted, or the next call skips creation and sends the app's
        // own user id to the API as if it were a customer ref. Paths below
        // that do resolve a customer store the mapping themselves.
        this.customerCreationAttempts.delete(customerRef)
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (errorMessage.includes('409') || errorMessage.includes('already exists')) {
          // Try to lookup by externalRef first if available
          if (externalRef) {
            try {
              const searchResult = await this.apiClient.getCustomer({ externalRef })
              if (searchResult && searchResult.customerRef) {
                this.customerRefMapping.set(customerRef, searchResult.customerRef)
                return searchResult.customerRef
              }
            } catch (lookupError: unknown) {
              this.log(
                `⚠️ Failed to lookup existing customer by externalRef after 409:`,
                lookupError instanceof Error ? lookupError.message : lookupError,
              )
            }
          }

          // If conflict is due to email uniqueness but externalRef lookup failed,
          // retry creation with a generated email while preserving externalRef.
          // This allows resolving stale customers created before externalRef was set.
          const isEmailConflict =
            errorMessage.includes('email') || errorMessage.includes('identifier email')

          if (externalRef && isEmailConflict && options?.email) {
            try {
              const byEmail = await this.apiClient.getCustomer({ email: options.email })
              if (byEmail && byEmail.customerRef) {
                this.customerRefMapping.set(customerRef, byEmail.customerRef)
                this.log(
                  `⚠️ Resolved customer ${customerRef} by email after conflict; using existing customer ${byEmail.customerRef}`,
                )

                // Best-effort: backfill externalRef so the next lookup takes the
                // fast getCustomer({externalRef}) path and we don't trip the
                // email-conflict branch again. Swallow errors — the resolved
                // customerRef is already cached and usable.
                if (!byEmail.externalRef && this.apiClient.updateCustomer) {
                  try {
                    await this.apiClient.updateCustomer(byEmail.customerRef, { externalRef })
                  } catch (backfillError: unknown) {
                    this.log(
                      `⚠️ Failed to backfill externalRef on ${byEmail.customerRef}:`,
                      backfillError instanceof Error ? backfillError.message : backfillError,
                    )
                  }
                }

                return byEmail.customerRef
              }
            } catch (emailLookupError: unknown) {
              this.log(
                `⚠️ Email lookup failed after customer conflict for ${customerRef}:`,
                emailLookupError instanceof Error ? emailLookupError.message : emailLookupError,
              )
            }

            try {
              const retryParams: {
                email: string
                name?: string
                externalRef?: string
                metadata: Record<string, unknown>
              } = {
                email: `${customerRef}-${Date.now()}@auto-created.local`,
                externalRef,
                metadata: {},
              }

              if (options?.name) {
                retryParams.name = options.name
              }

              const retryResult = await this.apiClient.createCustomer(retryParams)
              const retryObj = retryResult as unknown as Record<string, string>
              const retryRef = retryObj.customerRef || retryObj.reference || customerRef

              this.customerRefMapping.set(customerRef, retryRef)
              this.log(
                `⚠️ Retried customer creation for ${customerRef} with generated email after email conflict`,
              )
              return retryRef
            } catch (retryError: unknown) {
              this.log(
                `⚠️ Retry create customer with generated email failed for ${customerRef}:`,
                retryError instanceof Error ? retryError.message : retryError,
              )
            }
          }

          // We have a known conflict but could not resolve the existing customer reference.
          // Returning the original app user ID here causes downstream 404s in payment APIs.
          const unresolvedMessage =
            errorMessage || 'Customer already exists but could not be resolved'
          throw new SolvaPayError(
            `Failed to resolve existing customer for ${customerRef} after conflict: ${unresolvedMessage}. ` +
              'Ensure the existing customer is linked to this externalRef.',
            { status: 409, code: 'customer_conflict' },
          )
        }

        this.log(
          `❌ Failed to auto-create customer ${customerRef}:`,
          error instanceof Error ? error.message : error,
        )
        throw error
      }
    })

    // Store the mapping in per-instance cache for faster subsequent lookups
    if (backendRef !== customerRef) {
      this.customerRefMapping.set(customerRef, backendRef)
    }

    return backendRef
  }

  /**
   * The SolvaPay customer for one of the merchant's users, found by
   * `externalRef` (the user id), else created with it.
   *
   * Unlike `ensureCustomer`, the user id is never taken as a customer ref,
   * even when it starts with `cus_` or is `'anonymous'`: it comes from the
   * merchant's auth and only ever names a user. Results are cached apart from
   * `ensureCustomer`'s, so a user whose id looks like a customer ref can't
   * reach that customer through the cache.
   */
  async ensureCustomerForUser(
    userId: string,
    details?: { email?: string; name?: string },
  ): Promise<string> {
    if (!userId) throw new SolvaPayError('ensureCustomerForUser needs a user id')
    const cached = this.userCustomerRefs.get(userId)
    if (cached) return cached

    const ref = await sharedCustomerLookupDeduplicator.deduplicate(`user:${userId}`, async () => {
      const found = await this.findCustomerByExternalRef(userId)
      if (found) return found
      if (!this.apiClient.createCustomer) {
        throw new SolvaPayError(
          `Cannot create a customer for user ${userId}: the API client has no createCustomer`,
        )
      }
      try {
        const created = (await this.apiClient.createCustomer({
          email: details?.email || `${userId}-${Date.now()}@auto-created.local`,
          ...(details?.name ? { name: details.name } : {}),
          externalRef: userId,
          metadata: {},
        })) as unknown as Record<string, string>
        const createdRef = created.customerRef || created.reference
        if (!createdRef) {
          throw new SolvaPayError(`Creating a customer for user ${userId} returned no reference`)
        }
        return createdRef
      } catch (error) {
        // Another request created this user's customer first.
        if (error instanceof SolvaPayError && error.status === 409) {
          const raced = await this.findCustomerByExternalRef(userId)
          if (raced) return raced
        }
        throw error
      }
    })
    this.userCustomerRefs.set(userId, ref)
    return ref
  }

  /** The customer whose externalRef is `externalRef`, or null when there is none (404). */
  private async findCustomerByExternalRef(externalRef: string): Promise<string | null> {
    try {
      const customer = await this.apiClient.getCustomer({ externalRef })
      return customer?.customerRef ?? null
    } catch (error) {
      if (error instanceof SolvaPayError && error.status === 404) return null
      throw error
    }
  }

  async trackUsage(
    customerRef: string,
    productRef: string,
    action: string,
    outcome: 'success' | 'paywall' | 'fail',
    requestId: string,
    actionDuration: number,
    toolName?: string,
    extra?: { meterName?: string; usageClass?: 'included' | 'overage' },
  ): Promise<void> {
    await withRetry(
      () =>
        this.apiClient.trackUsage({
          customerRef,
          actionType: 'api_call',
          units: 1,
          outcome,
          productRef,
          duration: actionDuration,
          idempotencyKey: `${requestId}:${outcome}`,
          metadata: {
            action: action || 'api_requests',
            requestId,
            ...(toolName ? { toolName } : {}),
            ...(extra?.meterName ? { meterName: extra.meterName } : {}),
            ...(extra?.usageClass ? { usageClass: extra.usageClass } : {}),
          },
          timestamp: new Date().toISOString(),
        }),
      {
        maxRetries: 2,
        initialDelay: 500,
        shouldRetry: error => error.message.includes('Customer not found'),
        onRetry: (_error, attempt) => {
          console.warn(`⚠️  Customer not found (attempt ${attempt + 1}/3), retrying in 500ms...`)
        },
      },
    ).catch(error => {
      console.error('Usage tracking failed:', error)
    })
  }
}

/**
 * Universal SolvaPay factory - One API for MCP and HTTP
 */
export function createPaywall(config: { apiClient: SolvaPayClient }) {
  const paywall = new SolvaPayPaywall(config.apiClient)

  // Functional approach - works for both MCP and HTTP
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function protect<TArgs extends PaywallArgs, TResult = any>(metadata: PaywallMetadata = {}) {
    return function (handler: (args: TArgs) => Promise<TResult>) {
      return paywall.protect(handler, metadata)
    }
  }

  // Class-based decorator
  function Paywall(metadata: PaywallMetadata = {}) {
    return function (
      target: Record<string, unknown>,
      propertyKey: string,
      descriptor?: PropertyDescriptor,
    ) {
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

  /**
   * MCP handler that auto-converts `PaywallError` to a `PaywallToolResult`
   * so integrators don't need to `try/catch` around the returned handler.
   *
   * Note: `_meta.ui` is intentionally NOT attached here — that requires the
   * MCP server's `resourceUri`, which this layer doesn't know. Use
   * `registerPayableTool` or `paywallToolResult` from
   * `@solvapay/server/mcp` to attach it.
   */
  function createMCPHandler(
    methodOrMetadata: ((...args: unknown[]) => unknown) | PaywallMetadata,
    handler?: (args: PaywallArgs) => Promise<unknown>,
  ) {
    const wrapWithPaywallCatch = (
      protectedHandlerPromise: Promise<(args: PaywallArgs) => Promise<unknown>>,
    ) => {
      return async (args: PaywallArgs): Promise<unknown> => {
        const protectedHandler = await protectedHandlerPromise
        try {
          return await protectedHandler(args)
        } catch (err) {
          if (err instanceof PaywallError) {
            return {
              isError: true,
              content: [{ type: 'text', text: err.message }],
              structuredContent: err.structuredContent,
            } satisfies PaywallToolResult
          }
          throw err
        }
      }
    }

    if (typeof methodOrMetadata === 'function') {
      const method = methodOrMetadata
      const metadata = (method as unknown as Record<string, unknown>)
        ._paywallMetadata as PaywallMetadata

      if (!metadata) {
        throw new Error('Method must be decorated with @Paywall')
      }

      const getCustomerRef = (args: PaywallArgs) => args.auth?.customer_ref || 'anonymous'
      return wrapWithPaywallCatch(
        paywall.protect(
          method as unknown as (args: PaywallArgs) => Promise<unknown>,
          metadata,
          getCustomerRef,
        ),
      )
    }

    const metadata = methodOrMetadata
    const getCustomerRef = (args: PaywallArgs) => args.auth?.customer_ref || 'anonymous'
    return wrapWithPaywallCatch(paywall.protect(handler!, metadata, getCustomerRef))
  }

  return {
    protect, // Function wrapper
    Paywall, // Class decorator
    createMCPHandler,
    ensureCustomer: (customerRef: string) => paywall.ensureCustomer(customerRef), // Customer creation helper
    paywall, // Low-level access
  }
}

// All exports are already defined above where each item is declared
