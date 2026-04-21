/**
 * `registerPayableTool(server, name, options)` — one-liner for registering a
 * paywall-protected MCP tool that auto-attaches `_meta.ui` to paywall
 * results so MCP hosts know which UI resource + bootstrap tool to open.
 *
 * Mirrors the positional-`name` shape of `registerAppTool` to keep the
 * convention consistent across the ecosystem (the tool name stays scannable
 * at the call site).
 */

import { registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { SolvaPay } from '../factory'
import type { McpToolExtra, PaywallToolResult } from '../types'
import { isPaywallStructuredContent } from '../types/paywall'

export interface RegisterPayableToolOptions<InputSchema extends ZodRawShapeCompat | AnySchema> {
  /** The initialised SolvaPay instance used to build `payable({ product }).mcp(handler)`. */
  solvaPay: SolvaPay
  /**
   * UI resource URI the MCP host should open to render the paywall view.
   * Typically `'ui://<app>/<resource>.html'`.
   */
  resourceUri: string
  /** Zod-compatible input schema (raw shape or discriminated schema). */
  schema?: InputSchema
  /** SolvaPay product ref to protect this tool against. */
  product: string
  /** Optional human-readable tool title for MCP listings. */
  title?: string
  /** Optional tool description surfaced to the model. */
  description?: string
  /**
   * The business logic that runs once the caller is within limits.
   *
   * Return any JSON-serialisable value — it is wrapped by the MCP adapter's
   * `formatResponse` into `{ content: [...text...], structuredContent }`.
   * Throwing anything other than `PaywallError` surfaces as a tool-level
   * error via `formatError`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, extra?: McpToolExtra) => Promise<any>
  /**
   * Name of the bootstrap tool that renders the paywall (defaults to
   * `'open_paywall'`). Attached to `_meta.ui.toolName` on paywall results.
   */
  paywallToolName?: string
  /**
   * Override customer-ref extraction. Defaults to the MCP adapter's
   * behavior (reads `extra.authInfo.extra.customer_ref`).
   */
  getCustomerRef?: (args: Record<string, unknown>, extra?: McpToolExtra) => string | Promise<string>
  /**
   * Additional `_meta` to merge onto the tool registration envelope (e.g.
   * custom host flags). `_meta.ui.resourceUri` is always set from
   * `resourceUri` and cannot be overridden here.
   */
  meta?: Record<string, unknown>
}

/**
 * Register a paywall-protected tool on an MCP server.
 *
 * The handler is wrapped with `solvaPay.payable({ product }).mcp(handler)`
 * so usage limits are enforced automatically. If the paywall fires, the
 * resulting `PaywallToolResult` is post-processed to attach `_meta.ui`
 * with the server's UI resource URI so the host knows where to render the
 * paywall view.
 */
export function registerPayableTool<InputSchema extends ZodRawShapeCompat | AnySchema>(
  server: McpServer,
  name: string,
  options: RegisterPayableToolOptions<InputSchema>,
): RegisteredTool {
  const {
    solvaPay,
    resourceUri,
    schema,
    product,
    title,
    description,
    handler,
    paywallToolName = 'open_paywall',
    getCustomerRef,
    meta,
  } = options

  const protectedHandler = solvaPay.payable({ product, getCustomerRef }).mcp(handler)

  const toolMeta = {
    ...(meta ?? {}),
    ui: { resourceUri, ...(meta && typeof meta === 'object' && 'ui' in meta ? (meta.ui as object) : {}) },
  }

  return registerAppTool(
    server,
    name,
    // Note: `registerAppTool`'s config type is stricter than ours — casting
    // so `title` / `description` stay optional and the input schema flows
    // through correctly at the registration layer.
    {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(schema !== undefined ? { inputSchema: schema } : {}),
      _meta: toolMeta,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> => {
      const result = (await protectedHandler(args, extra)) as PaywallToolResult | CallToolResult
      if (result.isError && isPaywallStructuredContent(result.structuredContent)) {
        const existingMeta =
          typeof (result as PaywallToolResult)._meta === 'object' &&
          (result as PaywallToolResult)._meta !== null
            ? ((result as PaywallToolResult)._meta as Record<string, unknown>)
            : {}
        return {
          ...(result as CallToolResult),
          _meta: {
            ...existingMeta,
            ui: { resourceUri, toolName: paywallToolName },
          },
        }
      }
      return result as CallToolResult
    },
  )
}
