/**
 * `applyHideToolsByAudience(server, audiences, options?)` — wraps the
 * `tools/list` request handler on an `@modelcontextprotocol/sdk`
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
 * matching `request.headers['user-agent']` and the post-`initialize`
 * `server.getClientVersion().name` against `/openai-mcp/i`. The first
 * triggers on the discovery `tools/list` ChatGPT issues before
 * `initialize` (so `getClientVersion()` is empty); the second is a
 * defence-in-depth fallback for any future relay that strips the
 * client UA.
 *
 * The User-Agent shape was confirmed live against ChatGPT's MCP
 * runtime (`openai-mcp/1.0.0 (ChatGPT)` as of 2026-05). The pattern
 * is intentionally broad so a UA bump to `openai-mcp/2.x` keeps
 * working without code changes.
 *
 * Override the detection by passing `bypassWhen` — useful when a
 * future iframe-capable host needs the same treatment, or when
 * ChatGPT-served deployments want the LLM-narrow catalog regardless
 * (`bypassWhen: () => false`).
 *
 * # Internal-map reach-in rationale
 *
 * `Protocol.setRequestHandler` contains an `assertCanSetRequestHandler`
 * guard that fails when the SDK has already registered a handler for
 * the method during registration — i.e. `tools/list` after any tool
 * registration. The guard only fires through the public wrapper; the
 * underlying `_requestHandlers` map accepts a replacement silently.
 * Touching the map directly therefore sidesteps the guard without
 * going through public API surface that could change in a minor SDK
 * bump. The one piece of SDK-internal knowledge we live with until
 * the SDK ships a first-class "replace handler" affordance.
 *
 * No-op when `audiences` is empty or falsy.
 *
 * This helper is exported from `@solvapay/mcp-core` so both
 * `@solvapay/mcp` (stacked `createSolvaPayMcpServer`) and
 * `@solvapay/mcp/fetch` (unified `createSolvaPayMcpFetch`) can apply
 * the same filter without each re-implementing the reach-in.
 */

/**
 * Structural shape of the subset of `McpServer` we need. Typed
 * structurally so `@solvapay/mcp-core` stays free of any
 * `@modelcontextprotocol/sdk` runtime or type dependency.
 */
interface McpServerLike {
  server: {
    _requestHandlers: Map<
      string,
      (req: unknown, extra: unknown) => Promise<ToolsListResponseLike>
    >
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

/**
 * Headers shape exposed by the MCP SDK's `RequestHandlerExtra.requestInfo`.
 * Mirrors `IsomorphicHeaders` from the SDK without taking a type dep.
 */
type IsomorphicHeaders = Record<string, string | string[] | undefined>

/**
 * Subset of `RequestHandlerExtra` (from `@modelcontextprotocol/sdk`)
 * that the bypass predicate inspects. Typed loosely so we don't
 * couple to the SDK's exact shape.
 */
export interface ApplyHideToolsByAudienceExtra {
  requestInfo?: { headers?: IsomorphicHeaders } | undefined
  [key: string]: unknown
}

export interface ApplyHideToolsByAudienceContext {
  /** The MCP server instance the filter is being applied to. */
  server: unknown
  /**
   * The `RequestHandlerExtra` the SDK passed to the wrapped
   * `tools/list` handler. May be undefined for non-HTTP transports
   * (e.g. stdio) where there's no request information.
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
   *
   * Pass an integrator-supplied predicate to extend the bypass to
   * another host (e.g. a future iframe-capable client), or `() =>
   * false` to apply the filter unconditionally.
   */
  bypassWhen?: HideToolsByAudienceBypass
}

/**
 * Liberal pattern matching ChatGPT's MCP runtime client. Verified
 * live against `openai-mcp/1.0.0 (ChatGPT)`; written to also match a
 * future `openai-mcp/2.x` or `openai-mcp-experimental` without code
 * change.
 */
const CHATGPT_CLIENT_RE = /openai-mcp/i

function readHeader(headers: IsomorphicHeaders | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const raw = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0]
  return typeof raw === 'string' ? raw : undefined
}

/**
 * Default `bypassWhen` — returns true when the incoming request looks
 * like it's coming from ChatGPT's MCP runtime. Two signals:
 *
 *  1. HTTP `User-Agent` header (works on the pre-`initialize`
 *     discovery `tools/list`, so we have a signal even before the
 *     SDK's `getClientVersion()` is populated).
 *  2. `server.getClientVersion()?.name` (covers any host that relays
 *     ChatGPT requests without forwarding the upstream UA).
 */
export function defaultIsChatGptRequest(ctx: ApplyHideToolsByAudienceContext): boolean {
  const ua = readHeader(ctx.extra?.requestInfo?.headers, 'user-agent')
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
  const hidden = new Set(audiences)
  const bypassWhen = options.bypassWhen ?? defaultIsChatGptRequest

  const inner = (server as McpServerLike).server
  if (!inner || typeof inner !== 'object' || !(inner._requestHandlers instanceof Map)) {
    return
  }
  const handlers = inner._requestHandlers
  const original = handlers.get('tools/list')
  if (!original) return

  // Throttle the bypass log to one warning per server instance per
  // bypass-context so the tail stays readable; flip back to noisy for
  // debugging by clearing the set. Context is derived from the
  // request itself (User-Agent if present, else `unknown`) — not from
  // what the predicate matched on, so the message stays accurate
  // whether the default ChatGPT detection or an integrator-supplied
  // `bypassWhen` triggered it.
  const warned = new Set<string>()

  handlers.set('tools/list', async (req, extra) => {
    const res = await original(req, extra)
    if (
      bypassWhen({
        server,
        extra: extra as ApplyHideToolsByAudienceExtra | undefined,
      })
    ) {
      const ua = readHeader(
        (extra as ApplyHideToolsByAudienceExtra | undefined)?.requestInfo?.headers,
        'user-agent',
      )
      const context = ua ? `ua=${ua}` : 'no user-agent'
      if (!warned.has(context)) {
        warned.add(context)
        console.warn(
          `[solvapay/mcp] hideToolsByAudience filter bypassed (${context}); returning full tools/list catalog.`,
        )
      }
      return res
    }
    const tools = Array.isArray(res?.tools) ? res.tools : []
    return {
      ...res,
      tools: tools.filter(t => {
        const audience = (t?._meta as { audience?: unknown } | undefined)?.audience
        return !hidden.has(typeof audience === 'string' ? audience : '')
      }),
    }
  })
}
