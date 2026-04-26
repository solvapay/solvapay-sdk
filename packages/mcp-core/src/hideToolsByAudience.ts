/**
 * `applyHideToolsByAudience(server, audiences)` — wraps the
 * `tools/list` request handler on an `@modelcontextprotocol/sdk`
 * `McpServer` so tool descriptors whose `_meta.audience` matches one
 * of the supplied values are filtered out of the response.
 *
 * The tools stay `enabled: true` on the server, so `tools/call` still
 * reaches their handlers — this helper only affects the `tools/list`
 * response shape. Use `['ui']` when deploying to a text-host MCP
 * client (Claude Desktop, MCPJam, ChatGPT connectors) that won't
 * embed the SolvaPay iframe surface, while still allowing the iframe
 * to invoke the hidden transport tools (`create_payment_intent` etc.)
 * for server-side work.
 *
 * Internal-map reach-in rationale: `Protocol.setRequestHandler`
 * contains an `assertCanSetRequestHandler` guard that fails when the
 * SDK has already registered a handler for the method during
 * registration — i.e. `tools/list` after any tool registration. The
 * guard only fires through the public wrapper; the underlying
 * `_requestHandlers` map accepts a replacement silently. Touching the
 * map directly therefore sidesteps the guard without going through
 * public API surface that could change in a minor SDK bump. The one
 * piece of SDK-internal knowledge we live with until the SDK ships a
 * first-class "replace handler" affordance.
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

export function applyHideToolsByAudience(
  server: unknown,
  audiences: readonly string[] | undefined,
): void {
  if (!audiences || audiences.length === 0) return
  const hidden = new Set(audiences)

  const inner = (server as McpServerLike).server
  if (!inner || typeof inner !== 'object' || !(inner._requestHandlers instanceof Map)) {
    return
  }
  const handlers = inner._requestHandlers
  const original = handlers.get('tools/list')
  if (!original) return

  handlers.set('tools/list', async (req, extra) => {
    const res = await original(req, extra)
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
