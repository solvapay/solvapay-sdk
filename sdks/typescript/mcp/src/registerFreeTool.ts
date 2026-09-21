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
  type PayableHandler,
  type SolvaPayToolAnnotations,
  type SolvaPayToolIcon,
} from '@solvapay/mcp-core'
import type { FreeLimit, SolvaPay } from '@solvapay/server'
import {
  PaywallStructuredContentSchema,
  normalizeFreeLimit,
  freeLimitsAgree,
  freeToolDescriptionSuffix,
} from '@solvapay/server'
import {
  type InferHandlerArgs,
  type InputSchemaOption,
  payableToolAnnotations,
  wrapInputSchema,
} from './registerPayableTool'
import { registerAppTool } from './internal/extAppsServer'

export type { FreeLimit }

/** Mirrors `freeMeterNamePattern()` from solvapay-core. */
export const FREE_METER_NAME_PATTERN = /^free-[a-z0-9-]+$/

export { normalizeFreeLimit, freeLimitsAgree, freeToolDescriptionSuffix }

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
  getCustomerRef?: (
    args: Record<string, unknown>,
    extra?: import('@solvapay/mcp-core').McpToolExtra,
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
    getCustomerRef,
    meta,
    annotations,
    icons,
    sharedWith,
  } = options

  const freeLimit = normalizeFreeLimit({
    cap: options.limit.cap,
    scope: options.limit.scope,
    ...(options.limit.meter !== undefined ? { meter: options.limit.meter } : {}),
    ...(options.limit.windowDays !== undefined ? { windowDays: options.limit.windowDays } : {}),
  })
  if ('error' in freeLimit) {
    throw new Error(freeLimit.error)
  }

  const protectedHandler = buildPayableHandler(
    solvaPay,
    { product, getCustomerRef, toolName: name, freeLimit },
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

  const effectiveAnnotations: SolvaPayToolAnnotations = payableToolAnnotations({
    readOnlyHint: true,
    ...annotations,
  })

  const hasUiResource =
    hasUi && typeof (mergedUi as { resourceUri?: unknown }).resourceUri === 'string'

  const registeredOutputSchema =
    outputSchema !== undefined ? z.union([outputSchema, PaywallStructuredContentSchema]) : undefined

  const accountHint = freeToolDescriptionSuffix(freeLimit, sharedWith ?? [])
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
    extra?: import('@solvapay/mcp-core').McpToolExtra,
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
