/**
 * `registerPayableTool(server, name, options)` — one-liner for registering
 * a paywall-protected MCP tool on the official `@modelcontextprotocol/sdk`
 * `McpServer`.
 *
 * Payable data tools do NOT advertise `_meta.ui.resourceUri` at the
 * descriptor level by default. Per SEP-1865 / MCP Apps (2026-01-26),
 * descriptor-advertising means the host MUST open the iframe on every
 * call — so auto-stamping would flash an empty widget next to every
 * successful `search_knowledge` / `predict_direction` result. Paywall
 * / nudge / activation responses are text-only narrations instead,
 * with the recovery intent tool (`upgrade` / `topup` / `activate_plan`)
 * named in `content[0].text` and `checkoutUrl` inlined for
 * terminal-first hosts.
 *
 * Merchants who deliberately want the widget opened on every call
 * (e.g. the tool's UX genuinely is the iframe — rare) can opt in with
 * `meta: { ui: { resourceUri } }`.
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
   *    text-suffix upsell copy), and the reserved `units` (V1.1
   *    variable billing — V1 silently ignores).
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
   * Builds the full `BootstrapPayload`. Accepted for forward
   * compatibility with intent-tool reuse, but the text-only payable
   * branch does NOT invoke it — gate responses ride through as
   * `structuredContent = gate` + `content[0].text = gate.message`.
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
   * `registerPayableTool` does NOT inject `ui.resourceUri` by default:
   * per SEP-1865 descriptor-advertising means hosts MUST open the
   * iframe on every call, so auto-stamping produced empty widgets on
   * silent success. Merchants who want the widget opened for every
   * call can opt in explicitly via
   * `meta: { ui: { resourceUri: 'ui://...' } }`.
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
   * best results.
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
    { product, buildBootstrap, getCustomerRef },
    handler as unknown as Parameters<typeof buildPayableHandler>[2],
  )

  // Descriptor-level `_meta`:
  //  - No default `ui.resourceUri` — see the module-level comment on
  //    the text-only paywall rationale.
  //  - Merchant-supplied `meta.ui.resourceUri` (if any) passes through
  //    untouched — merchants opting in are honoured verbatim.
  //  - Brand icons are merged under `_meta.ui.icons` (the ext-apps
  //    discovery slot) when supplied, regardless of whether
  //    `ui.resourceUri` is present.
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

  // `registerAppTool` is the right surface when a tool advertises a UI
  // resource — it normalises `_meta.ui.resourceUri` into the legacy
  // `_meta["ui/resourceUri"]` slot for pre-2026-01-26 hosts. For
  // text-only payable tools (the default since the SEP-1865 refactor)
  // there's no UI resource to normalise, so we go through the base
  // SDK's `registerTool` to avoid `registerAppTool` dereferencing an
  // absent `_meta.ui`.
  const hasUiResource =
    hasUi && typeof (mergedUi as { resourceUri?: unknown }).resourceUri === 'string'

  const toolConfig = {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(schema !== undefined ? { inputSchema: schema } : {}),
    ...(Object.keys(toolMeta).length > 0 ? { _meta: toolMeta } : {}),
    annotations: effectiveAnnotations,
    ...(icons !== undefined && icons.length > 0 ? { icons } : {}),
  }

  const toolCallback = async (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ): Promise<CallToolResult> => (await protectedHandler(args, extra)) as CallToolResult

  if (hasUiResource) {
    return registerAppTool(
      server,
      name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toolConfig as any,
      toolCallback,
    )
  }

  return server.registerTool(
    name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolConfig as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolCallback as any,
  )
}
