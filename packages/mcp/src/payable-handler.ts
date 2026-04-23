/**
 * `buildPayableHandler(solvaPay, ctx, handler)` — framework-neutral
 * wrapper that produces an MCP tool handler enforcing the SolvaPay
 * paywall, auto-attaching `_meta.ui` to paywall results, and (when a
 * `buildBootstrap` is provided) embedding the full `BootstrapPayload`
 * in `structuredContent` so the React shell can render the paywall
 * view without a follow-up tool call.
 *
 * Merchant handlers receive a `ResponseContext` as their second
 * argument and return the `ResponseResult` envelope produced by
 * `ctx.respond(data, options?)`. `buildPayableHandler` unwraps the
 * envelope — overlaying `options.text` / `options.nudge` and flushing
 * queued `ctx.emit(...)` blocks into the terminal response.
 *
 * Every SolvaPay MCP adapter (`@solvapay/mcp-sdk`, future `mcp-lite` /
 * `fastmcp` adapters) wraps this in its framework-specific
 * `registerTool` / `registerAppTool` call.
 */

import type {
  LimitResponseWithPlan,
  PaywallStructuredContent,
  ProtectHandlerContext,
  SolvaPay,
} from '@solvapay/server'
import { isPaywallStructuredContent } from '@solvapay/server'
import { buildPaywallUiMeta } from './paywall-meta'
import type { BuildBootstrapPayloadFn } from './bootstrap-payload'
import { buildResponseContext } from './response-context'
import { assertResponseResult } from './response-envelope'
import type {
  BootstrapPayload,
  McpToolExtra,
  NudgeSpec,
  PaywallToolResult,
  ResponseContext,
  ResponseResult,
  SolvaPayCallToolResult,
} from './types'

export interface BuildPayableHandlerContext {
  /** SolvaPay product ref the tool is protected against. */
  product: string
  /** UI resource URI the MCP host should open to render the paywall view. */
  resourceUri: string
  /**
   * Builds the full `BootstrapPayload` to embed on paywall results.
   * Wire from `buildSolvaPayDescriptors(...).buildBootstrapPayload`.
   */
  buildBootstrap?: BuildBootstrapPayloadFn
  /**
   * Override customer-ref extraction. Defaults to the MCP adapter's
   * behavior (reads `extra.authInfo.extra.customer_ref`).
   */
  getCustomerRef?: (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ) => string | Promise<string>
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
 *  3. Detects paywall results via `isPaywallStructuredContent`.
 *  4. Rewrites `structuredContent` as a full `BootstrapPayload` with
 *     `view: 'paywall'` + the original gate content on `paywall`
 *     (when `buildBootstrap` is provided — otherwise leaves the raw
 *     gate content intact).
 *  5. Stamps `_meta.ui = { resourceUri }` so the host knows which UI
 *     resource to open.
 *  6. Unwraps the merchant's `ResponseResult` envelope into the
 *     terminal `SolvaPayCallToolResult`: applies `options.text` /
 *     `options.nudge` overlays and flushes `ctx.emit(...)` blocks into
 *     `content[]`.
 *  7. Silently ignores `options.units` (V1 billing stays at one credit
 *     per call; V1.1 will thread it into `trackUsage`).
 */
export function buildPayableHandler<TArgs extends Record<string, unknown>, TResult>(
  solvaPay: SolvaPay,
  ctx: BuildPayableHandlerContext,
  handler: MerchantHandler<TArgs, TResult>,
): (args: Record<string, unknown>, extra?: McpToolExtra) => Promise<SolvaPayCallToolResult> {
  const { product, resourceUri, buildBootstrap, getCustomerRef } = ctx

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const protectedHandler = solvaPay
    .payable({ product, getCustomerRef })
    .mcp(wrappedBusinessLogic as any)

  return async (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ): Promise<SolvaPayCallToolResult> => {
    const result = (await protectedHandler(args, extra)) as
      | PaywallToolResult
      | SolvaPayCallToolResult

    // ——————————————————————————————————————————————————————————————
    // Paywall branch.
    // ——————————————————————————————————————————————————————————————
    if (result.isError && isPaywallStructuredContent(result.structuredContent)) {
      const existingMeta =
        typeof (result as PaywallToolResult)._meta === 'object' &&
        (result as PaywallToolResult)._meta !== null
          ? ((result as PaywallToolResult)._meta as Record<string, unknown>)
          : {}

      const gateContent = result.structuredContent as PaywallStructuredContent
      const structuredContent = buildBootstrap
        ? ((await buildBootstrap('paywall', extra, {
            paywall: gateContent,
          })) as unknown as Record<string, unknown>)
        : (result.structuredContent as unknown as Record<string, unknown>)

      return {
        ...(result as SolvaPayCallToolResult),
        structuredContent,
        _meta: {
          ...existingMeta,
          ...buildPaywallUiMeta({ resourceUri }),
        },
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
    return unwrapResponseEnvelope(
      result as SolvaPayCallToolResult,
      envelope,
      resourceUri,
      buildBootstrap,
      extra,
    )
  }
}

/**
 * Apply `options.text` / `options.nudge` overlays and flush queued
 * `ctx.emit(...)` blocks into the terminal response. Called only when
 * the merchant returned a `ResponseResult` envelope.
 *
 * When `options.nudge` is present, rewrites `structuredContent` into a
 * full `BootstrapPayload` with `view: 'nudge'` (mirroring the
 * paywall-branch pattern) so the React shell opens `McpNudgeView`
 * and renders the merchant `data` alongside `McpUpsellStrip`.
 */
async function unwrapResponseEnvelope(
  adapterResult: SolvaPayCallToolResult,
  envelope: ResponseResult<unknown>,
  resourceUri: string,
  buildBootstrap: BuildBootstrapPayloadFn | undefined,
  extra: McpToolExtra | undefined,
): Promise<SolvaPayCallToolResult> {
  const { data, options, emittedBlocks } = envelope
  const textOverride = options?.text
  const nudge = options?.nudge

  // `content[0].text` — narrator override via `options.text`, otherwise
  // the existing JSON-serialised merchant data. V1.1 may introduce a
  // merchant-data narrator; V1 keeps the current behaviour.
  const primaryText =
    typeof textOverride === 'string' ? textOverride : JSON.stringify(data)

  const content: SolvaPayCallToolResult['content'] = [
    ...((emittedBlocks ?? []) as SolvaPayCallToolResult['content']),
    { type: 'text', text: primaryText },
  ]

  // `options.units` is intentionally ignored — V1 billing stays at one
  // credit per call. V1.1: thread `options.units` into `trackUsage` at
  // `paywall.ts`'s success-path invocation site (blocked on backend +
  // product work per ctx-respond-v1 spec).

  const existingMeta =
    typeof adapterResult._meta === 'object' && adapterResult._meta !== null
      ? (adapterResult._meta as Record<string, unknown>)
      : {}

  if (nudge) {
    // Mirror the paywall branch: when a bootstrap builder is wired,
    // embed the full `BootstrapPayload` so the React shell can render
    // `view: 'nudge'` without a follow-up tool call.
    const structuredContent = buildBootstrap
      ? ({
          ...((await buildBootstrap('nudge', extra)) as unknown as Record<string, unknown>),
          nudge,
          data,
        } as Record<string, unknown>)
      : (data as Record<string, unknown>)

    return {
      ...adapterResult,
      content,
      structuredContent,
      _meta: {
        ...existingMeta,
        ...buildNudgeUiMeta({ resourceUri, nudge }),
      },
    }
  }

  return {
    ...adapterResult,
    content,
    structuredContent: data as Record<string, unknown>,
    ...(Object.keys(existingMeta).length > 0 ? { _meta: existingMeta } : {}),
  }
}

/**
 * Stamp `_meta.ui = { resourceUri, nudge }` on success responses
 * carrying an upsell nudge. Mirrors `buildPaywallUiMeta` — the shell
 * opens the same UI resource and reads `nudge` off structured content
 * or `_meta.ui` to render `McpUpsellStrip` (V1.1 may converge on a
 * single canonical location).
 */
function buildNudgeUiMeta(input: { resourceUri: string; nudge: NudgeSpec }): {
  ui: { resourceUri: string; nudge: NudgeSpec }
} {
  return { ui: { resourceUri: input.resourceUri, nudge: input.nudge } }
}

// Keep the `BootstrapPayload` type in the symbol table of this module so
// consumers that only import the handler don't have to pull the types
// entry point separately.
export type { BootstrapPayload }
