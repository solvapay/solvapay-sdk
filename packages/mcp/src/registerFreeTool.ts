/**
 * `registerFreeTool(server, name, options)` — register an MCP tool that
 * is free up to a per-customer cap declared in code. Exhaustion emits
 * the same paywall gate as `registerPayable`.
 *
 * Prefer `ctx.registerFree` from `createSolvaPayMcpServer` — that path
 * also enforces that two tools naming the same free meter agree on cap
 * / scope / windowDays.
 */

import type { McpServer, RegisteredTool } from '@modelcontextprotocol/server'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { z, type ZodTypeAny } from 'zod'
import {
  buildPayableHandler,
  defaultGetCustomerRef,
  toolErrorResult,
  type BuildBootstrapPayloadFn,
  type McpToolExtra,
  type PayableHandler,
  type SolvaPayToolAnnotations,
  type SolvaPayToolIcon,
} from '@solvapay/mcp-core'
import type { FreeLimit, SolvaPay } from '@solvapay/server'
import { PaywallStructuredContentSchema } from '@solvapay/server'
import {
  type InferHandlerArgs,
  type InputSchemaOption,
} from './registerPayableTool'
import { registerAppTool } from './internal/extAppsServer'

export const FREE_METER_NAME_PATTERN = /^free-[a-z0-9-]+$/

export type { FreeLimit }

function wrapInputSchema(schema: InputSchemaOption): ReturnType<typeof z.object> | undefined {
  if (schema === undefined) return undefined
  if (typeof schema === 'object' && schema !== null && 'safeParse' in schema) {
    return schema as ReturnType<typeof z.object>
  }
  return z.object(schema)
}

export function normalizeFreeLimit(limit: Omit<FreeLimit, 'meter'> & { meter?: string }): FreeLimit {
  const meter = (limit.meter ?? 'free-requests').toLowerCase()
  if (!FREE_METER_NAME_PATTERN.test(meter)) {
    throw new Error(
      `Free allowance meter '${meter}' must match ${FREE_METER_NAME_PATTERN}`,
    )
  }
  if (limit.scope === 'rolling_window' && limit.windowDays === undefined) {
    throw new Error('windowDays is required when scope is rolling_window')
  }
  return {
    meter,
    cap: limit.cap,
    scope: limit.scope,
    ...(limit.windowDays !== undefined ? { windowDays: limit.windowDays } : {}),
  }
}

export function freeLimitsAgree(a: FreeLimit, b: FreeLimit): boolean {
  return a.meter === b.meter && a.cap === b.cap && a.scope === b.scope && a.windowDays === b.windowDays
}

export function freeToolDescriptionSuffix(limit: FreeLimit, sharedWith: string[] = []): string {
  const window = limit.scope === 'lifetime' ? 'lifetime' : `${limit.windowDays} days`
  const base =
    `Free tool — ${limit.cap} calls per ${window}, then a plan is required. ` +
    'Call `account` for remaining usage.'
  if (sharedWith.length === 0) return base
  const names = sharedWith.map(name => `\`${name}\``).join(', ')
  return `${base} Shares a free allowance with ${names}.`
}

export interface RegisterFreeToolOptions<
  InputSchema extends InputSchemaOption = undefined,
  TData = unknown,
> {
  solvaPay: SolvaPay
  schema?: InputSchema
  product: string
  title?: string
  description?: string
  limit: Omit<FreeLimit, 'meter'> & { meter?: string }
  handler: PayableHandler<InferHandlerArgs<InputSchema>, TData>
  outputSchema?: ZodTypeAny
  buildBootstrap?: BuildBootstrapPayloadFn
  getCustomerRef?: (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ) => string | Promise<string>
  meta?: Record<string, unknown>
  annotations?: SolvaPayToolAnnotations
  icons?: SolvaPayToolIcon[]
  /** Other tools already registered on this meter — used in the description suffix. */
  sharedWith?: string[]
}

export function registerFreeTool<
  InputSchema extends InputSchemaOption = undefined,
  TData = unknown,
>(
  server: McpServer,
  name: string,
  options: RegisterFreeToolOptions<InputSchema, TData>,
): RegisteredTool {
  const {
    solvaPay,
    schema,
    product,
    title,
    description,
    handler,
    outputSchema,
    buildBootstrap,
    getCustomerRef,
    meta,
    annotations,
    icons,
    sharedWith,
  } = options

  const freeLimit = normalizeFreeLimit(options.limit)

  const protectedHandler = buildPayableHandler(
    solvaPay,
    { product, buildBootstrap, getCustomerRef, toolName: name, freeLimit },
    handler as unknown as Parameters<typeof buildPayableHandler>[2],
  )

  const baseMeta = meta ?? {}
  const baseUi = (baseMeta.ui as Record<string, unknown> | undefined) ?? {}
  const hasIcons = icons !== undefined && icons.length > 0
  const mergedUi: Record<string, unknown> = {
    ...baseUi,
    ...(hasIcons ? { icons } : {}),
  }
  const hasUi = Object.keys(mergedUi).length > 0
  const toolMeta: Record<string, unknown> = hasUi ? { ...baseMeta, ui: mergedUi } : { ...baseMeta }

  const effectiveAnnotations: SolvaPayToolAnnotations = {
    readOnlyHint: true,
    openWorldHint: true,
    ...annotations,
  }

  const hasUiResource =
    hasUi && typeof (mergedUi as { resourceUri?: unknown }).resourceUri === 'string'

  const registeredOutputSchema =
    outputSchema !== undefined
      ? z.union([outputSchema, PaywallStructuredContentSchema])
      : undefined

  const accountHint = freeToolDescriptionSuffix(freeLimit, sharedWith)
  const descriptionWithHint = description
    ? `${description.replace(/\s+$/, '')} ${accountHint}`
    : accountHint

  const toolConfig = {
    ...(title !== undefined ? { title } : {}),
    description: descriptionWithHint,
    ...(schema !== undefined ? { inputSchema: wrapInputSchema(schema) } : {}),
    ...(registeredOutputSchema !== undefined ? { outputSchema: registeredOutputSchema } : {}),
    ...(Object.keys(toolMeta).length > 0 ? { _meta: toolMeta } : {}),
    annotations: effectiveAnnotations,
    ...(icons !== undefined && icons.length > 0 ? { icons } : {}),
  }

  const toolCallback = async (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ): Promise<CallToolResult> => {
    const resolved = getCustomerRef
      ? await getCustomerRef(args, extra)
      : defaultGetCustomerRef(extra)
    if (!resolved || resolved === 'anonymous') {
      return toolErrorResult({
        error: 'Unauthorized',
        status: 401,
        details: 'customer_ref missing from MCP auth context',
      }) as CallToolResult
    }
    return (await protectedHandler(args, extra)) as CallToolResult
  }

  if (hasUiResource) {
    return registerAppTool(server, name, toolConfig, toolCallback)
  }

  return server.registerTool(name, toolConfig, toolCallback)
}
