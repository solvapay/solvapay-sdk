/**
 * Framework-neutral MCP contracts shared across every SolvaPay MCP adapter.
 *
 * These types are intentionally free of `@modelcontextprotocol/*` imports
 * so adapters for `mcp-lite`, `fastmcp-node`, or raw JSON-RPC servers can
 * consume them without pulling in the official SDK.
 *
 * The `ZodTypeAny`-shaped `inputSchema` keeps zod as an optional peer.
 * Adapters that don't use zod can still pass equivalent shapes.
 */

import type { ZodTypeAny } from 'zod'
import type {
  CustomerBalanceResult,
  GetUsageResult,
  PaymentMethodInfo,
  PurchaseCheckResult,
  SdkMerchantResponse,
  SdkProductResponse,
  components,
} from '@solvapay/server'
import type { MCP_TOOL_NAMES } from './tool-names'

/**
 * Merchant identity surfaced on every `BootstrapPayload`. Structural
 * alias for the server's `SdkMerchantResponse` so the React shell can
 * hydrate `<MandateText>` and the rest of the trust-signal surface
 * without an extra fetch.
 */
export type BootstrapMerchant = SdkMerchantResponse

/**
 * Product projection surfaced on every `BootstrapPayload`. Structural
 * alias for the server's `SdkProductResponse`.
 */
export type BootstrapProduct = SdkProductResponse

/**
 * Plan projection surfaced on every `BootstrapPayload`. Structural
 * alias for the generated `Plan` schema so the embedded checkout can
 * mount its plan picker from the snapshot.
 */
export type BootstrapPlan = components['schemas']['Plan']

/**
 * Per-customer snapshot surfaced on every `BootstrapPayload`. Null when
 * unauthenticated; individual fields are null when the corresponding
 * sub-read errored or doesn't apply.
 */
export interface BootstrapCustomer {
  ref: string
  purchase: PurchaseCheckResult | null
  paymentMethod: PaymentMethodInfo | null
  balance: CustomerBalanceResult | null
  usage: GetUsageResult | null
}

/**
 * MCP tool call result — a structural subset of the official SDK's
 * `CallToolResult` that every framework produces. Kept local to avoid
 * coupling to `@modelcontextprotocol/sdk/types.js` type churn.
 */
export interface SolvaPayCallToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'resource'; resource: Record<string, unknown> }
  >
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

/**
 * Extra context passed into MCP tool handlers. Mirrors the `extra`
 * parameter shape used by the official SDK's `registerTool` callback.
 */
export interface McpToolExtra {
  authInfo?: {
    token?: string
    clientId?: string
    scopes?: string[]
    expiresAt?: number
    extra?: Record<string, unknown>
  }
  [key: string]: unknown
}

/**
 * Options for the MCP adapter's `formatResponse` / `getCustomerRef`
 * hooks. Used by `@solvapay/server`'s `McpAdapter` (backing
 * `payable().mcp()`) and any descriptor-level customisation.
 */
export interface McpAdapterOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCustomerRef?: (args: any, extra?: McpToolExtra) => string | Promise<string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformResponse?: (result: any) => any
}

/**
 * Tool result shape returned by `payable().mcp(...)` when the paywall
 * fires. Structurally compatible with `SolvaPayCallToolResult` so every
 * framework adapter can return it directly.
 */
export interface PaywallToolResult {
  content?: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
  structuredContent?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

/**
 * Which view a SolvaPay MCP server knows how to bootstrap via the
 * corresponding `open_*` tool.
 *
 * The `'nudge'` view is opened implicitly when a successful paywalled
 * tool response carries `options.nudge`; it renders the merchant's
 * `data` alongside an inline upsell strip.
 */
export type SolvaPayMcpViewKind =
  | 'about'
  | 'checkout'
  | 'account'
  | 'topup'
  | 'activate'
  | 'paywall'
  | 'usage'
  | 'nudge'

export const SOLVAPAY_MCP_VIEW_KINDS = [
  'about',
  'checkout',
  'account',
  'topup',
  'activate',
  'paywall',
  'usage',
  'nudge',
] as const satisfies readonly SolvaPayMcpViewKind[]

/**
 * Minimal `kind`-tagged paywall content passed through `BootstrapPayload`
 * when the host opens the paywall view. The full
 * `PaywallStructuredContent` type lives in `@solvapay/server` (it's also
 * consumed by the non-MCP react paywall primitives); this shape is a
 * structural superset that adapters can forward without importing it.
 */
export interface SolvaPayMcpPaywallContent {
  kind: 'payment_required' | 'activation_required'
  [key: string]: unknown
}

/**
 * Payload returned by every `open_*` bootstrap tool and consumed by the
 * React MCP App shell to render the right view. Single source of truth —
 * the react bootstrap (`@solvapay/react/mcp`) imports this type so field
 * renames can't silently drift between server and client.
 *
 * Product-scoped fields (`merchant`, `product`, `plans`) are always
 * present so the shell can render without firing follow-up read tools.
 * `customer` is `null` when the call is unauthenticated; each nested
 * field is `null` when the corresponding sub-read errored or doesn't
 * apply (e.g. `paymentMethod: null` when no card is on file).
 */
export interface BootstrapPayload {
  view: SolvaPayMcpViewKind
  productRef: string
  stripePublishableKey: string | null
  returnUrl: string
  /** Only set for the `open_paywall` branch. */
  paywall?: SolvaPayMcpPaywallContent
  /**
   * Upsell strip spec attached when `view: 'nudge'`. Rendered above
   * the merchant tool result by `McpNudgeView`.
   */
  nudge?: NudgeSpec
  /**
   * Merchant tool result data embedded alongside a nudge so the shell
   * can surface it without a follow-up tool call. Only set when
   * `view: 'nudge'`.
   */
  data?: unknown
  merchant: BootstrapMerchant
  product: BootstrapProduct
  plans: BootstrapPlan[]
  customer: BootstrapCustomer | null
}

/**
 * Content Security Policy allow-list inputs merged with the Stripe
 * baseline by `SOLVAPAY_DEFAULT_CSP` / `mergeCsp`.
 */
export interface SolvaPayMcpCsp {
  resourceDomains?: string[]
  connectDomains?: string[]
  frameDomains?: string[]
}

/**
 * MCP tool annotations — hints to hosts about the tool's behaviour.
 * Structural subset of the official spec's `ToolAnnotations` so hosts
 * can surface confirmation prompts (destructive actions) and filter
 * tools appropriately (read-only vs. mutating).
 *
 * See https://modelcontextprotocol.io/specification for the full
 * semantics. Hosts on pre-annotations SDK versions ignore the field
 * without error — the wire shape is additive.
 */
export interface SolvaPayToolAnnotations {
  /** Human-readable title override (prefer the descriptor's `title`). */
  title?: string
  /** Tool only retrieves data — no side effects on SolvaPay state. */
  readOnlyHint?: boolean
  /** Tool has destructive / non-reversible side effects (charges, cancellations). */
  destructiveHint?: boolean
  /** Repeated calls with the same args produce the same effect. */
  idempotentHint?: boolean
  /** Tool interacts with external systems (true for every SolvaPay tool). */
  openWorldHint?: boolean
}

/**
 * Framework-neutral tool descriptor. Adapters translate this to their
 * own registration API (`registerAppTool` on the official SDK,
 * `tool.define` on mcp-lite, etc.).
 */
export interface SolvaPayToolDescriptor {
  name: string
  title?: string
  description: string
  /**
   * Zod raw shape — `{ fieldName: z.string() }`. Kept as `ZodTypeAny`
   * valued so zod stays an optional peer. Empty object = no args.
   */
  inputSchema: Record<string, ZodTypeAny>
  meta?: Record<string, unknown>
  /**
   * Portable MCP tool annotations surfaced on `tools/list`. Adapters
   * that support the upstream `ToolAnnotations` field forward these
   * verbatim; adapters that don't silently ignore them.
   */
  annotations?: SolvaPayToolAnnotations
  handler: (args: Record<string, unknown>, extra?: McpToolExtra) => Promise<SolvaPayCallToolResult>
}

/**
 * UI resource descriptor for the MCP App HTML bundle served alongside
 * the tool surface.
 */
export interface SolvaPayResourceDescriptor {
  uri: string
  mimeType: string
  csp: Required<SolvaPayMcpCsp>
  readHtml: () => Promise<string>
}

/**
 * Docs-style resource descriptor — a static markdown / text blob the
 * agent can `resources/read` for narrated context (e.g. the
 * `docs://solvapay/overview.md` "start here" guide). Kept separate from
 * `SolvaPayResourceDescriptor` because it has no CSP metadata and its
 * body is plain text, not the UI shell HTML.
 */
export interface SolvaPayDocsResourceDescriptor {
  /** Stable URI — typically `docs://solvapay/<slug>.md`. */
  uri: string
  /** Human-readable name surfaced in `resources/list`. */
  name: string
  /** Optional short title for host UIs that distinguish it from `name`. */
  title?: string
  /** Short one-liner surfaced in `resources/list` metadata. */
  description: string
  /** MIME type, typically `text/markdown` or `text/plain`. */
  mimeType: string
  /** Returns the body — sync or async. */
  readBody: () => string | Promise<string>
}

/**
 * One MCP prompt — rendered as `/<name>` in hosts with slash-command
 * support. Kept framework-neutral so every adapter (`mcp-sdk`,
 * `mcp-lite`, `fastmcp`) can map it to their own `registerPrompt`
 * shape.
 *
 * `argsSchema` matches the zod raw-shape shape the official SDK's
 * `registerPrompt` accepts — a plain object of `z.*` fields. Adapters
 * without zod-shape prompts can still call each field's `parse()`
 * themselves.
 */
export interface SolvaPayPromptDescriptor {
  name: string
  title?: string
  description: string
  argsSchema?: Record<string, ZodTypeAny>
  handler: (args: Record<string, unknown>) => SolvaPayPromptResult | Promise<SolvaPayPromptResult>
}

/**
 * Minimal `GetPromptResult` shape — structural subset of the official
 * SDK's type so adapters can forward it without importing
 * `@modelcontextprotocol/sdk/types.js`.
 */
export interface SolvaPayPromptResult {
  messages: Array<{
    role: 'user' | 'assistant'
    content: { type: 'text'; text: string }
  }>
}

/**
 * View → intent-tool map, derived from `MCP_TOOL_NAMES` so a new view
 * requires exactly one edit across the entire ecosystem.
 *
 * `paywall` has no dedicated intent tool — the paywall response carries
 * the bootstrap payload directly (`paywallToolResult` merges it into
 * `structuredContent`), so the shell renders the paywall view without
 * re-invoking a tool.
 */
export const TOOL_FOR_VIEW = {
  checkout: 'upgrade',
  account: 'manage_account',
  topup: 'topup',
  activate: 'activate_plan',
  usage: 'check_usage',
} as const satisfies Partial<
  Record<SolvaPayMcpViewKind, (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES]>
>

/**
 * Inverse of `TOOL_FOR_VIEW` — intent-tool name → view kind.
 */
export const VIEW_FOR_TOOL: Record<string, SolvaPayMcpViewKind> = Object.fromEntries(
  (Object.entries(TOOL_FOR_VIEW) as [SolvaPayMcpViewKind, string][]).map(([view, tool]) => [
    tool,
    view,
  ]),
)

/**
 * @deprecated Use `TOOL_FOR_VIEW`. Kept as an alias so the rename lands
 * without a simultaneous import update across the ecosystem.
 */
export const OPEN_TOOL_FOR_VIEW = TOOL_FOR_VIEW

/**
 * @deprecated Use `VIEW_FOR_TOOL`.
 */
export const VIEW_FOR_OPEN_TOOL = VIEW_FOR_TOOL

// ============================================================================
// `ctx.respond()` V1 API — see spec for semantics.
// ============================================================================

/**
 * Inline upsell strip attached to a successful tool response. Rendered
 * below the tool result by the host; dismissible, non-blocking.
 *
 * V1 ships three default kinds, each with a default CTA that opens the
 * `upgrade` intent tool. `kind: 'custom'` is reserved for V1.1.
 */
export interface NudgeSpec {
  kind: 'low-balance' | 'cycle-ending' | 'approaching-limit'
  message: string
}

/**
 * Intermediate content block emitted via `ctx.emit(block)`. Structural
 * subset of `SolvaPayCallToolResult.content` entries — text, image, or
 * resource.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: Record<string, unknown> }

/**
 * Options for `ctx.respond(data, options?)`.
 *
 * `text` overrides the SDK's default narrator output for this response.
 * `nudge` attaches an inline upsell strip.
 * `units` is reserved for V1.1 variable-unit billing; V1 silently
 * ignores the field (billing stays at one credit per tool call).
 */
export interface ResponseOptions {
  /** Override `content[0].text` with merchant-supplied text. */
  text?: string
  /** Inline upsell strip rendered below the tool result. */
  nudge?: NudgeSpec
  /**
   * [V1.1] Units to bill for this call. Defaults to 1. Must be >= 0.
   *
   * V1 behaviour: field is accepted for forward compatibility but
   * silently ignored. Billing stays fixed at one credit per tool call.
   * V1.1 behaviour: threaded into `trackUsage` and applied by the backend.
   */
  units?: number
}

/**
 * Branded envelope returned by `ctx.respond(data, options?)`. The brand
 * symbol is module-private — merchants never construct `ResponseResult`
 * values directly. `buildPayableHandler` unwraps the envelope into a
 * `SolvaPayCallToolResult` before shipping.
 */
export interface ResponseResult<TData = unknown> {
  /**
   * Opaque brand marker — typed as `true` so the envelope is
   * structurally distinguishable from raw merchant data even without
   * the runtime symbol.
   */
  readonly __solvapayResponse: true
  readonly data: TData
  readonly options?: ResponseOptions
  /**
   * Content blocks queued via `ctx.emit(block)` before the terminal
   * `respond()` call. V1 flushes these into `content[]` at respond
   * time; V1.1 emits them over SSE.
   */
  readonly emittedBlocks?: ContentBlock[]
}

/**
 * Cached snapshot of customer state at handler invocation.
 *
 * Populated from the existing `LimitResponse` returned by
 * `payable().mcp()`'s pre-check — zero additional fetch cost.
 *
 * IMPORTANT: values here may be up to 10 seconds stale after mutations
 * (topup, plan change, cancel) within the same process. For fresh
 * state, call `.fresh()`.
 */
export interface CustomerSnapshot {
  /** Backend customer ref (`cus_...`). */
  readonly ref: string
  /** Credit balance in mils. 0 when the backend didn't surface a balance. */
  readonly balance: number
  /** Remaining usage units before hitting the limit. `null` when unlimited. */
  readonly remaining: number | null
  /** Whether the customer is within their usage limits at snapshot time. */
  readonly withinLimits: boolean
  /**
   * Active plan on the purchase. `null` when the customer has no
   * active purchase or is on a free plan.
   */
  readonly plan: BootstrapPlan | null

  /**
   * Force a fresh fetch bypassing the 10s limits cache.
   * Returns a new snapshot; does NOT mutate the current one.
   */
  fresh(): Promise<CustomerSnapshot>
}

/**
 * Handler context passed as the second positional argument to merchant
 * `registerPayable` handlers opting into the V1 `ctx` API.
 *
 * V1 surface: `customer`, `product`, `respond`, `gate`.
 * Reserved (V1.1): `emit`, `progress`, `progressRaw`, `signal` — types
 * ship in V1 so merchants can write forward-compatible code.
 */
export interface ResponseContext {
  /**
   * Customer snapshot at handler invocation. See `CustomerSnapshot`
   * for staleness semantics.
   */
  customer: CustomerSnapshot

  /** Read-only product configuration from the bootstrap payload. */
  product: BootstrapProduct

  /** Build a response. Two forms, both valid. */
  respond<TData>(data: TData): ResponseResult<TData>
  respond<TData>(data: TData, options: ResponseOptions): ResponseResult<TData>

  /**
   * Explicitly trigger a paywall response. Sugar over
   * `throw new PaywallError(reason)`. Handler execution stops.
   *
   * Rare — normally the SDK fires the paywall automatically via
   * `payable().mcp()` pre-check.
   */
  gate(reason?: string): never

  // ——————————————————————————————————————————————————————————————
  // Reserved API surface — types ship in V1, implementations in V1.1.
  // ——————————————————————————————————————————————————————————————

  /**
   * [V1.1] Emit an intermediate content block.
   *
   * V1 behaviour: queued and flushed at the terminal `respond()`. No SSE.
   * V1.1 behaviour: emits immediately over Streamable HTTP + SSE.
   *
   * Reserved so merchants can write forward-compatible streaming code
   * today.
   */
  emit(block: ContentBlock): Promise<void>

  /**
   * [V1.1] Emit a progress notification with a percent.
   *
   * V1 behaviour: no-op.
   * V1.1 behaviour: sends `notifications/progress` if the client
   * supplied a `progressToken`; no-op otherwise.
   */
  progress(options: { percent: number; message?: string }): Promise<void>

  /**
   * [V1.1] Emit a progress notification with non-percent units.
   *
   * V1 behaviour: no-op.
   * V1.1 behaviour: sends `notifications/progress` with raw
   * progress/total.
   */
  progressRaw(options: { progress: number; total?: number; message?: string }): Promise<void>

  /**
   * [V1.1] AbortSignal that fires when the client cancels the tool call.
   *
   * V1 behaviour: always an unaborted signal.
   * V1.1 behaviour: wired to the underlying transport cancellation.
   *
   * Merchants pass this to their upstream fetch/LLM/image-gen calls to
   * cancel expensive operations when the client goes away.
   */
  signal: AbortSignal
}

/**
 * Merchant handler signature for `registerPayable`. Accepts the new
 * `(args, ctx)` shape and the legacy `(args, extra?)` shape; a handler
 * that returns raw data (backwards-compatible) or a `ResponseResult`
 * envelope (via `ctx.respond(...)`) both work.
 */
export type PayableHandler<TArgs = Record<string, unknown>, TData = unknown> = (
  args: TArgs,
  ctx: ResponseContext,
) => Promise<ResponseResult<TData> | TData>
