/**
 * `buildPayableHandler(solvaPay, ctx, handler)` — framework-neutral
 * wrapper that produces an MCP tool handler enforcing the SolvaPay
 * paywall via the shared Rust `invokePayableNext` driver.
 */

import type { LimitResponseWithPlan, PaywallArgs, SolvaPay } from '@solvapay/server'
import { isPaywallStructuredContent, PaywallError } from '@solvapay/server'
import { defaultGetCustomerRef } from './helpers'
import {
  assertResponseResult,
  invokePayableNext,
} from './native-mcp'
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
  track?: { outcome?: unknown; durationMs?: unknown } | null
  gate?: unknown
  message?: unknown
}

function nowMs(): number {
  return Date.now()
}

async function resolveCustomerRef(
  args: Record<string, unknown>,
  extra: McpToolExtra | undefined,
  getCustomerRef: BuildPayableHandlerContext['getCustomerRef'],
): Promise<string> {
  if (getCustomerRef) {
    const resolved = await getCustomerRef(args, extra)
    if (typeof resolved === 'string' && resolved.trim()) {
      return resolved.trim()
    }
  }
  const fromExtra = defaultGetCustomerRef(extra)
  if (fromExtra) {
    return fromExtra
  }
  const raw = args.customer_ref
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim()
  }
  return 'anonymous'
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

  return async (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ): Promise<SolvaPayCallToolResult> => {
    const customerRef = await resolveCustomerRef(args, extra, getCustomerRef)
    let state: unknown = null
    let event: Record<string, unknown> = {
      kind: 'start',
      customerRef,
      product,
      usageType: 'requests',
      startedMs: nowMs(),
    }
    let allowCustomerRef: string | null = null

    for (;;) {
      const out = invokePayableNext(state, event)
      state = out.state
      const action = out.action as InvokeAction
      const kind = action.kind
      if (kind === 'runGate') {
        const decision = await solvaPay.paywall.decide(
          { auth: { customer_ref: String(action.customerRef ?? customerRef) } } as PaywallArgs,
          { product: String(action.product ?? product) },
        )
        if (decision.outcome === 'gate') {
          const message =
            decision.gate.kind === 'activation_required' ? 'Activation required' : 'Payment required'
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
          event = {
            kind: 'handlerErr',
            message,
            nowMs: nowMs(),
          }
        }
        continue
      }
      if (kind === 'done') {
        const track = action.track
        if (track && allowCustomerRef) {
          const duration =
            typeof track.durationMs === 'number' ? track.durationMs : Number(track.durationMs ?? 0)
          const outcome = track.outcome === 'success' ? 'success' : 'fail'
          await solvaPay.apiClient.trackUsage({
            customerRef: allowCustomerRef,
            productRef: product,
            actionType: 'api_call',
            units: 1,
            outcome,
            duration,
            metadata: { action: 'requests' },
            timestamp: new Date().toISOString(),
          })
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
