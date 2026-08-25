/**
 * `buildPayableHandler(solvaPay, ctx, handler)` — framework-neutral
 * wrapper that produces an MCP tool handler enforcing the SolvaPay
 * paywall.
 *
 * Merchant handlers receive a `ResponseContext` as their second
 * argument and return the `ResponseResult` envelope produced by
 * `ctx.respond(data, options?)`. `buildPayableHandler` unwraps the
 * envelope and — for text-only paywall / nudge responses — ships
 * a clean narration + structuredContent pair without routing through
 * any widget iframe.
 *
 * Per SEP-1865 / MCP Apps (2026-01-26), the widget iframe for payable
 * data tools has been deprecated outright: merchant-registered
 * paywalled tools no longer advertise `_meta.ui.resourceUri` at the
 * descriptor level, so hosts never open an uninvited iframe on a
 * successful tool call. Paywall / nudge / activation responses are
 * plain text narrations naming the recovery intent tool (`upgrade` /
 * `topup` / `activate_plan`) and inlining `gate.checkoutUrl` for
 * terminal-only hosts.
 *
 * The widget iframe is reserved for the three SolvaPay intent tools
 * (`upgrade`, `manage_account`, `topup`) where the user deliberately
 * asked for a checkout UI.
 *
 * Every SolvaPay MCP adapter (`@solvapay/mcp`, future `fastmcp`
 * adapters) wraps this in its framework-specific `registerTool` /
 * `registerAppTool` call.
 */

import type { LimitResponseWithPlan, ProtectHandlerContext, SolvaPay } from '@solvapay/server'
import { isPaywallStructuredContent } from '@solvapay/server'
import { buildPayableToolResult } from './native-mcp'
import type { BuildBootstrapPayloadFn } from './bootstrap-payload'
import { buildResponseContext } from './response-context'
import { assertResponseResult } from './response-envelope'
import type {
  BootstrapPayload,
  McpToolExtra,
  PaywallToolResult,
  ResponseContext,
  ResponseResult,
  SolvaPayCallToolResult,
} from './types'

export interface BuildPayableHandlerContext {
  /** SolvaPay product ref the tool is protected against. */
  product: string
  /**
   * Builds the full `BootstrapPayload`. Still accepted on the context
   * for intent-tool reuse, but NO LONGER consumed by the payable
   * branch: merchant paywall / nudge responses are text-only now. A
   * future intent-tool helper may re-use this hook; leaving it on the
   * type preserves compat for direct callers (`registerPayableTool`).
   *
   * @deprecated No longer called by `buildPayableHandler`. Kept on the
   * context for backwards compatibility with callers that pass it
   * through a bound helper (e.g. `registerPayable`).
   */
  buildBootstrap?: BuildBootstrapPayloadFn
  /**
   * Override customer-ref extraction. Defaults to the MCP adapter's
   * behavior (reads `extra.http.authInfo.extra.customer_ref`, falling
   * back to the SDK v1 flat `extra.authInfo`).
   */
  getCustomerRef?: (args: Record<string, unknown>, extra?: McpToolExtra) => string | Promise<string>
}

/**
 * Merchant handler contract: `(args, ctx) => ctx.respond(data, options?)`.
 * `buildPayableHandler` unwraps the returned `ResponseResult` envelope
 * into the adapter-facing `SolvaPayCallToolResult`.
 */
type MerchantHandler<TArgs, TResult> = (
  args: TArgs,
  ctx: ResponseContext,
) => Promise<ResponseResult<TResult>>

/**
 * Build a paywall-protected MCP tool handler. Returned function is a
 * `(args, extra) => Promise<SolvaPayCallToolResult>` that any MCP
 * adapter can register directly.
 *
 * The handler:
 *  1. Builds a `ResponseContext` from the pre-check `LimitResponseWithPlan`
 *     and passes it as the second arg to the merchant handler.
 *  2. Routes the call through `solvaPay.payable({ product }).mcp(wrappedBusinessLogic)`.
 *  3. Detects paywall results via `isPaywallStructuredContent` and
 *     ships them verbatim — the adapter's `formatGate` already
 *     produced the clean `{ isError: false, content[0].text =
 *     gate.message, structuredContent = gate }` shape.
 *  4. Unwraps the merchant's `ResponseResult` envelope into the
 *     terminal `SolvaPayCallToolResult`: applies `options.text` /
 *     `options.nudge` (as a text suffix) and flushes `ctx.emit(...)`
 *     blocks into `content[]`.
 *  5. Silently ignores `options.units` (V1 billing stays at one usage
 *     unit per call; credit debit = units × plan.creditsPerUnit).
 */
export function buildPayableHandler<TArgs extends Record<string, unknown>, TResult>(
  solvaPay: SolvaPay,
  ctx: BuildPayableHandlerContext,
  handler: MerchantHandler<TArgs, TResult>,
): (args: Record<string, unknown>, extra?: McpToolExtra) => Promise<SolvaPayCallToolResult> {
  const { product, getCustomerRef } = ctx

  // The business logic passed to `.mcp(...)` is called by
  // `paywall.protect` with `(args, handlerContext)`. We close over
  // `solvaPay` + `product` to construct the merchant-facing
  // `ResponseContext` and invoke the merchant handler.
  const wrappedBusinessLogic = async (
    args: Record<string, unknown>,
    handlerContext?: ProtectHandlerContext,
  ): Promise<ResponseResult<TResult>> => {
    const limits: LimitResponseWithPlan | null = handlerContext?.limits ?? null
    const customerRef = handlerContext?.customerRef ?? ''

    const { ctx: responseCtx } = buildResponseContext({
      customerRef,
      limits,
      product,
      solvaPay,
    })

    return handler(args as TArgs, responseCtx)
  }

  const protectedHandler = solvaPay
    .payable({ product, getCustomerRef })
    .mcp(wrappedBusinessLogic)

  return async (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ): Promise<SolvaPayCallToolResult> => {
    const result = (await protectedHandler(args, extra)) as
      | PaywallToolResult
      | SolvaPayCallToolResult

    // ——————————————————————————————————————————————————————————————
    // Paywall branch — text-only.
    // ——————————————————————————————————————————————————————————————
    //
    // `McpAdapter.formatGate` already delivers the clean shape
    // (`isError: false`, `content[0].text = gate.message`,
    // `structuredContent = gate`). The server's state engine —
    // `classifyPaywallState` + `buildGateMessage` — produced a
    // narration that names the recovery intent tool (`upgrade` /
    // `topup` / `activate_plan`) and inlines `checkoutUrl` for
    // terminal-only hosts. We ship the result verbatim.
    //
    // `_meta.ui` is intentionally not stamped: merchant payable-tool
    // descriptors no longer advertise `_meta.ui.resourceUri`, so
    // hosts never open an uninvited iframe for a successful data
    // tool (the original "empty MCP App" complaint). The widget
    // iframe is reserved for the three SolvaPay intent tools.
    if (isPaywallStructuredContent(result.structuredContent)) {
      return {
        ...(result as SolvaPayCallToolResult),
        isError: false,
        structuredContent: result.structuredContent as unknown as Record<string, unknown>,
      }
    }

    // ——————————————————————————————————————————————————————————————
    // Error branch — non-paywall errors (thrown `Error`, formatError
    // output) pass through untouched. `structuredContent` here is the
    // adapter's error payload, not a `ResponseResult` envelope.
    // ——————————————————————————————————————————————————————————————
    if (result.isError) {
      return result as SolvaPayCallToolResult
    }

    // ——————————————————————————————————————————————————————————————
    // Success branch — unwrap the `ResponseResult` envelope.
    // ——————————————————————————————————————————————————————————————
    //
    // `assertResponseResult` enforces the invariant that merchants
    // returned via `ctx.respond(...)`. If a handler bypassed the
    // TypeScript contract and returned a raw value, the assertion
    // throws a merchant-actionable error pointing at the fix.
    const envelope = assertResponseResult(result.structuredContent)
    return buildPayableToolResult(envelope)
  }
}

// Keep the `BootstrapPayload` type in the symbol table of this module so
// consumers that only import the handler don't have to pull the types
// entry point separately.
export type { BootstrapPayload }
