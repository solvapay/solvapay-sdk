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
 */
export type SolvaPayMcpViewKind = 'checkout' | 'account' | 'topup' | 'activate' | 'paywall' | 'usage'

export const SOLVAPAY_MCP_VIEW_KINDS = [
  'checkout',
  'account',
  'topup',
  'activate',
  'paywall',
  'usage',
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
