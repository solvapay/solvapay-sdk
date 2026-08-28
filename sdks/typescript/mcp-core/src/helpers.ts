/**
 * Shared building blocks for `buildSolvaPayDescriptors` and any hand-rolled
 * SolvaPay MCP server that prefers to register tools directly.
 *
 * Lifted from the canonical example at `examples/typescript/mcp-checkout-app/src/server.ts`
 * so every integrator gets the same behavior for price enrichment, synthetic
 * `Request` construction, and tool-result wrapping.
 */

import { callMcpSyncOp } from './native-mcp'
import type { BootstrapPayload, McpToolExtra, SolvaPayCallToolResult } from './types'
import type { IntentTool } from './narrate'

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
 * - `'ui'` (default) — emit a one-line placeholder in `content[0]`
 *   alongside the UI resource ref on `_meta.ui`. Keeps UI-rendering
 *   hosts (MCP Inspector, ChatGPT Apps, Claude Desktop) tidy — the
 *   iframe already carries the rich detail. Agents get the full
 *   `BootstrapPayload` on `structuredContent` for grounding.
 * - `'text'` — strip the UI resource ref and emit the full narrated
 *   markdown so CLI / text-only hosts get a human summary.
 * - `'auto'` — same user-visible envelope as `'ui'` (placeholder +
 *   `_meta.ui`) plus the assistant-audience narration. Hosts that
 *   omit the placeholder (MCPJam) never mount the iframe.
 */
export type SolvaPayToolMode = 'ui' | 'text' | 'auto'

export function parseMode(raw: unknown): SolvaPayToolMode {
  if (raw === 'ui' || raw === 'text' || raw === 'auto') return raw
  return 'ui'
}

/**
 * Build a `SolvaPayCallToolResult` that respects the requested `mode`:
 *
 *  - `ui` (default) emits a one-line placeholder in `content[0]` and
 *    keeps `_meta.ui.*` so UI-rendering hosts open the iframe without
 *    a noisy narration beneath it. `structuredContent` still carries
 *    the raw bootstrap payload so agents have full grounding.
 *  - `text` emits the full narrated markdown (plus any
 *    `resource_link` blocks) and strips `_meta.ui.*` so UI-capable
 *    hosts render text-only for this call.
 *  - `auto` emits the same placeholder + `_meta.ui` envelope as `ui`,
 *    plus the assistant-audience narration.
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
  tool: IntentTool | string,
  data: BootstrapPayload,
  mode: SolvaPayToolMode = 'ui',
  baseMeta: Record<string, unknown> | undefined = undefined,
): SolvaPayCallToolResult {
  return callMcpSyncOp<SolvaPayCallToolResult>('mcpNarrate', {
    tool,
    payload: data,
    mode,
    ...(baseMeta !== undefined ? { meta: baseMeta } : {}),
  })
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
