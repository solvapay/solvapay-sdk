/**
 * Shared building blocks for `buildSolvaPayDescriptors` and any hand-rolled
 * SolvaPay MCP server that prefers to register tools directly.
 *
 * Lifted from the canonical example at `examples/mcp-checkout-app/src/server.ts`
 * so every integrator gets the same behavior for price enrichment, synthetic
 * `Request` construction, and tool-result wrapping.
 */

import type { McpToolExtra, SolvaPayCallToolResult } from './types'

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
