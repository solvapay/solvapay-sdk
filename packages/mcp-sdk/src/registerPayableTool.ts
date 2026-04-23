/**
 * `registerPayableTool(server, name, options)` — one-liner for registering
 * a paywall-protected MCP tool on the official `@modelcontextprotocol/sdk`
 * `McpServer`.
 *
 * The MCP App iframe opens only when there's something to show: paywall
 * gate responses and `ctx.respond(..., { nudge })` successes. Both cases
 * stamp `_meta.ui` on the tool **result** from inside
 * `buildPayableHandler`. The descriptor-level `_meta.ui.resourceUri` is
 * intentionally left unset so hosts that key off the tool advertisement
 * (e.g. MCPJam) don't auto-open the iframe for every routine successful
 * call. Merchants who want the opposite — always-open behaviour — can
 * opt in explicitly via `meta: { ui: { resourceUri } }`.
 *
 * Mirrors the positional-`name` shape of `registerAppTool` to keep the
 * convention consistent across the ecosystem.
 */

import { registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  buildPayableHandler,
  type BuildBootstrapPayloadFn,
  type McpToolExtra,
  type PayableHandler,
  type SolvaPayToolAnnotations,
} from '@solvapay/mcp'
import type { SolvaPay } from '@solvapay/server'

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
   * Two shapes are supported:
   *  - **New (preferred):** `async (args, ctx) => ctx.respond(data, options?)`.
   *    Returns a `ResponseResult` envelope from `ctx.respond(...)`;
   *    `ctx.customer` / `ctx.product` / `ctx.gate(...)` / reserved
   *    streaming stubs are available.
   *  - **Legacy (still supported):** `async (args, extra?) => data`.
   *    Returns any JSON-serialisable value; the MCP adapter's
   *    `formatResponse` wraps it into
   *    `{ content: [...text...], structuredContent }`.
   *
   * Throwing anything other than `PaywallError` surfaces as a
   * tool-level error via `formatError`.
   */
  handler:
    | PayableHandler<any, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | ((args: any, extra?: McpToolExtra) => Promise<any>)
  /**
   * Builds the full `BootstrapPayload` embedded on paywall results so
   * the React shell renders the paywall view directly from the gate
   * response. Wire from
   * `buildSolvaPayDescriptors(...).buildBootstrapPayload`.
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
  /**
   * Additional `_meta` merged onto the tool **descriptor** (the tool
   * advertisement returned by `tools/list`). Pass-through — nothing is
   * injected by `registerPayableTool` itself.
   *
   * By default the descriptor carries no `_meta.ui` link, so hosts that
   * auto-open an iframe based on tool advertisement (MCPJam, etc.)
   * won't open the MCP App on routine successful calls. The per-call
   * `_meta.ui` that `buildPayableHandler` stamps on paywall and
   * `ctx.respond(..., { nudge })` results is sufficient to trigger
   * opens only when there's actually something to show.
   *
   * To restore always-open behaviour (e.g. to render a persistent
   * balance strip alongside every call) pass
   * `meta: { ui: { resourceUri } }` explicitly.
   */
  meta?: Record<string, unknown>
  /**
   * Portable MCP tool annotations. Defaults to
   * `{ readOnlyHint: true, openWorldHint: true }` — sensible for a
   * paywalled *data* tool that reads from the merchant's backend.
   * Override for tools that mutate state (e.g. `submit_order`) with
   * `annotations: { readOnlyHint: false, destructiveHint: true }`.
   */
  annotations?: SolvaPayToolAnnotations
}

/**
 * Register a paywall-protected tool on an MCP server.
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
    buildBootstrap,
    getCustomerRef,
    meta,
    annotations,
  } = options

  // Cast is safe: `buildPayableHandler` accepts a union of the legacy
  // `(args, extra?)` handler and the new `(args, ctx)` handler; at
  // runtime it passes a `ResponseContext` as the second arg, so
  // merchant handlers that declared `extra?: McpToolExtra` simply
  // receive an object whose structure they ignore. The double `unknown`
  // hop silences the variance complaint between the registerPayableTool
  // public contract and the narrower internal handler type.
  const protectedHandler = buildPayableHandler(
    solvaPay,
    { product, resourceUri, buildBootstrap, getCustomerRef },
    handler as unknown as Parameters<typeof buildPayableHandler>[2],
  )

  // Pass merchant `_meta` through verbatim. We intentionally do NOT
  // inject `ui.resourceUri` here — the per-call `_meta.ui` that
  // `buildPayableHandler` stamps on paywall and nudge results is what
  // drives host iframe opens, and injecting it at the descriptor level
  // would make hosts like MCPJam auto-open on every routine successful
  // call. Merchants who want always-open can pass
  // `meta: { ui: { resourceUri } }` explicitly.
  const toolMeta = meta ?? {}

  // Sensible default: paywalled data tools are most often read-only
  // queries (search, fetch, quote). State-mutating merchant tools
  // override via `annotations: { readOnlyHint: false, destructiveHint:
  // true }`. `openWorldHint` is always true — a paywalled tool by
  // definition talks to the merchant's backend and SolvaPay's backend.
  const effectiveAnnotations: SolvaPayToolAnnotations = {
    readOnlyHint: true,
    openWorldHint: true,
    ...annotations,
  }

  return registerAppTool(
    server,
    name,
    // Note: `registerAppTool`'s config type is stricter than ours —
    // casting so `title` / `description` stay optional and the input
    // schema flows through correctly at the registration layer.
    {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(schema !== undefined ? { inputSchema: schema } : {}),
      _meta: toolMeta,
      annotations: effectiveAnnotations,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      (await protectedHandler(args, extra)) as CallToolResult,
  )
}
