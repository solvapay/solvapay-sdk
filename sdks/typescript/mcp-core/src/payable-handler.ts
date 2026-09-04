/**
 * `buildPayableHandler(solvaPay, ctx, handler)` — framework-neutral
 * wrapper that produces an MCP tool handler enforcing the SolvaPay
 * paywall via the shared Rust `invokePayableNext` driver.
 */

import type { LimitResponseWithPlan, PaywallArgs, SolvaPay } from '@solvapay/server'
import { isPaywallStructuredContent, PaywallError } from '@solvapay/server'
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
    let state: unknown = null
    let event: Record<string, unknown> = {
      kind: 'start',
      customerRef,
      product,
      usageType,
      startedMs: nowMs(),
    }
    let allowCustomerRef: string | null = null

    for (;;) {
      const out = invokePayableNext(state, event)
      state = out.state
      const action = out.action as InvokeAction | undefined
      if (action == null || typeof action.kind !== 'string') {
        throw new Error('invokePayableNext returned no action')
      }
      const kind = action.kind
      if (kind === 'runGate') {
        const decision = await solvaPay.paywall.decide(
          { auth: { customer_ref: String(action.customerRef ?? customerRef) } } as PaywallArgs,
          { product: String(action.product ?? product) },
        )
        if (decision.outcome === 'gate') {
          const message =
            decision.gate.kind === 'activation_required'
              ? 'Activation required'
              : 'Payment required'
          event = {
            kind: 'gatePaywall',
            gate: decision.gate,
            message: decision.gate.message || message,
          }
          continue
        }
        allowCustomerRef = decision.customerRef
        event = {
          kind: 'gateAllow',
          customerRef: decision.customerRef,
          limits: decision.limits,
        }
        continue
      }
      if (kind === 'invokeHandler') {
        const limits = (action.limits ?? null) as LimitResponseWithPlan | null
        const handlerRef = String(action.customerRef ?? allowCustomerRef ?? '')
        const { ctx: responseCtx } = buildResponseContext({
          customerRef: handlerRef,
          limits,
          product,
          solvaPay,
        })
        try {
          const returned = await handler(args as TArgs, responseCtx)
          const envelope = assertResponseResult(returned)
          event = {
            kind: 'handlerOk',
            envelope,
            nowMs: nowMs(),
            randomUnit: Math.random(),
          }
        } catch (err) {
          if (err instanceof PaywallError) {
            event = {
              kind: 'handlerPaywall',
              gate: err.structuredContent,
              message: err.message,
            }
            continue
          }
          const message = err instanceof Error ? err.message : String(err)
          if (message.includes('registerPayable handler returned a raw value')) {
            throw err instanceof Error ? err : new Error(message)
          }
          event = {
            kind: 'handlerErr',
            message,
            nowMs: nowMs(),
            randomUnit: Math.random(),
          }
        }
        continue
      }
      if (kind === 'done') {
        const track = action.track
        if (track?.request && typeof track.request === 'object') {
          await solvaPay.apiClient.trackUsage(
            track.request as Parameters<SolvaPay['apiClient']['trackUsage']>[0],
          )
        }
        const result = action.result as SolvaPayCallToolResult
        if (isPaywallStructuredContent(result.structuredContent)) {
          return { ...result, isError: false }
        }
        return result
      }
      throw new Error(`invokePayableNext unknown action kind: ${String(kind)}`)
    }
  }
}

export type { BootstrapPayload }
