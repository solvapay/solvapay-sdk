/**
 * Base Adapter Interface
 *
 * Defines the contract for all framework adapters.
 * Each adapter handles extraction, transformation, and formatting for its specific context.
 */

import { PaywallError } from '../paywall'
import type { SolvaPayPaywall } from '../paywall'
import type { PaywallArgs, PaywallMetadata, PaywallStructuredContent } from '../types'

/**
 * Internal key used to forward the framework-specific `extra` bag from
 * `createAdapterHandler` down through `paywall.protect()` into the
 * handler's optional `ProtectHandlerContext.extra`. Kept local to
 * avoid widening the public `PaywallArgs` type.
 */
const EXTRA_FORWARD_KEY = '__solvapayExtra' as const

/**
 * Base adapter interface that all framework adapters implement.
 *
 * `formatGate` is the first-class channel for paywall gate outcomes —
 * adapters emit their framework-specific paywall response (narration +
 * `structuredContent` on MCP, `{success:false, ...}` JSON body + 402 on
 * HTTP/Next) from the typed `PaywallStructuredContent` payload. Custom
 * adapters that predate `formatGate` continue to work: extend
 * `AbstractAdapter` (or supply a stub) and gate outcomes fall back to
 * the legacy `PaywallError` + `formatError` path.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Adapter<TContext = any, TResult = any> {
  /**
   * Extract plain arguments from the framework-specific context
   */
  extractArgs(context: TContext): Promise<Record<string, unknown>> | Record<string, unknown>

  /**
   * Extract customer reference from the context
   */
  getCustomerRef(context: TContext, extra?: unknown): Promise<string> | string

  /**
   * Format the business logic result for the framework
   */
  formatResponse(result: unknown, context: TContext): TResult

  /**
   * Format a paywall gate outcome for the framework. Receives the
   * `PaywallStructuredContent` produced by `paywall.decide()` and
   * returns the transport-specific paywall response.
   */
  formatGate(gate: PaywallStructuredContent, context: TContext): TResult

  /**
   * Format errors for the framework. Genuine uncaught errors only —
   * paywall gate outcomes flow through `formatGate` instead.
   */
  formatError(error: Error, context: TContext): TResult
}

/**
 * Optional abstract base class with a default `formatGate` implementation
 * that wraps the gate in a `PaywallError` and delegates to `formatError`.
 * Exists so third-party adapters that haven't migrated to `formatGate`
 * keep working without manual upgrades — extend `AbstractAdapter` or
 * reimplement the interface directly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export abstract class AbstractAdapter<TContext = any, TResult = any>
  implements Adapter<TContext, TResult>
{
  abstract extractArgs(
    context: TContext,
  ): Promise<Record<string, unknown>> | Record<string, unknown>

  abstract getCustomerRef(context: TContext, extra?: unknown): Promise<string> | string

  abstract formatResponse(result: unknown, context: TContext): TResult

  abstract formatError(error: Error, context: TContext): TResult

  /**
   * Default fallback — wraps the gate in a `PaywallError` and delegates
   * to `formatError`. Lossy on MCP (re-introduces the `{success:false}`
   * JSON blob + `isError:true`) but keeps custom adapters functional.
   * Override with a native implementation for the adapter's framework.
   */
  formatGate(gate: PaywallStructuredContent, context: TContext): TResult {
    return this.formatError(new PaywallError(gate.message, gate), context)
  }
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
      return 'anonymous'
    }

    // Return customer ref as-is (preserve UUIDs with hyphens, etc.)
    return customerRef
  }

  /**
   * Extract customer ref from JWT token
   */
  static async extractFromJWT(
    token: string,
    options?: {
      secret?: string
      issuer?: string
      audience?: string
    },
  ): Promise<string | null> {
    try {
      const { jwtVerify } = await import('jose')
      const jwtSecret = new TextEncoder().encode(
        options?.secret || process.env.OAUTH_JWKS_SECRET || 'test-jwt-secret',
      )

      const { payload } = await jwtVerify(token, jwtSecret, {
        issuer: options?.issuer || process.env.OAUTH_ISSUER || 'http://localhost:3000',
        audience: options?.audience || process.env.OAUTH_CLIENT_ID || 'test-client-id',
      })

      return (payload.sub as string) || null
    } catch {
      // JWT verification failed, return null
      return null
    }
  }
}

/**
 * Create a protected handler using an adapter.
 *
 * Calls `paywall.decide()` first to route gate outcomes through
 * `adapter.formatGate` — no throw-based signalling for the happy path.
 * Gate outcomes emitted from deep merchant code (e.g. `ctx.gate(reason)`
 * that still throws a `PaywallError` during the compat window) are
 * caught at the adapter edge and routed through the same `formatGate`
 * channel so the transport response shape stays consistent.
 *
 * The returned closure caches:
 * - `backendRefCache`: resolved customer ref (input → cus_xxx) so
 *   ensureCustomer is only called once per distinct customer identity.
 */
export async function createAdapterHandler<TContext, TResult>(
  adapter: Adapter<TContext, TResult>,
  paywall: SolvaPayPaywall,
  metadata: PaywallMetadata,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  businessLogic: (args: any, handlerContext?: unknown) => Promise<any>,
): Promise<(context: TContext, extra?: unknown) => Promise<TResult>> {
  const backendRefCache = new Map<string, string>()

  return async (context: TContext, extra?: unknown): Promise<TResult> => {
    let args: Record<string, unknown>
    let customerRef: string
    try {
      args = await adapter.extractArgs(context)
      customerRef = await adapter.getCustomerRef(context, extra)

      let backendRef = backendRefCache.get(customerRef)
      if (!backendRef) {
        backendRef = await paywall.ensureCustomer(customerRef, customerRef)
        backendRefCache.set(customerRef, backendRef)
      }

      args.auth = { customer_ref: backendRef }
    } catch (error) {
      return adapter.formatError(error as Error, context)
    }

    // Pre-check decision. `decide()` handles cache lookup, fresh
    // checkLimits, and emits `trackUsage('paywall', ...)` on gate
    // outcomes — matching the observability contract of the legacy
    // throw-based `protect()` path.
    const decideGetCustomerRef = (args: PaywallArgs) => args.auth?.customer_ref || 'anonymous'
    try {
      const decision = await paywall.decide(args, metadata, decideGetCustomerRef)

      if (decision.outcome === 'gate') {
        return adapter.formatGate(decision.gate, context)
      }

      // Forward the framework-specific `extra` bag through the
      // paywall context so handlers that declare the optional second
      // arg receive it via `ProtectHandlerContext.extra`. Scrubbed
      // before returning so downstream observers see a clean `args`.
      if (extra !== undefined) {
        ;(args as Record<string, unknown>)[EXTRA_FORWARD_KEY] = extra
      }

      try {
        const result = await paywall.runAllow(decision, businessLogic, metadata, args)
        return adapter.formatResponse(result, context)
      } finally {
        if (EXTRA_FORWARD_KEY in args) {
          delete (args as Record<string, unknown>)[EXTRA_FORWARD_KEY]
        }
      }
    } catch (error) {
      // `ctx.gate(reason)` in merchant code still throws `PaywallError`
      // during the compat window; route those through `formatGate` so
      // transport responses keep the new `isError:false` + narration
      // shape even without a merchant migration.
      if (error instanceof PaywallError) {
        return adapter.formatGate(error.structuredContent, context)
      }
      return adapter.formatError(error as Error, context)
    }
  }
}
