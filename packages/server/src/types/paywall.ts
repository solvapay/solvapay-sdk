/**
 * Paywall Type Definitions
 *
 * Types related to paywall protection, limits, and gating functionality.
 */

import type { components } from './generated'
import type { LimitResponseWithPlan } from './client'

export type LimitPlanSummary = components['schemas']['LimitPlanItemDto']
export type LimitActivationBalance = components['schemas']['LimitBalanceDto']
export type LimitActivationProduct = components['schemas']['LimitProductBriefDto']

/**
 * Arguments passed to protected handlers
 */
export interface PaywallArgs {
  [key: string]: unknown
  auth?: { customer_ref?: string }
}

/**
 * Metadata for configuring paywall protection
 */
export interface PaywallMetadata {
  product?: string
  /** Meter to charge against (defaults to `requests`). */
  meterName?: string
  /**
   * @deprecated Use `meterName`. Still accepted as an alias of the meter name.
   */
  usageType?: string
}

/**
 * Structured content for paywall errors (MCP structuredContent and manual handling).
 */
/**
 * Fields shared by every `PaywallStructuredContent` kind so a text-only
 * host can recover from a gate without a second tool call. Every field
 * other than `kind` / `product` / `checkoutUrl` / `message` is omitted
 * when the backend did not send it — never defaulted.
 */
export type PaywallGateRecoveryFields = {
  /** Active plan reference from `limits.plan`. */
  planRef?: string
  /** Product plans from `checkLimits` (activation already had this). */
  plans?: LimitPlanSummary[]
  /** Meter the gated call was charged against. */
  meterName?: string
  /** Per-unit charge of the active plan, in minor currency units. */
  unitPriceMinor?: number
  /** ISO 4217 currency for `unitPriceMinor`. */
  currency?: string
  /**
   * Included-usage counters. Omitted when `freeUnits` is absent or `0`
   * (the unlimited sentinel) so we never emit misleading zeros.
   */
  included?: {
    total: number
    used: number
    remaining: number
  }
  /** Prepaid credit balance, coalesced from nested or top-level fields. */
  creditBalance?: number
}

export type PaywallStructuredContent =
  | ({
      kind: 'payment_required'
      /** Product ref from paywall metadata (or env default) */
      product: string
      checkoutUrl: string
      message: string
      /**
       * Quota balance at the moment the paywall tripped. Optional so
       * older server versions (pre-balance-on-payment_required) stay
       * compatible; the React `PaywallNotice.Message` prefers this
       * structured data over the raw `message` when available.
       */
      balance?: LimitActivationBalance
      /** Rich product context from checkLimits (name, ref, provider slug/id) */
      productDetails?: LimitActivationProduct
    } & PaywallGateRecoveryFields)
  | ({
      kind: 'activation_required'
      /** Product ref from paywall metadata (or env default) */
      product: string
      message: string
      /**
       * Best URL for completing purchase or confirmation; mirrors confirmationUrl when present.
       */
      checkoutUrl: string
      confirmationUrl?: string
      balance?: LimitActivationBalance
      /** Rich product context from checkLimits (name, ref, provider slug/id) */
      productDetails?: LimitActivationProduct
    } & PaywallGateRecoveryFields)

/**
 * MCP tool result with optional paywall information — structural copy
 * of `PaywallToolResult` from `@solvapay/mcp` kept here to avoid a
 * build-time circular dependency between `@solvapay/server` and
 * `@solvapay/mcp`. Keep in lockstep — a snapshot test in
 * `@solvapay/mcp` guards the shape.
 */
export interface PaywallToolResult {
  content?: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
  structuredContent?: PaywallStructuredContent | Record<string, unknown>
  _meta?: Record<string, unknown>
}

/**
 * Runtime type guard for `PaywallStructuredContent`.
 *
 * Used by the MCP registration layer to detect paywall-shaped tool results
 * coming out of `.mcp()` so it knows whether to attach the `_meta.ui`
 * envelope that tells MCP hosts which UI resource to open.
 *
 * @since 1.0.9
 */
export function isPaywallStructuredContent(value: unknown): value is PaywallStructuredContent {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false
  }
  const kind = (value as { kind?: unknown }).kind
  return kind === 'payment_required' || kind === 'activation_required'
}

/**
 * Discriminated union returned from `paywall.decide(args, metadata)` that
 * surfaces the pre-check outcome as data instead of an exception.
 *
 * Replaces the throw-based `PaywallError` control flow adapters previously
 * relied on: `allow` carries the resolved customer ref + fresh
 * `LimitResponseWithPlan` so the handler can run, while `gate` carries the
 * ready-to-serialise `PaywallStructuredContent` so the adapter's
 * `formatGate` can emit the transport-specific paywall response.
 *
 * The `args` field on `allow` is the same shape passed in — threaded
 * through so callers can hand it directly to the handler without having
 * to hold onto a reference across the call.
 *
 * @since 1.1.0
 */
export type PaywallDecision<T> =
  | {
      outcome: 'allow'
      args: T
      limits: LimitResponseWithPlan
      customerRef: string
      /**
       * Set when access is granted with consequences. `throttled` is
       * `onExceed: throttle` (legacy plans — the builder no longer
       * offers it). `overage` is `onExceed: charge` past the included
       * cap. Absent on a plain allow. Derived from `limits`; not new
       * wire data.
       */
      consequence?: 'throttled' | 'overage'
    }
  | {
      outcome: 'gate'
      gate: PaywallStructuredContent
      /**
       * The `LimitResponseWithPlan` consulted when the gate tripped. May
       * be `null` on degraded paths that couldn't produce a fresh
       * response (defensive — normal flow always populates this).
       */
      limits: LimitResponseWithPlan | null
      customerRef: string
    }
