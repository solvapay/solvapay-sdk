/**
 * `applyHideToolsByAudience(server, audiences, options?)` — wraps the
 * `tools/list` request handler on an `@modelcontextprotocol/server`
 * `McpServer` so tool descriptors whose `_meta.audience` matches one
 * of the supplied values are filtered out of the response.
 *
 * The tools stay `enabled: true` on the server, so `tools/call` still
 * reaches their handlers — this helper only affects the `tools/list`
 * response shape. Use `['ui']` when deploying to a text-host MCP
 * client (Claude Desktop, MCPJam, ChatGPT connector) that won't
 * embed the SolvaPay iframe surface, while still allowing the iframe
 * to invoke the hidden transport tools (`create_payment_intent` etc.)
 * for server-side work.
 *
 * # ChatGPT auto-bypass
 *
 * ChatGPT's Custom Connector gateway re-validates iframe-initiated
 * `tools/call` against the cached `tools/list` catalog. A tool hidden
 * from `tools/list` becomes uncallable from the embedded iframe and
 * surfaces in the UI as `MCP error -32000: MCP Resource not found`.
 *
 * To keep the cleaner LLM-facing catalog on every other host while
 * the iframe still works on ChatGPT, the default behaviour
 * automatically returns the **full** unfiltered catalog when the
 * incoming `tools/list` request originates from ChatGPT — detected by
 * matching `requestInfo.headers.get('user-agent')` against
 * `/openai-mcp/i`. On 2026-era connections there is no `initialize`
 * handshake, so the User-Agent header is the primary signal; the
 * post-`initialize` `getClientVersion()` fallback remains for legacy-era
 * relays that strip the client UA.
 *
 * Override the detection by passing `bypassWhen` — useful when a
 * future iframe-capable host needs the same treatment, or when
 * ChatGPT-served deployments want the LLM-narrow catalog regardless
 * (`bypassWhen: () => false`).
 *
 * No-op when `audiences` is empty or falsy.
 *
 * This helper is exported from `@solvapay/mcp-core` so both
 * `@solvapay/mcp` (stacked `createSolvaPayMcpServer`) and
 * `@solvapay/mcp/fetch` (unified `createSolvaPayMcpFetch`) can apply
 * the same filter without each re-implementing the reach-in.
 */

import { callMcpSyncOp } from './native-mcp'

/**
 * Structural shape of the subset of `McpServer` we need. Typed
 * structurally so `@solvapay/mcp-core` stays free of any
 * `@modelcontextprotocol/server` runtime or type dependency.
 */
interface McpServerLike {
  server: {
    _requestHandlers: Map<
      string,
      (req: unknown, ctx: unknown) => Promise<ToolsListResponseLike>
    >
    removeRequestHandler?: (method: string) => void
    setRequestHandler?: (
      method: string,
      handler: (req: unknown, ctx: unknown) => Promise<ToolsListResponseLike>,
    ) => void
    getClientVersion?: () => { name?: unknown } | undefined
  }
}

interface ToolDescriptorLike {
  _meta?: { audience?: unknown } | undefined
  [key: string]: unknown
}

interface ToolsListResponseLike {
  tools?: ToolDescriptorLike[]
  [key: string]: unknown
}

/** Headers from a Web `Request` or legacy isomorphic record shape. */
type RequestHeaders = Headers | Record<string, string | string[] | undefined>

/**
 * Subset of the MCP SDK handler context that the bypass predicate inspects.
 * Typed loosely so we don't couple to the SDK's exact shape.
 */
export interface ApplyHideToolsByAudienceExtra {
  requestInfo?: Request | { headers?: RequestHeaders } | undefined
  [key: string]: unknown
}

export interface ApplyHideToolsByAudienceContext {
  /** The MCP server instance the filter is being applied to. */
  server: unknown
  /**
   * Handler context the SDK passed to the wrapped `tools/list` handler.
   * May be undefined for non-HTTP transports (e.g. stdio).
   */
  extra?: ApplyHideToolsByAudienceExtra
}

export type HideToolsByAudienceBypass = (ctx: ApplyHideToolsByAudienceContext) => boolean

export interface ApplyHideToolsByAudienceOptions {
  /**
   * When this predicate returns `true` for an incoming `tools/list`
   * request, the audience filter is skipped and the full catalog is
   * returned. Defaults to `defaultIsChatGptRequest` — see the file
   * header for the rationale.
   */
  bypassWhen?: HideToolsByAudienceBypass
}

/** Liberal pattern matching ChatGPT's MCP runtime client. */
const CHATGPT_CLIENT_RE = /openai-mcp/i

export type HideToolsByAudienceResult = {
  tools: ToolDescriptorLike[]
  bypassed?: boolean
}

/** Data-plane audience filter (`mcpHideToolsByAudience`). */
export function hideToolsByAudience(
  tools: ToolDescriptorLike[],
  audiences: readonly string[],
  userAgent?: string,
): HideToolsByAudienceResult {
  if (audiences.length === 0) return { tools }
  return callMcpSyncOp('mcpHideToolsByAudience', {
    tools,
    audiences: [...audiences],
    ...(userAgent !== undefined ? { userAgent } : {}),
  })
}

function readHeader(headers: RequestHeaders | undefined, name: string): string | undefined {
  if (!headers) return undefined
  if (headers instanceof Headers) {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined
  }
  const raw = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0]
  return typeof raw === 'string' ? raw : undefined
}

function readUserAgentFromContext(ctx: ApplyHideToolsByAudienceContext): string | undefined {
  const requestInfo = ctx.extra?.requestInfo
  if (requestInfo instanceof Request) {
    return requestInfo.headers.get('user-agent') ?? undefined
  }
  return readHeader(requestInfo?.headers, 'user-agent')
}

/**
 * Default `bypassWhen` — returns true when the incoming request looks
 * like it's coming from ChatGPT's MCP runtime.
 */
export function defaultIsChatGptRequest(ctx: ApplyHideToolsByAudienceContext): boolean {
  const ua = readUserAgentFromContext(ctx)
  if (ua && CHATGPT_CLIENT_RE.test(ua)) return true

  const clientVersion = (ctx.server as McpServerLike | undefined)?.server?.getClientVersion?.()
  const clientName = typeof clientVersion?.name === 'string' ? clientVersion.name : undefined
  return clientName !== undefined && CHATGPT_CLIENT_RE.test(clientName)
}

export function applyHideToolsByAudience(
  server: unknown,
  audiences: readonly string[] | undefined,
  options: ApplyHideToolsByAudienceOptions = {},
): void {
  if (!audiences || audiences.length === 0) return
  const bypassWhen = options.bypassWhen ?? defaultIsChatGptRequest

  const inner = (server as McpServerLike).server
  if (!inner || typeof inner !== 'object' || !(inner._requestHandlers instanceof Map)) {
    return
  }
  const handlers = inner._requestHandlers
  const original = handlers.get('tools/list')
  if (!original) return

  const warned = new Set<string>()

  const wrapped = async (req: unknown, ctx: unknown) => {
    const res = await original(req, ctx)
    if (
      bypassWhen({
        server,
        extra: ctx as ApplyHideToolsByAudienceExtra | undefined,
      })
    ) {
      const ua = readUserAgentFromContext({
        server,
        extra: ctx as ApplyHideToolsByAudienceExtra | undefined,
      })
      const context = ua ? `ua=${ua}` : 'no user-agent'
      if (!warned.has(context)) {
        warned.add(context)
        console.warn(
          `[solvapay/mcp] hideToolsByAudience filter bypassed (${context}); returning full tools/list catalog.`,
        )
      }
      return res
    }
    const listed = Array.isArray(res?.tools) ? res.tools : []
    const ua = readUserAgentFromContext({
      server,
      extra: ctx as ApplyHideToolsByAudienceExtra | undefined,
    })
    const filtered = hideToolsByAudience(
      listed,
      audiences,
      options.bypassWhen ? undefined : ua,
    )
    if (filtered.bypassed) {
      const context = ua ? `ua=${ua}` : 'no user-agent'
      if (!warned.has(context)) {
        warned.add(context)
        console.warn(
          `[solvapay/mcp] hideToolsByAudience filter bypassed (${context}); returning full tools/list catalog.`,
        )
      }
      return res
    }
    return {
      ...res,
      tools: filtered.tools,
    }
  }

  if (typeof inner.setRequestHandler === 'function') {
    inner.setRequestHandler('tools/list', wrapped)
    return
  }

  handlers.set('tools/list', wrapped)
}
