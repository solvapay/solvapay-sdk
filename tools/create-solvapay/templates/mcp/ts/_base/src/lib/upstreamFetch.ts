/**
 * Upstream HTTP helper for generated tools.
 *
 * `upstreamFetchJson(url, init)` is what every `scaffold.mjs`-emitted
 * tool calls instead of `fetch().json()`. Differences from raw fetch:
 *
 *  - Sends `Accept: application/json` by default. Caller can override.
 *  - Reads the body as text first, then attempts `JSON.parse`. This
 *    lets us surface non-JSON error bodies (XML 404s from Swagger-
 *    style demos, HTML auth walls, plaintext rate-limit pages) with
 *    full diagnostics instead of a bare "Unexpected token '<'".
 *  - Throws `UpstreamError` on non-2xx OR JSON parse failure. The
 *    error message names the method, URL, status, content-type, and
 *    a body snippet so the LLM has enough context to recover or stop.
 *
 * Both the free-tool path (`ctx.server.registerTool`) and the paid-
 * tool path (`ctx.registerPayable`) propagate this throw — the MCP
 * SDK and SolvaPay's `formatError` respectively convert it into a
 * `{ isError: true, content[0].text: <message> }` envelope.
 *
 * `UpstreamError`'s structured fields (`status`, `contentType`,
 * `bodySnippet`, `parseError`) are kept on the instance so
 * hand-tuned tools can `catch` and branch (e.g. treat 404 as
 * "not found" silently, surface 429 as a nudge).
 */

const BODY_SNIPPET_MAX_CHARS = 500

export interface UpstreamErrorInit {
  method: string
  url: string
  status: number
  contentType: string
  bodySnippet: string
  parseError?: string
}

export class UpstreamError extends Error {
  readonly status: number
  readonly contentType: string
  readonly bodySnippet: string
  readonly parseError?: string
  readonly method: string
  readonly url: string

  constructor(init: UpstreamErrorInit) {
    super(formatUpstreamErrorMessage(init))
    this.name = 'UpstreamError'
    this.method = init.method
    this.url = init.url
    this.status = init.status
    this.contentType = init.contentType
    this.bodySnippet = init.bodySnippet
    this.parseError = init.parseError
  }
}

function formatUpstreamErrorMessage(init: UpstreamErrorInit): string {
  const contentType = init.contentType || '(no content-type)'
  const head = init.parseError
    ? `Upstream ${init.method} ${init.url} returned ${init.status} ${contentType}; JSON parse failed: ${init.parseError}`
    : `Upstream ${init.method} ${init.url} returned ${init.status} ${contentType}`
  return init.bodySnippet ? `${head}\nBody snippet: ${init.bodySnippet}` : head
}

/**
 * Fetch an upstream JSON resource. Throws `UpstreamError` when the
 * response is not 2xx or the body isn't valid JSON.
 *
 * Returns the parsed body cast to `T`. The generator does not generate
 * runtime validation against the OpenAPI response schema — that's a
 * follow-up. Treat `T` as a shape hint, not a guarantee.
 */
export async function upstreamFetchJson<T = unknown>(
  url: string | URL,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('accept')) headers.set('accept', 'application/json')
  const method = (init.method ?? 'GET').toUpperCase()
  const urlStr = url.toString()

  const res = await fetch(urlStr, { ...init, headers })
  const contentType = res.headers.get('content-type') ?? ''
  const text = await res.text()

  if (!res.ok) {
    throw new UpstreamError({
      method,
      url: urlStr,
      status: res.status,
      contentType,
      bodySnippet: text.slice(0, BODY_SNIPPET_MAX_CHARS),
    })
  }

  if (text.length === 0) {
    return undefined as T
  }

  try {
    return JSON.parse(text) as T
  } catch (err) {
    throw new UpstreamError({
      method,
      url: urlStr,
      status: res.status,
      contentType,
      bodySnippet: text.slice(0, BODY_SNIPPET_MAX_CHARS),
      parseError: err instanceof Error ? err.message : String(err),
    })
  }
}
