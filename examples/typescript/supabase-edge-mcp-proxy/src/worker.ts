/**
 * RFC 9728-compliant Cloudflare Worker proxy in front of the Supabase
 * edge MCP function.
 *
 * Why this exists: Supabase edge functions are permanently mounted at
 * `/functions/v1/<name>/…`. RFC 9728 ("OAuth 2.0 Protected Resource
 * Metadata") places each metadata document at
 * `<host>/.well-known/<type><resource-path>` — so for a resource
 * at `https://<proj>.supabase.co/functions/v1/mcp` the discovery URL
 * is `https://<proj>.supabase.co/.well-known/oauth-protected-resource/
 * functions/v1/mcp`, which Supabase's gateway doesn't route to our
 * function (it 401s instead).
 *
 * MCP Inspector, ChatGPT's connector (`python-httpx/0.28.1`), and the
 * MCP SDK all construct metadata URLs this way per RFC 9728 § 3.1 and
 * MUST be able to fetch them.
 *
 * Fix: this Worker takes a custom subdomain
 * (`https://mcp-goldberg.solvapay.com`) and proxies every request to
 * the corresponding path under the Supabase function's mount:
 *
 *   https://mcp-goldberg.solvapay.com/                              → /functions/v1/mcp/
 *   https://mcp-goldberg.solvapay.com/.well-known/oauth-protected-resource
 *                                                                    → /functions/v1/mcp/.well-known/oauth-protected-resource
 *   https://mcp-goldberg.solvapay.com/oauth/register                 → /functions/v1/mcp/oauth/register
 *
 * Because the function's `MCP_PUBLIC_BASE_URL` is set to the Worker's
 * subdomain (no path component), the metadata the function emits
 * already uses the right discovery URLs.
 *
 * The Worker is intentionally dumb — no auth, no caching, no
 * rewriting of response bodies. Just forward request → forward
 * response. Keeps CORS + WWW-Authenticate + session-id headers
 * intact.
 */

interface Env {
  /** Supabase project ref — e.g., `ohzivhxmsdnjahtaicus`. */
  SUPABASE_PROJECT_REF: string
  /** Function name — e.g., `mcp`. */
  SUPABASE_FUNCTION_NAME: string
}

/**
 * Rewrite the incoming request URL so the path resolves against the
 * Supabase edge function. Query string and fragment are preserved.
 */
function rewriteUrl(incoming: URL, env: Env): URL {
  const target = new URL(incoming.toString())
  target.hostname = `${env.SUPABASE_PROJECT_REF}.supabase.co`
  target.protocol = 'https:'
  target.port = ''
  target.pathname = `/functions/v1/${env.SUPABASE_FUNCTION_NAME}${incoming.pathname === '/' ? '' : incoming.pathname}`
  return target
}

function forwardRequest(req: Request, target: URL): Request {
  const headers = new Headers(req.headers)
  // Replace the `Host` header so Supabase's gateway sees its own
  // hostname. Cloudflare will also set this automatically on the
  // upstream fetch, but setting it explicitly avoids surprises.
  headers.set('Host', target.host)
  // Preserve the original browser origin so our Supabase function's
  // CORS mirror sees it.
  return new Request(target.toString(), {
    method: req.method,
    headers,
    body:
      req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    redirect: 'manual',
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const incoming = new URL(req.url)
    const target = rewriteUrl(incoming, env)
    const upstreamReq = forwardRequest(req, target)

    const upstreamRes = await fetch(upstreamReq)

    // Clone headers so we can safely surface the response; Cloudflare
    // strips `transfer-encoding` automatically on re-entry.
    const headers = new Headers(upstreamRes.headers)

    // Leave `Access-Control-*` headers as the function set them. The
    // function already mirrors `Origin` back per-request, so nothing
    // else is needed here.
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers,
    })
  },
}
