/**
 * Shared building blocks for `buildSolvaPayDescriptors` and any hand-rolled
 * SolvaPay MCP server that prefers to register tools directly.
 *
 * Lifted from the canonical example at `examples/mcp-checkout-app/src/server.ts`
 * so every integrator gets the same behavior for price enrichment, synthetic
 * `Request` construction, and tool-result wrapping.
 */

import type {
  BootstrapPayload,
  McpToolExtra,
  SolvaPayCallToolResult,
  SolvaPayMcpViewKind,
} from './types'
import { NARRATORS, uiPlaceholder } from './narrate'

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
 * Default extractor for `customer_ref` out of the MCP OAuth bridge
 * (what `auth-bridge.ts` populates), trimmed. Returns `null` when no
 * ref is present.
 *
 * Checks `extra.http.authInfo` first — the official SDK v2 location —
 * then falls back to the flat v1 `extra.authInfo` still emitted by some
 * third-party adapters. Reading only the flat location silently
 * de-authenticated every tool call under SDK v2.
 */
export function defaultGetCustomerRef(extra?: McpToolExtra): string | null {
  const candidates = [
    extra?.http?.authInfo?.extra?.customer_ref,
    extra?.authInfo?.extra?.customer_ref,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
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
 * - `'auto'` (default) — emit the narrated markdown as `content[0]`
 *   and keep the UI resource ref on `_meta.ui`. Text-only hosts see
 *   a self-sufficient first text block; UI hosts still open the iframe.
 * - `'text'` — strip the UI resource ref and emit the narrated
 *   markdown so CLI / text-only hosts get a human summary.
 * - `'ui'` — emit a one-line placeholder in `content[0]` alongside
 *   the UI resource ref. The placeholder is still self-sufficient
 *   (plan, price, https URL) — never a pointer at "the panel".
 */
export type SolvaPayToolMode = 'ui' | 'text' | 'auto'

export function parseMode(raw: unknown): SolvaPayToolMode {
  if (raw === 'ui' || raw === 'text' || raw === 'auto') return raw
  return 'auto'
}

/**
 * Build a `SolvaPayCallToolResult` that respects the requested `mode`:
 *
 *  - `auto` (default) emits the narrated markdown as `content[0]` and
 *    keeps `_meta.ui.*` so UI-rendering hosts still open the iframe.
 *    `structuredContent` still carries the raw bootstrap payload.
 *  - `text` emits the narrated markdown (plus any `resource_link`
 *    blocks) and strips `_meta.ui.*` so UI-capable hosts render
 *    text-only for this call.
 *  - `ui` emits a one-line self-sufficient placeholder in `content[0]`
 *    and keeps `_meta.ui.*`. Do not annotate the narrated block with
 *    `audience: ['assistant']` — audience-aware hosts hide those
 *    blocks from the user, and hosts that ignore the annotation must
 *    still see a useful `content[0]`.
 *
 * The narrator is picked by the `tool` name; unknown tools fall back
 * to the JSON dump that `toolResult` produces today.
 *
 * Meta keys other than `ui` (notably `openai/widgetSessionId`, the
 * ChatGPT MCP routing-bug workaround stamped by intent tools — see
 * the descriptors.ts top-of-file comment) are preserved across all
 * three modes. Don't strip additional `_meta` keys here without
 * checking `descriptors.ts` first.
 */
export function narratedToolResult(
  view: SolvaPayMcpViewKind | string,
  data: BootstrapPayload,
  mode: SolvaPayToolMode = 'auto',
  baseMeta: Record<string, unknown> | undefined = undefined,
): SolvaPayCallToolResult {
  const narrator = (
    NARRATORS as Record<
      string,
      (d: BootstrapPayload) => { text: string; links?: Array<{ uri: string; name: string }> }
    >
  )[view]
  if (!narrator) {
    const fallback = toolResult(data)
    if (mode === 'text' && baseMeta && 'ui' in baseMeta) {
      const { ui: _ui, ...rest } = baseMeta as Record<string, unknown>
      return { ...fallback, _meta: rest }
    }
    return baseMeta ? { ...fallback, _meta: baseMeta } : fallback
  }

  const { text, links } = narrator(data)

  const narratedBlock: SolvaPayCallToolResult['content'][number] = {
    type: 'text',
    text,
  }

  const resourceLinkBlocks = ((links ?? []).map((l) => ({
    type: 'resource_link',
    uri: l.uri,
    name: l.name,
    // `resource_link` isn't in the structural content union we use for
    // `SolvaPayCallToolResult`, but the official SDK accepts it — we
    // cast at the boundary to keep the local type narrow while still
    // shipping the enrichment.
  })) as unknown as SolvaPayCallToolResult['content'])

  const placeholderBlock: SolvaPayCallToolResult['content'][number] = {
    type: 'text',
    text: uiPlaceholder(view as SolvaPayMcpViewKind, data),
  }

  const content: SolvaPayCallToolResult['content'] =
    mode === 'ui'
      ? [placeholderBlock, narratedBlock]
      : [narratedBlock, ...resourceLinkBlocks]

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
 *
 * `content[0].text` carries a human-readable message — `details` when
 * present (typically the full multi-line recovery text from
 * `handleRouteError`), falling back to the short `error`. MCP clients
 * that show tool errors verbatim therefore display recovery guidance
 * instead of a stringified JSON blob.
 *
 * `structuredContent` still carries the full `{ error, status, details }`
 * envelope so programmatic consumers (verify.mjs, test.mjs, the
 * paywall transport) can branch on `status` without parsing text.
 */
export function toolErrorResult(error: {
  error: string
  status: number
  details?: string
}): SolvaPayCallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: error.details ?? error.error }],
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
