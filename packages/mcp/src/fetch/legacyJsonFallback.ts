/**
 * Legacy (2025-era) stateless fallback with `enableJsonResponse: true`.
 *
 * `createMcpHandler`'s built-in legacy path uses SSE streaming, which
 * breaks on stateless edge runtimes that close the isolate before the
 * stream completes. This mirrors the SDK's `createLegacyStatelessFallback`
 * but opts into single-JSON responses — the old `json-stateless` preset.
 */

import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  type CreateMcpHandlerOptions,
  type McpHandlerRequestOptions,
  type McpHttpHandler,
  type McpServerFactory,
} from '@modelcontextprotocol/server'

function echoableRequestId(parsedBody: unknown): string | number | null {
  if (parsedBody && typeof parsedBody === 'object' && 'id' in parsedBody) {
    const id = (parsedBody as { id?: string | number | null }).id
    return id ?? null
  }
  return null
}

export function createLegacyJsonStatelessFallback(
  factory: McpServerFactory,
  onerror?: (error: Error) => void,
): (request: Request, options?: McpHandlerRequestOptions) => Promise<Response> {
  return async (request, options) => {
    if (request.method.toUpperCase() !== 'POST') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed.' },
        }),
        { status: 405, headers: { 'content-type': 'application/json' } },
      )
    }

    try {
      const product = await factory({
        era: 'legacy',
        ...(options?.authInfo !== undefined ? { authInfo: options.authInfo } : {}),
        requestInfo: request,
      })

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })

      await product.connect(transport)

      try {
        return await transport.handleRequest(request, {
          ...(options?.authInfo !== undefined ? { authInfo: options.authInfo } : {}),
          ...(options?.parsedBody !== undefined ? { parsedBody: options.parsedBody } : {}),
        })
      } finally {
        await transport.close().catch(() => {})
        await product.close().catch(() => {})
      }
    } catch (error) {
      try {
        onerror?.(error instanceof Error ? error : new Error(String(error)))
      } catch {
        /* ignore */
      }
      const id = echoableRequestId(options?.parsedBody)
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: 'Internal error' },
        }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      )
    }
  }
}

/**
 * When `responseMode` is `'json'`, compose a strict modern handler with a
 * legacy JSON fallback so both eras return single JSON bodies on edge.
 */
export function buildMcpHandlerFace(
  factory: McpServerFactory,
  options: {
    responseMode?: CreateMcpHandlerOptions['responseMode']
    legacy?: CreateMcpHandlerOptions['legacy']
    onerror?: CreateMcpHandlerOptions['onerror']
  },
): Pick<McpHttpHandler, 'fetch'> {
  const { responseMode, legacy, onerror } = options

  if (responseMode === 'json' && legacy !== 'reject') {
    const modernHandler = createMcpHandler(factory, {
      legacy: 'reject',
      responseMode: 'json',
      ...(onerror !== undefined ? { onerror } : {}),
    })
    const legacyHandler = createLegacyJsonStatelessFallback(factory, onerror)

    return {
      fetch: async (request, fetchOptions) => {
        if (await isLegacyRequest(request)) {
          return legacyHandler(request, fetchOptions)
        }
        return modernHandler.fetch(request, fetchOptions)
      },
    }
  }

  return createMcpHandler(factory, {
    ...(responseMode !== undefined ? { responseMode } : {}),
    ...(legacy !== undefined ? { legacy } : {}),
    ...(onerror !== undefined ? { onerror } : {}),
  })
}
