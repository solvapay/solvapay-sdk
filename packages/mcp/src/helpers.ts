/**
 * Shared building blocks for `buildSolvaPayDescriptors` and any hand-rolled
 * SolvaPay MCP server that prefers to register tools directly.
 *
 * Lifted from the canonical example at `examples/mcp-checkout-app/src/server.ts`
 * so every integrator gets the same behavior for price enrichment, synthetic
 * `Request` construction, and tool-result wrapping.
 */

import type { BootstrapPayload, McpToolExtra, SolvaPayCallToolResult } from './types'
import { NARRATORS, type IntentTool } from './narrate'

/**
 * ISO 4217 currencies where the "minor unit" equals the major unit.
 * Kept in sync with `@solvapay/react`'s `formatPrice`.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
])

function formatMinorUnits(
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (amountMinor == null || !currency) return null
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase())
  const fractionDigits = zeroDecimal ? 0 : 2
  const major = zeroDecimal ? amountMinor : amountMinor / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(major)
  } catch {
    return null
  }
}

/**
 * Augment a purchase with human-readable price strings so callers (LLMs
 * rendering the JSON directly) don't have to reason about minor units.
 *
 * Raw `amount` / `originalAmount` / `currency` fields are preserved for
 * programmatic consumers (e.g. the React transport).
 */
export function enrichPurchase(purchase: Record<string, unknown>): Record<string, unknown> {
  const amount = typeof purchase.amount === 'number' ? purchase.amount : undefined
  const originalAmount =
    typeof purchase.originalAmount === 'number' ? purchase.originalAmount : undefined
  const currency = typeof purchase.currency === 'string' ? purchase.currency : undefined

  const priceDisplay =
    formatMinorUnits(originalAmount, currency) ?? formatMinorUnits(amount, 'USD')

  const priceUsdDisplay =
    currency && currency.toUpperCase() !== 'USD' ? formatMinorUnits(amount, 'USD') : null

  const planSnapshot = purchase.planSnapshot
  const enrichedPlanSnapshot =
    planSnapshot && typeof planSnapshot === 'object'
      ? (() => {
          const snap = planSnapshot as Record<string, unknown>
          const price = typeof snap.price === 'number' ? snap.price : undefined
          const snapCurrency = typeof snap.currency === 'string' ? snap.currency : undefined
          const snapPriceDisplay = formatMinorUnits(price, snapCurrency)
          return snapPriceDisplay ? { ...snap, priceDisplay: snapPriceDisplay } : snap
        })()
      : planSnapshot

  return {
    ...purchase,
    ...(priceDisplay ? { priceDisplay } : {}),
    ...(priceUsdDisplay ? { priceUsdDisplay } : {}),
    ...(enrichedPlanSnapshot !== undefined ? { planSnapshot: enrichedPlanSnapshot } : {}),
  }
}

/**
 * Default extractor for `customer_ref` out of the MCP OAuth bridge. Reads
 * `extra.authInfo.extra.customer_ref` (what `auth-bridge.ts` populates) and
 * trims it. Returns `null` when no ref is present.
 */
export function defaultGetCustomerRef(extra?: McpToolExtra): string | null {
  const fromExtra = extra?.authInfo?.extra?.customer_ref
  if (typeof fromExtra === 'string' && fromExtra.trim()) {
    return fromExtra.trim()
  }
  return null
}

export interface BuildSolvaPayRequestOptions {
  method?: string
  query?: Record<string, string | undefined>
  body?: unknown
  /**
   * Override the customer ref that is forwarded as the `x-user-id` header.
   * Defaults to reading `extra.authInfo.extra.customer_ref`.
   */
  getCustomerRef?: (extra?: McpToolExtra) => string | null
  /**
   * Override the synthetic origin used in the request URL. Defaults to
   * `http://solvapay-mcp-server.local/`.
   */
  origin?: string
}

/**
 * Build a synthetic Web `Request` the core `*Core` helpers can consume.
 *
 * The `x-user-id` header is what `getAuthenticatedUserCore` reads as the
 * authoritative user identity, so forwarding the `customer_ref` from the
 * MCP OAuth bridge keeps the entire flow headless.
 */
export function buildSolvaPayRequest(
  extra: McpToolExtra | undefined,
  options: BuildSolvaPayRequestOptions = {},
): Request {
  const {
    method = 'GET',
    query,
    body,
    getCustomerRef = defaultGetCustomerRef,
    origin = 'http://solvapay-mcp-server.local/',
  } = options
  const url = new URL(origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value)
    }
  }

  const headers = new Headers()
  const customerRef = getCustomerRef(extra)
  if (customerRef) {
    headers.set('x-user-id', customerRef)
  }
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers.set('content-type', 'application/json')
    init.body = JSON.stringify(body)
  }
  return new Request(url, init)
}

/**
 * Wrap arbitrary data in a `SolvaPayCallToolResult`. Produces a `text`
 * content block and `structuredContent` so both LLM-facing and tool-call
 * consumers see a consistent shape.
 */
export function toolResult(data: unknown): SolvaPayCallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  }
}

/**
 * Requested rendering mode per-call. Passed through the `mode` input
 * arg of every intent tool.
 *
 * - `'auto'` (default) — emit both the UI resource ref on `_meta.ui`
 *   and the narrated markdown text. Host picks.
 * - `'text'` — strip the UI resource ref so UI-capable hosts also
 *   render text-only for this call.
 * - `'ui'` — replace the narrated markdown with a short placeholder
 *   so the chat transcript stays tidy on UI-rendering hosts.
 */
export type SolvaPayToolMode = 'ui' | 'text' | 'auto'

export function parseMode(raw: unknown): SolvaPayToolMode {
  if (raw === 'ui' || raw === 'text' || raw === 'auto') return raw
  return 'auto'
}

/**
 * Build a `SolvaPayCallToolResult` that respects the requested `mode`:
 *
 *  - `auto`/`text` — narrated markdown in `content[0]`, plus
 *    `resource_link` blocks for external URLs the narrator provides.
 *    `structuredContent` is always the raw bootstrap payload so agents
 *    parsing JSON see the source of truth.
 *  - `text` also strips `_meta.ui.*` so UI-capable hosts render the
 *    text content only.
 *  - `ui` replaces the narrated markdown with a short placeholder
 *    (still non-empty — MCP requires at least one content block).
 *
 * The narrator is picked by the `tool` name; unknown tools fall back
 * to the JSON dump that `toolResult` produces today.
 */
export function narratedToolResult(
  tool: IntentTool | string,
  data: BootstrapPayload,
  mode: SolvaPayToolMode = 'auto',
  baseMeta: Record<string, unknown> | undefined = undefined,
): SolvaPayCallToolResult {
  const narrator = (NARRATORS as Record<string, (d: BootstrapPayload) => { text: string; links?: Array<{ uri: string; name: string }> }>)[tool]
  if (!narrator) {
    const fallback = toolResult(data)
    if (mode === 'text' && baseMeta && 'ui' in baseMeta) {
      const { ui: _ui, ...rest } = baseMeta as Record<string, unknown>
      return { ...fallback, _meta: rest }
    }
    return baseMeta ? { ...fallback, _meta: baseMeta } : fallback
  }

  const { text, links } = narrator(data)
  const productName =
    (data.product as { name?: string } | undefined)?.name ?? 'this app'

  const content: SolvaPayCallToolResult['content'] =
    mode === 'ui'
      ? [{ type: 'text', text: `Opening your ${productName} account…` }]
      : [
          { type: 'text', text },
          // `resource_link` isn't in the structural content union we
          // use for `SolvaPayCallToolResult`, but the official SDK
          // accepts it — we cast at the boundary to keep the local
          // type narrow while still shipping the enrichment.
          ...((links ?? []).map((l) => ({
            type: 'resource_link',
            uri: l.uri,
            name: l.name,
          })) as unknown as SolvaPayCallToolResult['content']),
        ]

  const meta =
    mode === 'text' && baseMeta && 'ui' in baseMeta
      ? Object.fromEntries(Object.entries(baseMeta).filter(([k]) => k !== 'ui'))
      : baseMeta

  return {
    content,
    structuredContent: data as unknown as Record<string, unknown>,
    ...(meta ? { _meta: meta } : {}),
  }
}

/**
 * Wrap an error payload (typically the result of `handleRouteError`) in a
 * `SolvaPayCallToolResult` with `isError: true`.
 */
export function toolErrorResult(error: {
  error: string
  status: number
  details?: string
}): SolvaPayCallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(error) }],
    structuredContent: error as unknown as Record<string, unknown>,
  }
}

/**
 * Truncate a JSON preview to a max length so trace logs stay readable.
 */
export function previewJson(value: unknown, max = 400): string {
  try {
    const json = JSON.stringify(value)
    if (!json) return String(value)
    return json.length > max ? `${json.slice(0, max)}…(+${json.length - max} chars)` : json
  } catch {
    return String(value)
  }
}
