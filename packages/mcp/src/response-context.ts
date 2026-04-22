/**
 * `buildResponseContext(...)` — constructs the `ResponseContext` object
 * merchant handlers receive as their second argument when they opt
 * into the V1 `ctx.respond()` API.
 *
 * The V1 surface (`customer`, `product`, `respond`, `gate`) is fully
 * functional. The reserved surface (`emit`, `progress`, `progressRaw`,
 * `signal`) ships as no-op / queue-only stubs so merchants can write
 * forward-compatible handlers today; real implementations land in V1.1.
 */

import type {
  LimitResponseWithPlan,
  PaywallStructuredContent,
  SolvaPay,
} from '@solvapay/server'
import { PaywallError } from '@solvapay/server'
import { makeResponseResult } from './response-envelope'
import type {
  BootstrapPlan,
  BootstrapProduct,
  ContentBlock,
  CustomerSnapshot,
  ResponseContext,
  ResponseOptions,
  ResponseResult,
} from './types'

export interface BuildResponseContextParams {
  /** Resolved backend customer ref (`cus_...`). */
  customerRef: string
  /**
   * Pre-check `LimitResponseWithPlan` threaded through from
   * `paywall.protect`. `null` in degraded modes.
   */
  limits: LimitResponseWithPlan | null
  /** SolvaPay product ref the tool is protected against. */
  product: string
  /**
   * Product projection from the bootstrap payload, if available. The
   * bootstrap is not fetched for successful handler calls (that would
   * violate the spec's "zero additional fetch cost" guarantee); adapters
   * may pass a cached projection if they happen to have one.
   */
  bootstrapProduct?: BootstrapProduct | null
  /**
   * Active plan projection from the bootstrap payload's purchase
   * snapshot. Optional; when not passed, a minimal stub is synthesised
   * from `limits.plan`.
   */
  bootstrapPlan?: BootstrapPlan | null
  /** SolvaPay instance used for `ctx.customer.fresh()` round-trips. */
  solvaPay: SolvaPay
}

/**
 * Synthesize a minimal `BootstrapPlan` from `LimitResponseWithPlan.plan`
 * (a plan-ref string). Fall-back path when the caller hasn't threaded
 * a richer bootstrap plan projection through.
 */
function synthesizePlanStub(limits: LimitResponseWithPlan | null): BootstrapPlan | null {
  if (!limits?.plan) return null
  // Only `.reference` is guaranteed meaningful. Remaining fields cast
  // through `BootstrapPlan` to stay structurally compatible.
  return { reference: limits.plan } as unknown as BootstrapPlan
}

/**
 * Map a `LimitResponseWithPlan` plus its bootstrap plan projection into
 * a `CustomerSnapshot`. Extracted so `ctx.customer.fresh()` can
 * reconstruct a snapshot from a freshly-fetched `LimitResponseWithPlan`.
 */
function snapshotFromLimits(params: {
  customerRef: string
  limits: LimitResponseWithPlan | null
  plan: BootstrapPlan | null
  refresh: () => Promise<CustomerSnapshot>
}): CustomerSnapshot {
  const { customerRef, limits, plan, refresh } = params
  return {
    ref: customerRef,
    balance: limits?.creditBalance ?? 0,
    remaining: limits?.remaining ?? null,
    withinLimits: limits?.withinLimits ?? true,
    plan,
    fresh: refresh,
  }
}

export interface BuildResponseContextResult {
  ctx: ResponseContext
  /**
   * Shared mutable array backing `ctx.emit(...)`. Flushed into
   * `content[]` by `buildPayableHandler` when the terminal `respond()`
   * envelope is unwrapped.
   */
  emittedBlocks: ContentBlock[]
}

/**
 * Build the `ResponseContext` plus an out-of-band handle on the
 * `emittedBlocks` buffer so the caller can flush queued blocks at
 * respond time.
 */
export function buildResponseContext(
  params: BuildResponseContextParams,
): BuildResponseContextResult {
  const { customerRef, limits, product, bootstrapProduct, solvaPay } = params

  // Resolve `bootstrapPlan`: caller-provided projection wins; otherwise
  // synthesize a minimal plan stub from `limits.plan` (the plan ref
  // string) so `ctx.customer.plan` is non-null for customers with an
  // active plan. The stub carries only `.reference`; merchants
  // consuming richer fields should fetch from their own bootstrap.
  const bootstrapPlan: BootstrapPlan | null =
    params.bootstrapPlan ?? synthesizePlanStub(limits)

  const emittedBlocks: ContentBlock[] = []
  const abortController = new AbortController()

  // Recursive: `fresh()` calls `checkLimits` and returns a new snapshot
  // whose `.fresh()` is bound to the same function, so merchants can
  // chain `ctx.customer.fresh().then(c => c.fresh())` if they really
  // want.
  const freshSnapshot = async (): Promise<CustomerSnapshot> => {
    const freshLimits = await solvaPay.checkLimits({
      customerRef,
      productRef: product,
      meterName: 'requests',
    })
    // `solvaPay.checkLimits` returns a narrower shape than
    // `LimitResponseWithPlan` (no `plan` object, no `product` block).
    // Cast is safe: `CustomerSnapshot` only reads `creditBalance`,
    // `remaining`, `withinLimits` — all present on the narrower shape.
    return snapshotFromLimits({
      customerRef,
      limits: freshLimits as unknown as LimitResponseWithPlan,
      plan: bootstrapPlan,
      refresh: freshSnapshot,
    })
  }

  const customer = snapshotFromLimits({
    customerRef,
    limits,
    plan: bootstrapPlan,
    refresh: freshSnapshot,
  })

  // When bootstrap is unavailable, fall back to a minimal stub so
  // `ctx.product.reference` still works. Merchants shouldn't rely on
  // the richer fields unless bootstrap is wired (which it is in every
  // shipped adapter).
  const product_: BootstrapProduct =
    bootstrapProduct ??
    ({
      reference: product,
      name: product,
    } as unknown as BootstrapProduct)

  function respond<TData>(data: TData): ResponseResult<TData>
  function respond<TData>(data: TData, options: ResponseOptions): ResponseResult<TData>
  function respond<TData>(data: TData, options?: ResponseOptions): ResponseResult<TData> {
    return makeResponseResult(data, options, emittedBlocks)
  }

  function gate(reason?: string): never {
    const message = reason ?? 'Payment required'
    const structuredContent: PaywallStructuredContent = {
      kind: 'payment_required',
      product,
      checkoutUrl: '',
      message,
    }
    throw new PaywallError(message, structuredContent)
  }

  const ctx: ResponseContext = {
    customer,
    product: product_,
    respond,
    gate,

    // ——————————————————————————————————————————————————————————————
    // Reserved surface — V1 stubs, V1.1 real.
    // ——————————————————————————————————————————————————————————————

    emit: async (block: ContentBlock) => {
      emittedBlocks.push(block)
    },

    progress: async () => {
      // V1.1: thread progressToken from request `_meta` and emit
      // `notifications/progress`.
    },

    progressRaw: async () => {
      // V1.1: thread progressToken and emit raw progress/total.
    },

    signal: abortController.signal,
  }

  return { ctx, emittedBlocks }
}
