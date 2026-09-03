/**
 * `registerPayableTool(server, name, options)` — one-liner for registering
 * a paywall-protected MCP tool on the official `@modelcontextprotocol/server`
 * `McpServer`.
 */

import type { McpServer, RegisteredTool } from '@modelcontextprotocol/server'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { z, type ZodTypeAny } from 'zod'
import {
  buildPayableHandler,
  type BuildBootstrapPayloadFn,
  type McpToolExtra,
  type PayableHandler,
  type SolvaPayToolAnnotations,
  type SolvaPayToolIcon,
} from '@solvapay/mcp-core'
import type { SolvaPay } from '@solvapay/server'
import { registerAppTool } from './internal/extAppsServer'

type ZodObjectSchema = ReturnType<typeof z.object>

/** Accepted `schema` forms: a `z.object()` schema or a raw `{ field: z.string() }` shape. */
export type InputSchemaOption = ZodObjectSchema | Record<string, z.ZodType> | undefined

/**
 * Projects the tool's `schema` (raw shape or already-constructed schema) into
 * the `args` type the handler receives. With no schema, falls back to
 * `Record<string, unknown>` so handlers can still destructure.
 */
export type InferHandlerArgs<InputSchema> = [InputSchema] extends [undefined]
  ? Record<string, unknown>
  : InputSchema extends ZodObjectSchema
    ? z.infer<InputSchema>
    : InputSchema extends Record<string, z.ZodType>
      ? z.infer<z.ZodObject<InputSchema>>
      : Record<string, unknown>

function wrapInputSchema(schema: InputSchemaOption): ZodObjectSchema | undefined {
  if (schema === undefined) return undefined
  if (typeof schema === 'object' && schema !== null && 'safeParse' in schema) {
    return schema as ZodObjectSchema
  }
  return z.object(schema)
}

export interface RegisterPayableToolOptions<
  InputSchema extends InputSchemaOption = undefined,
  TData = unknown,
> {
  solvaPay: SolvaPay
  schema?: InputSchema
  product: string
  title?: string
  description?: string
  handler: PayableHandler<InferHandlerArgs<InputSchema>, TData>
  /**
   * Opt-in structured-output schema. Declaring it converts a nicety
   * into a spec MUST — the server must then return conforming
   * `structuredContent`. Never auto-derived.
   */
  outputSchema?: ZodTypeAny
  buildBootstrap?: BuildBootstrapPayloadFn
  getCustomerRef?: (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ) => string | Promise<string>
  meta?: Record<string, unknown>
  annotations?: SolvaPayToolAnnotations
  icons?: SolvaPayToolIcon[]
}

export function registerPayableTool<
  InputSchema extends InputSchemaOption = undefined,
  TData = unknown,
>(
  server: McpServer,
  name: string,
  options: RegisterPayableToolOptions<InputSchema, TData>,
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
  } = options

  const protectedHandler = buildPayableHandler(
    solvaPay,
    { product, buildBootstrap, getCustomerRef },
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
  const toolMeta: Record<string, unknown> = hasUi
    ? { ...baseMeta, ui: mergedUi }
    : { ...baseMeta }

  const effectiveAnnotations: SolvaPayToolAnnotations = {
    readOnlyHint: true,
    openWorldHint: true,
    ...annotations,
  }

  const hasUiResource =
    hasUi && typeof (mergedUi as { resourceUri?: unknown }).resourceUri === 'string'

  const toolConfig = {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(schema !== undefined ? { inputSchema: wrapInputSchema(schema) } : {}),
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    ...(Object.keys(toolMeta).length > 0 ? { _meta: toolMeta } : {}),
    annotations: effectiveAnnotations,
    ...(icons !== undefined && icons.length > 0 ? { icons } : {}),
  }

  const toolCallback = async (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ): Promise<CallToolResult> => (await protectedHandler(args, extra)) as CallToolResult

  if (hasUiResource) {
    return registerAppTool(server, name, toolConfig, toolCallback)
  }

  return server.registerTool(name, toolConfig, toolCallback)
}
