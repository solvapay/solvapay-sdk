/**
 * `buildPayableHandler(solvaPay, ctx, handler)` — framework-neutral
 * wrapper that produces an MCP tool handler enforcing the SolvaPay
 * paywall, auto-attaching `_meta.ui` to paywall results, and (when a
 * `buildBootstrap` is provided) embedding the full `BootstrapPayload`
 * in `structuredContent` so the React shell can render the paywall
 * view without a follow-up tool call.
 *
 * Every SolvaPay MCP adapter (`@solvapay/mcp-sdk`, future `mcp-lite` /
 * `fastmcp` adapters) wraps this in its framework-specific
 * `registerTool` / `registerAppTool` call.
 */

import type { PaywallStructuredContent, SolvaPay } from '@solvapay/server'
import { isPaywallStructuredContent } from '@solvapay/server'
import { buildPaywallUiMeta } from './paywall-meta'
import type { BuildBootstrapPayloadFn } from './bootstrap-payload'
import type {
  BootstrapPayload,
  McpToolExtra,
  PaywallToolResult,
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
 * Build a paywall-protected MCP tool handler. Returned function is a
 * `(args, extra) => Promise<SolvaPayCallToolResult>` that any MCP
 * adapter can register directly.
 *
 * The handler:
 *  1. Routes the call through `solvaPay.payable({ product }).mcp(handler)`.
 *  2. Detects paywall results via `isPaywallStructuredContent`.
 *  3. Rewrites `structuredContent` as a full `BootstrapPayload` with
 *     `view: 'paywall'` + the original gate content on `paywall`
 *     (when `buildBootstrap` is provided — otherwise leaves the raw
 *     gate content intact for backwards compatibility).
 *  4. Stamps `_meta.ui = { resourceUri }` so the host knows which UI
 *     resource to open.
 */
export function buildPayableHandler<TArgs extends Record<string, unknown>, TResult>(
  solvaPay: SolvaPay,
  ctx: BuildPayableHandlerContext,
  handler: (args: TArgs, extra?: McpToolExtra) => Promise<TResult>,
): (args: Record<string, unknown>, extra?: McpToolExtra) => Promise<SolvaPayCallToolResult> {
  const { product, resourceUri, buildBootstrap, getCustomerRef } = ctx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const protectedHandler = solvaPay.payable({ product, getCustomerRef }).mcp(handler as any)

  return async (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ): Promise<SolvaPayCallToolResult> => {
    const result = (await protectedHandler(args, extra)) as
      | PaywallToolResult
      | SolvaPayCallToolResult

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
    return result as SolvaPayCallToolResult
  }
}

// Keep the `BootstrapPayload` type in the symbol table of this module so
// consumers that only import the handler don't have to pull the types
// entry point separately.
export type { BootstrapPayload }
