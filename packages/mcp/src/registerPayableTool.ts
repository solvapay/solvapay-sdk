/**
 * `registerPayableTool(server, name, options)` — one-liner for registering
 * a paywall-protected MCP tool on the official `@modelcontextprotocol/sdk`
 * `McpServer`.
 *
 * Always advertises `_meta.ui.resourceUri` at the descriptor level so
 * descriptor-reading hosts (MCPJam's `ResultsPanel`, MCP App inspector)
 * learn the widget exists and open the MCP App iframe when a paywall or
 * nudge response lands. `buildPayableHandler` stamps the same metadata
 * on the result envelope as a secondary signal for hosts that key off
 * tool-call results (Claude Desktop, mcp-ui, ChatGPT Apps).
 *
 * Mirrors the positional-`name` shape of `registerAppTool` to keep the
 * convention consistent across the ecosystem.
 */

import { registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  AnySchema,
  SchemaOutput,
  ShapeOutput,
  ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  buildPayableHandler,
  type BuildBootstrapPayloadFn,
  type McpToolExtra,
  type PayableHandler,
  type SolvaPayToolAnnotations,
  type SolvaPayToolIcon,
} from '@solvapay/mcp-core'
import type { SolvaPay } from '@solvapay/server'

/**
 * Projects the tool's `schema` (raw shape or already-constructed
 * schema) into the `args` type the handler receives. When no schema
 * is provided, falls back to `Record<string, unknown>` so handlers
 * can still destructure without losing type-check.
 */
export type InferHandlerArgs<InputSchema> = [InputSchema] extends [undefined]
  ? Record<string, unknown>
  : InputSchema extends ZodRawShapeCompat
    ? ShapeOutput<InputSchema>
    : InputSchema extends AnySchema
      ? SchemaOutput<InputSchema>
      : Record<string, unknown>

export interface RegisterPayableToolOptions<
  InputSchema extends ZodRawShapeCompat | AnySchema | undefined = undefined,
  TData = unknown,
> {
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
   * Business logic that runs once the caller is within limits. Receives
   * parsed `args` (inferred from `schema` when provided) and a
   * `ResponseContext`; must return the branded envelope produced by
   * `ctx.respond(data, options?)`.
   *
   * `ctx` surfaces:
   *  - `ctx.customer` — cached snapshot (`balance`, `remaining`, `plan`,
   *    `.fresh()` for a round-trip).
   *  - `ctx.product` — bootstrap product projection.
   *  - `ctx.respond(data, options?)` — return an envelope. `options`
   *    carries `text` (override `content[0].text`), `nudge` (inline
   *    upsell strip), and the reserved `units` (V1.1 variable billing —
   *    V1 silently ignores).
   *  - `ctx.gate(reason?)` — stops handler execution and emits a
   *    paywall response through the adapter's `formatGate` channel.
   *    Rare — the SDK normally fires the paywall automatically via
   *    `payable().mcp()` pre-check.
   *  - `ctx.emit(block)` / `ctx.progress(...)` / `ctx.signal` — reserved
   *    streaming surface. V1 queues (emit) or no-ops (progress / signal);
   *    V1.1 wires them to SSE and transport cancellation.
   *
   * Throwing anything other than `PaywallError` surfaces as a tool-level
   * error via `formatError`.
   */
  handler: PayableHandler<InferHandlerArgs<InputSchema>, TData>
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
   * advertisement returned by `tools/list`).
   *
   * `registerPayableTool` always injects `ui.resourceUri` at the
   * descriptor level so hosts that read widget metadata from
   * `tools/list` (MCPJam's `ResultsPanel` reads
   * `toolMeta.ui.resourceUri` from the tool definition) can open the
   * MCP App iframe when a paywall/nudge response lands. Merchant
   * `meta.ui.resourceUri` overrides the default if supplied.
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
  /**
   * Brand icons surfaced on `tools/list`. Hosts that read tool
   * metadata for the chrome strip (ChatGPT, Claude Desktop) swap the
   * default placeholder for this asset. Pass a square logomark for
   * best results. Merchants typically share one `icons[]` across
   * every tool — consider a single branding source at the server
   * level.
   */
  icons?: SolvaPayToolIcon[]
}

/**
 * Register a paywall-protected tool on an MCP server.
 */
export function registerPayableTool<
  InputSchema extends ZodRawShapeCompat | AnySchema | undefined = undefined,
  TData = unknown,
>(
  server: McpServer,
  name: string,
  options: RegisterPayableToolOptions<InputSchema, TData>,
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
    icons,
  } = options

  const protectedHandler = buildPayableHandler(
    solvaPay,
    { product, resourceUri, buildBootstrap, getCustomerRef },
    handler as unknown as Parameters<typeof buildPayableHandler>[2],
  )

  // Inject `_meta.ui.resourceUri` at the descriptor level so hosts
  // that read widget metadata from `tools/list` (MCPJam's
  // `ResultsPanel` reads `toolMeta.ui.resourceUri` from the tool
  // definition, not from the tool-call result) can discover the UI
  // resource and open the iframe when a paywall/nudge result lands.
  // The per-call `_meta.ui` stamped by `buildPayableHandler` on
  // paywall/nudge responses is kept as a secondary signal for hosts
  // that also inspect call results (mcp-ui, etc.).
  //
  // Merchant-supplied `meta.ui.resourceUri` still wins — explicit
  // overrides take priority over the default.
  //
  // Brand icons are merged into `_meta.ui.icons` so ext-apps-aware
  // hosts pick up the merchant mark for the chrome strip.
  const baseMeta = meta ?? {}
  const baseUi = (baseMeta.ui as Record<string, unknown> | undefined) ?? {}
  const hasIcons = icons !== undefined && icons.length > 0
  const mergedUi: Record<string, unknown> = {
    resourceUri,
    ...baseUi,
    ...(hasIcons ? { icons } : {}),
  }
  const toolMeta: Record<string, unknown> = { ...baseMeta, ui: mergedUi }

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
      ...(icons !== undefined && icons.length > 0 ? { icons } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      (await protectedHandler(args, extra)) as CallToolResult,
  )
}
