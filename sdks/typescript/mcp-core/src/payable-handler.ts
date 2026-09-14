/**
 * `buildPayableHandler(solvaPay, ctx, handler)` — framework-neutral
 * wrapper that produces an MCP tool handler enforcing the SolvaPay
 * paywall via the shared Rust `invokePayableNext` driver.
 */

import type { LimitResponseWithPlan, PaywallArgs, SolvaPay } from '@solvapay/server'
import { isPaywallStructuredContent, PaywallError } from '@solvapay/server'
import { runGeneratedPayableLoop } from './drivers.generated'
import { defaultGetCustomerRef } from './helpers'
import { assertResponseResult, callMcpSyncOp, invokePayableNext } from './native-mcp'
import { buildResponseContext } from './response-context'
import type {
  BootstrapPayload,
  McpToolExtra,
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
   * branch.
   *
   * @deprecated No longer called by `buildPayableHandler`.
   */
  buildBootstrap?: (view: string, extra?: McpToolExtra) => Promise<BootstrapPayload>
  /**
   * Override customer-ref extraction. Defaults to the MCP adapter's
   * behavior (reads `extra.http.authInfo.extra.customer_ref`, falling
   * back to the SDK v1 flat `extra.authInfo`).
   */
  getCustomerRef?: (args: Record<string, unknown>, extra?: McpToolExtra) => string | Promise<string>
  /**
   * Usage meter name forwarded to `trackUsage.metadata.action`.
   * Defaults to `'requests'`.
   */
  usageType?: string
}

type MerchantHandler<TArgs, TResult> = (
  args: TArgs,
  ctx: ResponseContext,
) => Promise<ResponseResult<TResult>>

type InvokeAction = {
  kind?: unknown
  customerRef?: unknown
  product?: unknown
  usageType?: unknown
  limits?: unknown
  result?: unknown
  track?: { outcome?: unknown; durationMs?: unknown; request?: unknown } | null
  gate?: unknown
  message?: unknown
}

function nowMs(): number {
  return Date.now()
}

function resolveUsageType(usageType: string | undefined): string {
  return typeof usageType === 'string' && usageType.trim() !== '' ? usageType.trim() : 'requests'
}

async function resolvePayableCustomerRef(
  args: Record<string, unknown>,
  extra: McpToolExtra | undefined,
  getCustomerRef: BuildPayableHandlerContext['getCustomerRef'],
): Promise<string> {
  let hookRef: string | undefined
  if (getCustomerRef) {
    const resolved = await getCustomerRef(args, extra)
    if (typeof resolved === 'string' && resolved.trim()) {
      hookRef = resolved.trim()
    }
  }
  const auth = args.auth
  const argsAuth =
    auth && typeof auth === 'object' && 'customer_ref' in auth
      ? (auth as { customer_ref?: unknown }).customer_ref
      : undefined
  return callMcpSyncOp('resolveCustomerRef', {
    ...(hookRef !== undefined ? { hookRef } : {}),
    ...(defaultGetCustomerRef(extra) !== null
      ? { mcpExtraCustomerRef: defaultGetCustomerRef(extra) }
      : {}),
    ...(typeof argsAuth === 'string' ? { argsAuthCustomerRef: argsAuth } : {}),
    ...(typeof args.customer_ref === 'string' ? { argsCustomerRef: args.customer_ref } : {}),
  })
}

/**
 * Build a paywall-protected MCP tool handler.
 */
export function buildPayableHandler<TArgs extends Record<string, unknown>, TResult>(
  solvaPay: SolvaPay,
  ctx: BuildPayableHandlerContext,
  handler: MerchantHandler<TArgs, TResult>,
): (args: Record<string, unknown>, extra?: McpToolExtra) => Promise<SolvaPayCallToolResult> {
  const { product, getCustomerRef } = ctx
  const usageType = resolveUsageType(ctx.usageType)

  return async (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ): Promise<SolvaPayCallToolResult> => {
    const customerRef = await resolvePayableCustomerRef(args, extra, getCustomerRef)
    const result = await runGeneratedPayableLoop(
      (state, event) => {
        const out = invokePayableNext(state, event)
        const action = out.action as InvokeAction | undefined
        if (action == null || typeof action.kind !== 'string') {
          throw new Error('invokePayableNext returned no action')
        }
        return { state: out.state, action: action as { kind: string; [key: string]: unknown } }
      },
      {
        nowMs,
        randomUnit: () => Math.random(),
        runGate: async action => {
          const decision = await solvaPay.paywall.decide(
            { auth: { customer_ref: String(action.customerRef ?? customerRef) } } as PaywallArgs,
            { product: String(action.product ?? product) },
          )
          if (decision.outcome === 'gate') {
            return { kind: 'paywall', gate: decision.gate, message: decision.gate.message }
          }
          return {
            kind: 'allow',
            customerRef: decision.customerRef,
            limits: decision.limits,
          }
        },
        invokeHandler: async action => {
          const limits = (action.limits ?? null) as LimitResponseWithPlan | null
          const { ctx: responseCtx } = buildResponseContext({
            customerRef: String(action.customerRef),
            limits,
            product,
            solvaPay,
          })
          try {
            const returned = await handler(args as TArgs, responseCtx)
            return { kind: 'ok', envelope: assertResponseResult(returned) }
          } catch (err) {
            if (err instanceof PaywallError) {
              return {
                kind: 'paywall',
                gate: err.structuredContent,
                message: err.message,
              }
            }
            const message = err instanceof Error ? err.message : String(err)
            if (message.includes('registerPayable handler returned a raw value')) {
              return { kind: 'fatal', error: err instanceof Error ? err : new Error(message) }
            }
            return { kind: 'err', message }
          }
        },
        trackUsage: async request => {
          await solvaPay.apiClient.trackUsage(
            request as Parameters<SolvaPay['apiClient']['trackUsage']>[0],
          )
        },
      },
      {
        kind: 'start',
        customerRef,
        product,
        usageType,
        startedMs: nowMs(),
      },
    )
    const toolResult = result as SolvaPayCallToolResult
    if (isPaywallStructuredContent(toolResult.structuredContent)) {
      return { ...toolResult, isError: false }
    }
    return toolResult
  }
}

export type { BootstrapPayload }
