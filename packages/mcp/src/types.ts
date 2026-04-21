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
import type { MCP_TOOL_NAMES } from './tool-names'

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
 */
export interface BootstrapPayload {
  view: SolvaPayMcpViewKind
  productRef: string
  stripePublishableKey: string | null
  returnUrl: string
  /** Only set for the `open_paywall` branch. */
  paywall?: SolvaPayMcpPaywallContent
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
 * View → open_* tool map, derived from `MCP_TOOL_NAMES` so a new view
 * requires exactly one edit across the entire ecosystem.
 */
export const OPEN_TOOL_FOR_VIEW = {
  checkout: 'open_checkout',
  account: 'open_account',
  topup: 'open_topup',
  activate: 'open_plan_activation',
  paywall: 'open_paywall',
  usage: 'open_usage',
} as const satisfies Record<SolvaPayMcpViewKind, (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES]>

/**
 * Inverse of `OPEN_TOOL_FOR_VIEW` — `open_*` tool name → view kind.
 */
export const VIEW_FOR_OPEN_TOOL: Record<string, SolvaPayMcpViewKind> = Object.fromEntries(
  (Object.entries(OPEN_TOOL_FOR_VIEW) as [SolvaPayMcpViewKind, string][]).map(([view, tool]) => [
    tool,
    view,
  ]),
)
