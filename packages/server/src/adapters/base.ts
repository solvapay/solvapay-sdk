/**
 * Base Adapter Interface
 *
 * Defines the contract for all framework adapters.
 * Each adapter handles extraction, transformation, and formatting for its specific context.
 */

import { SolvaPayError } from '@solvapay/core'
import { PaywallError } from '../paywall'
import { identityLabel, type RequestIdentity } from '../request-identity'
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
   * Who the request is for, when the adapter can tell a verified user (looked
   * up by `externalRef`) from a named customer. Used instead of
   * `getCustomerRef` when present.
   */
  getIdentity?(context: TContext, extra?: unknown): Promise<RequestIdentity>

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
export abstract class AbstractAdapter<TContext = any, TResult = any> implements Adapter<
  TContext,
  TResult
> {
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
   * The subject of a JWT signed with `options.secret` (else `OAUTH_JWKS_SECRET`),
   * or null when the token doesn't verify.
   *
   * @deprecated The built-in adapters verify tokens with `verifyBearerToken`
   * from `@solvapay/auth`. This one checks issuer and audience only when they
   * are given (`options`, else `OAUTH_ISSUER` / `OAUTH_CLIENT_ID`).
   * @throws {SolvaPayError} When no secret is configured: there is no default.
   */
  static async extractFromJWT(
    token: string,
    options?: {
      secret?: string
      issuer?: string
      audience?: string
    },
  ): Promise<string | null> {
    const secret = options?.secret || process.env.OAUTH_JWKS_SECRET
    if (!secret) {
      throw new SolvaPayError(
        'extractFromJWT needs a secret: pass options.secret or set OAUTH_JWKS_SECRET',
      )
    }
    const issuer = options?.issuer || process.env.OAUTH_ISSUER
    const audience = options?.audience || process.env.OAUTH_CLIENT_ID
    const { jwtVerify } = await import('jose')
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        ...(issuer ? { issuer } : {}),
        ...(audience ? { audience } : {}),
      })
      return typeof payload.sub === 'string' && payload.sub ? payload.sub : null
    } catch {
      // The token didn't verify: it names no one.
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
    try {
      args = await adapter.extractArgs(context)
      const identity: RequestIdentity = adapter.getIdentity
        ? await adapter.getIdentity(context, extra)
        : { kind: 'customer', customerRef: await adapter.getCustomerRef(context, extra) }
      // Users and named customers are cached apart: a user id that looks
      // like a customer ref must never reach that customer.
      const cacheKey =
        identity.kind === 'user' ? `user:${identity.userId}` : `ref:${identityLabel(identity)}`

      let backendRef = backendRefCache.get(cacheKey)
      if (!backendRef) {
        backendRef =
          identity.kind === 'user'
            ? await paywall.ensureCustomerForUser(identity.userId, {
                email: identity.email,
                name: identity.name,
              })
            : identity.kind === 'anonymous'
              ? 'anonymous'
              : await paywall.ensureCustomer(identity.customerRef, identity.customerRef)
        backendRefCache.set(cacheKey, backendRef)
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
