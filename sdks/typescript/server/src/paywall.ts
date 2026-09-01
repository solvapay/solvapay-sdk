/**
 * SolvaPay SDK - Universal Paywall Protection
 *
 * One API that works everywhere:
 * - HTTP frameworks (Fastify, Express)
 * - MCP servers
 * - Class-based and functional programming
 */

import { SolvaPayError, type GateAction, type GateCacheOp } from '@solvapay/core'
import type {
  LimitResponseWithPlan,
  PaywallArgs,
  PaywallDecision,
  PaywallMetadata,
  PaywallStructuredContent,
  PaywallToolResult,
  SolvaPayClient,
  TrackUsageRequest,
} from './types'
import {
  ensureCustomerNext,
  gateNext,
  isErrorResult,
  mapRouteError,
  paywallErrorToClientPayload as paywallErrorToClientPayloadDispatch,
  requireProductRef,
  resolveCheckLimitsParams,
  resolveCustomerRef,
} from './native-decisions'
import { CUSTOMER_DEDUP_MAX_CACHE_SIZE } from './defaults'
import { trackUsageWithRetry } from './track-usage-retry'
import { createRequestDeduplicator } from './utils'

export * from './defaults'

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
  return paywallErrorToClientPayloadDispatch(error)
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
  cacheTTL: 0,
  maxCacheSize: CUSTOMER_DEDUP_MAX_CACHE_SIZE,
  cacheErrors: false,
})

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

/**
 * Universal SolvaPay Protection - One API for everything
 */
export class SolvaPayPaywall {
  private customerCache = new Map<string, { backendRef: string; timestampMs: number }>()
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

  private resolveProduct(metadata: PaywallMetadata): string {
    return requireProductRef(metadata.product, process.env.SOLVAPAY_PRODUCT_REF)
  }

  private resolveMeterName(product: string, metadata: PaywallMetadata): string {
    const resolved = resolveCheckLimitsParams(product, metadata.meterName, metadata.usageType)
    if ('error' in resolved) {
      throw new SolvaPayError(resolved.error)
    }
    return resolved.meterName
  }

  private applyGateCache(cache: GateCacheOp | undefined): void {
    if (cache == null) {
      return
    }
    if (cache.op === 'delete') {
      this.limitsCache.delete(cache.key)
      return
    }
    if (cache.op === 'updateRemaining' && cache.remaining !== undefined) {
      const entry = this.limitsCache.get(cache.key)
      if (entry) {
        entry.remaining = cache.remaining
      }
      return
    }
    if (cache.op === 'set' && cache.remaining !== undefined && cache.limits != null) {
      if (typeof cache.timestamp !== 'number') {
        throw new SolvaPayError('gate_next cache set missing timestamp')
      }
      this.limitsCache.set(cache.key, {
        remaining: cache.remaining,
        checkoutUrl: cache.checkoutUrl,
        meterName: cache.meterName,
        timestamp: cache.timestamp,
        // Generated GateCacheOp.limits is `unknown`; the driver copies the checkLimits body.
        limits: cache.limits as LimitResponseWithPlan,
      })
    }
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
    const usageType = this.resolveMeterName(product, metadata)
    const startTime = Date.now()

    const inputCustomerRef = getCustomerRef
      ? getCustomerRef(args)
      : args.auth?.customer_ref || 'anonymous'

    let state: unknown = null
    let event: Record<string, unknown> = {
      kind: 'start',
      customerRef: inputCustomerRef,
      product,
      usageType,
      startedMs: startTime,
      limitsCacheTTLMs: this.limitsCacheTTL,
    }

    for (;;) {
      const out = gateNext(state, event) as { state: unknown; action: GateAction }
      state = out.state
      const action = out.action

      if (action.kind === 'ensureCustomer') {
        const backendRef = await this.ensureCustomer(
          String(action.customerRef),
          String(action.customerRef),
        )
        event = { kind: 'customerResolved', backendRef, nowMs: Date.now() }
        continue
      }

      if (action.kind === 'readLimitsCache') {
        const key = String(action.key)
        const cached = this.limitsCache.get(key)
        const now = Date.now()
        event = cached
          ? {
              kind: 'limitsCacheEntry',
              found: true,
              remaining: cached.remaining,
              limits: cached.limits,
              timestampMs: cached.timestamp,
              nowMs: now,
              randomUnit: Math.random(),
            }
          : { kind: 'limitsCacheEntry', found: false, nowMs: now, randomUnit: Math.random() }
        continue
      }

      if (action.kind === 'checkLimits') {
        if (typeof action.cacheDeleteKey === 'string') {
          this.limitsCache.delete(action.cacheDeleteKey)
        }
        const limitsCheck = await this.apiClient.checkLimits({
          customerRef: String(action.customerRef),
          productRef: String(action.productRef),
          meterName: String(action.meterName),
          includeCheckoutSession: action.includeCheckoutSession === true,
        })
        event = {
          kind: 'limitsResult',
          limits: limitsCheck,
          nowMs: Date.now(),
          randomUnit: Math.random(),
        }
        continue
      }

      if (action.kind === 'gate') {
        this.applyGateCache(action.cache)
        await this.postUsageRequest(action.request)
        if (action.gate == null) {
          throw new SolvaPayError('gate_next gate action missing gate payload')
        }
        return {
          outcome: 'gate',
          // Driver emits PaywallGate; boundary types it as unknown.
          gate: action.gate as PaywallStructuredContent,
          limits: action.limits as LimitResponseWithPlan,
          customerRef: String(action.customerRef),
        }
      }

      if (action.kind === 'allow') {
        this.applyGateCache(action.cache)
        return {
          outcome: 'allow',
          args,
          limits: action.limits as LimitResponseWithPlan,
          customerRef: String(action.customerRef),
          driverState: state,
        }
      }

      if (action.kind === 'emitUsage' || action.kind === 'skipUsage') {
        throw new SolvaPayError(
          `gate_next returned ${action.kind} during decide; usage actions belong on handler events`,
        )
      }

      const unexpected: never = action
      throw new SolvaPayError(`gate_next returned unknown action: ${JSON.stringify(unexpected)}`)
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
      await this.emitHandlerUsage(decision.driverState, {
        kind: 'handlerSucceeded',
        durationMs: latencyMs,
        nowMs: Date.now(),
        randomUnit: Math.random(),
      })
      return result
    } catch (error) {
      if (error instanceof Error) {
        const errorType = error instanceof PaywallError ? 'PaywallError' : 'API Error'
        this.log(`❌ Error in paywall [${errorType}]: ${error.message}`)
      } else {
        this.log(`❌ Error in paywall:`, error)
      }
      const latencyMs = Date.now() - startTime
      await this.emitHandlerUsage(decision.driverState, {
        kind: 'handlerFailed',
        durationMs: latencyMs,
        nowMs: Date.now(),
        randomUnit: Math.random(),
        errorMessage: error instanceof Error ? error.message : String(error),
        isPaywallError: error instanceof PaywallError,
      })
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
        const message = decision.gate.shortMessage
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
    const cacheKey = externalRef || customerRef
    return sharedCustomerLookupDeduplicator.deduplicate(cacheKey, () =>
      this.runEnsureCustomerDriver(customerRef, externalRef, options),
    )
  }

  private async runEnsureCustomerDriver(
    customerRef: string,
    externalRef?: string,
    options?: { email?: string; name?: string },
  ): Promise<string> {
    let state: unknown = null
    let event: Record<string, unknown> = {
      kind: 'start',
      customerRef,
      canCreateCustomer: typeof this.apiClient.createCustomer === 'function',
      canUpdateCustomer: typeof this.apiClient.updateCustomer === 'function',
      nowMs: Date.now(),
    }
    if (externalRef) {
      event.externalRef = externalRef
    }
    if (options?.email) {
      event.email = options.email
    }
    if (options?.name) {
      event.name = options.name
    }

    for (;;) {
      const out = ensureCustomerNext(state, event)
      if (isErrorResult(out)) {
        const details = (out as { details?: unknown }).details
        throw new SolvaPayError(typeof details === 'string' && details ? details : out.error)
      }
      if (typeof out !== 'object' || out === null || !('action' in out) || !('state' in out)) {
        throw new SolvaPayError('ensure_customer_next returned unexpected value')
      }
      const result = out as {
        state: unknown
        action: {
          kind: string
          key?: string
          byExternalRef?: string
          byEmail?: string
          params?: Record<string, unknown>
          customerRef?: string
          patch?: Record<string, unknown>
          backendRef?: string
          cache?: { key: string; backendRef: string; timestampMs: number }
        }
      }
      state = result.state
      const action = result.action
      if (action.kind === 'readCustomerCache') {
        const cached = this.customerCache.get(String(action.key))
        const nowMs = Date.now()
        event = cached
          ? {
              kind: 'customerCacheEntry',
              found: true,
              backendRef: cached.backendRef,
              timestampMs: cached.timestampMs,
              nowMs,
            }
          : { kind: 'customerCacheEntry', found: false, nowMs }
        continue
      }
      if (action.kind === 'getCustomer') {
        const params = action.byExternalRef
          ? { externalRef: String(action.byExternalRef) }
          : { email: String(action.byEmail) }
        try {
          const customer = await this.apiClient.getCustomer(params)
          const found = Boolean(customer?.customerRef)
          event = found
            ? { kind: 'customerLookupResult', found: true, customer, nowMs: Date.now() }
            : { kind: 'customerLookupResult', found: false, nowMs: Date.now() }
        } catch (error) {
          event = {
            kind: 'customerLookupResult',
            found: false,
            errorMessage: error instanceof Error ? error.message : String(error),
            nowMs: Date.now(),
          }
        }
        continue
      }
      if (action.kind === 'createCustomer') {
        if (!this.apiClient.createCustomer) {
          throw new SolvaPayError(
            `ensure_customer_next createCustomer is not available for ${customerRef}`,
          )
        }
        try {
          const customer = await this.apiClient.createCustomer(
            // Driver-built CreateCustomerParams matches the public request body.
            action.params as Parameters<NonNullable<SolvaPayClient['createCustomer']>>[0],
          )
          event = { kind: 'customerCreateResult', ok: true, customer, nowMs: Date.now() }
        } catch (error) {
          event = {
            kind: 'customerCreateResult',
            ok: false,
            errorMessage: error instanceof Error ? error.message : String(error),
            nowMs: Date.now(),
          }
        }
        continue
      }
      if (action.kind === 'updateCustomer') {
        try {
          if (!this.apiClient.updateCustomer) {
            throw new Error('updateCustomer is not available')
          }
          await this.apiClient.updateCustomer(String(action.customerRef), action.patch ?? {})
          event = { kind: 'customerUpdateResult', ok: true, nowMs: Date.now() }
        } catch (error) {
          event = {
            kind: 'customerUpdateResult',
            ok: false,
            errorMessage: error instanceof Error ? error.message : String(error),
            nowMs: Date.now(),
          }
        }
        continue
      }
      if (action.kind === 'resolved') {
        if (action.cache) {
          this.customerCache.set(action.cache.key, {
            backendRef: action.cache.backendRef,
            timestampMs: action.cache.timestampMs,
          })
        }
        if (typeof action.backendRef !== 'string' || action.backendRef.length === 0) {
          throw new SolvaPayError('ensure_customer_next resolved without backendRef')
        }
        return action.backendRef
      }
      throw new SolvaPayError(`ensure_customer_next unknown action: ${action.kind}`)
    }
  }

  private async emitHandlerUsage(
    driverState: unknown,
    event: Record<string, unknown>,
  ): Promise<void> {
    const out = gateNext(driverState, event) as { action: GateAction }
    if (out.action.kind === 'skipUsage') {
      return
    }
    if (out.action.kind !== 'emitUsage') {
      throw new SolvaPayError(
        `gate_next handler event returned unexpected action: ${out.action.kind}`,
      )
    }
    await this.postUsageRequest(out.action.request)
  }

  private async postUsageRequest(request: unknown): Promise<void> {
    if (!isTrackUsageRequest(request)) {
      throw new SolvaPayError('gate_next usage request is missing customerRef')
    }
    await trackUsageWithRetry(req => this.apiClient.trackUsage(req), request)
  }
}

function isTrackUsageRequest(value: unknown): value is TrackUsageRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { customerRef?: unknown }).customerRef === 'string'
  )
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

  function createHttpHandler(
    methodOrMetadata: ((...args: unknown[]) => unknown) | PaywallMetadata,
    handlerOrOptions?:
      | ((args: PaywallArgs) => Promise<unknown>)
      | {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          extractArgs?: (req: any) => Record<string, unknown>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          transformResponse?: (result: unknown, reply: any) => unknown
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getCustomerRef?: (req: any) => string
        },
  ) {
    if (typeof methodOrMetadata === 'function') {
      const method = methodOrMetadata
      const metadata = (method as unknown as Record<string, unknown>)
        ._paywallMetadata as PaywallMetadata
      const options = handlerOrOptions as Record<string, unknown>

      if (!metadata) {
        throw new Error('Method must be decorated with @Paywall')
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return async (req: any, reply: any) => {
        try {
          const extractArgs =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (options?.extractArgs as (req: any) => PaywallArgs) || defaultExtractArgs
          const getCustomerRef =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (options?.getCustomerRef as (req: any) => string) ||
            ((req: Record<string, unknown>) =>
              (req.auth as Record<string, string>)?.customer_ref || 'anonymous')

          const args = extractArgs(req)
          const protectedMethod = await paywall.protect(
            method as unknown as (args: PaywallArgs) => Promise<unknown>,
            metadata,
            getCustomerRef,
          )
          const result = await protectedMethod(args)

          const transformResponse =
            (options?.transformResponse as (result: unknown, reply: unknown) => unknown) ||
            ((result: unknown) => result)
          return transformResponse(result, reply)
        } catch (error) {
          return handleHttpError(error, reply)
        }
      }
    }

    const metadata = methodOrMetadata
    const handler = handlerOrOptions as (args: PaywallArgs) => Promise<unknown>

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (req: any, reply: any) => {
      try {
        const args = defaultExtractArgs(req)
        const getCustomerRef = (args: PaywallArgs) => args.auth?.customer_ref || 'anonymous'

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
              isError: false,
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

  function createNextHandler(
    metadata: PaywallMetadata,
    handler: (args: PaywallArgs) => Promise<unknown>,
    options?: {
      extractArgs?: (
        request: Request,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        context?: any,
      ) => Promise<Record<string, unknown>> | Record<string, unknown>
      getCustomerRef?: (request: Request) => Promise<string> | string
      transformResponse?: (result: unknown) => unknown
    },
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (request: Request, context?: any) => {
      try {
        const extractArgs = options?.extractArgs || defaultExtractNextArgs
        const getCustomerRef = options?.getCustomerRef || defaultGetCustomerRef
        const transformResponse = options?.transformResponse || ((result: unknown) => result)

        const args = await extractArgs(request, context)
        const customerRef = await getCustomerRef(request)

        args.auth = { customer_ref: customerRef }

        const protectedHandler = await paywall.protect(
          handler,
          metadata,
          (args: PaywallArgs) => args.auth?.customer_ref || 'anonymous',
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defaultExtractArgs(req: any): PaywallArgs {
  return {
    ...((req.body as object) || {}),
    ...((req.params as object) || {}),
    ...((req.query as object) || {}),
    auth: { customer_ref: req.headers?.['x-customer-ref'] || req.auth?.customer_ref },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleHttpError(error: unknown, reply: any) {
  const classified = classifyPaywallHttpError(error)
  const body =
    error instanceof PaywallError ? paywallErrorToClientPayload(error) : classified.body

  if (reply && reply.status && typeof reply.json === 'function') {
    reply.status(classified.status).json(body)
    return
  }
  if (reply && reply.code) {
    reply.code(classified.status)
  }
  return body
}

// Next.js helper functions
async function defaultExtractNextArgs(
  request: Request,
  context?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
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

  let routeParams: Record<string, unknown> = {}
  if (context?.params) {
    const params = context.params
    if (typeof params === 'object' && params !== null && 'then' in params) {
      routeParams = (await (params as Promise<Record<string, unknown>>)) || {}
    } else {
      routeParams = (params as Record<string, unknown>) || {}
    }
  }

  return {
    ...(body as Record<string, unknown>),
    ...query,
    ...routeParams,
  }
}

async function defaultGetCustomerRef(request: Request): Promise<string> {
  let verifiedJwtSub: string | undefined
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const { jwtVerify } = await import('jose')
      const token = authHeader.substring(7)
      const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!)
      const { payload } = await jwtVerify(token, jwtSecret, {
        issuer: process.env.OAUTH_ISSUER!,
        audience: process.env.OAUTH_CLIENT_ID || 'test-client-id',
      })
      if (typeof payload.sub === 'string' && payload.sub.trim()) {
        verifiedJwtSub = payload.sub
      }
    } catch {
      // Unverified tokens do not contribute a subject.
    }
  }

  return resolveCustomerRef(
    undefined,
    verifiedJwtSub,
    undefined,
    request.headers.get('x-customer-ref') ?? undefined,
    undefined,
    undefined,
    undefined,
  )
}

export function ensureCustomerRef(customerRef: string): string {
  // Ensure customer ref is properly formatted
  // Return customer ref as-is (preserve UUIDs with hyphens, etc.)
  if (!customerRef || customerRef === 'anonymous') {
    return 'anonymous'
  }
  return customerRef
}

function classifyPaywallHttpError(error: unknown): {
  status: number
  body: { success: false; error: string }
} {
  if (error instanceof PaywallError) {
    const mapped = mapRouteError({
      kind: 'paywall',
      message: error.message,
      operationName: 'paywall',
    })
    return {
      status: mapped.status,
      body: { success: false, error: mapped.error },
    }
  }
  if (error instanceof SolvaPayError) {
    const mapped = mapRouteError({
      kind: 'solvapay',
      message: error.message,
      status: error.status ?? null,
      operationName: 'paywall',
    })
    return {
      status: mapped.status,
      body: { success: false, error: mapped.error },
    }
  }
  const mapped = mapRouteError({
    kind: error instanceof Error ? 'error' : 'unknown',
    message: error instanceof Error ? error.message : null,
    operationName: 'paywall',
    defaultMessage: 'Internal server error',
  })
  return {
    status: mapped.status,
    body: { success: false, error: mapped.error },
  }
}

function handleNextError(error: unknown): Response {
  const classified = classifyPaywallHttpError(error)
  const body =
    error instanceof PaywallError ? paywallErrorToClientPayload(error) : classified.body
  return new Response(JSON.stringify(body), {
    status: classified.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// All exports are already defined above where each item is declared
