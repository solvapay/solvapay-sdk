/**
 * Upstream OAuth 2.0 client-credentials helper.
 *
 * `getAccessToken(env)` returns a short-lived bearer token for the
 * upstream API. The token is exchanged once per Workers isolate and
 * cached in memory until shortly before expiry, so tools that share
 * an isolate share a token.
 *
 * Generated tools (when `selections.json` declares
 * `upstreamAuth.kind: "oauth2-client-credentials"`) call
 * `await getAccessToken(env)` immediately before issuing the upstream
 * request and stamp the result as `Authorization: Bearer <token>`.
 *
 * v1 invariants (intentional):
 *   - Cache lives at module scope. Workers isolates pin during a
 *     request and can survive across requests, so the next call into
 *     the same isolate reuses the token until it's about to expire.
 *   - No KV / Durable Object backing. If a Worker fans out across many
 *     isolates, each one performs its own exchange. Acceptable in v1;
 *     follow-up if token-issuance volume becomes a concern.
 *   - No automatic 401 retry. If the upstream rotates credentials or
 *     the server clock is skewed and the cached token is rejected
 *     anyway, the generated tool's `UpstreamError` surfaces the 401 to
 *     the model. A small follow-up clears `cached` on a 401 before
 *     re-throw.
 *   - `UPSTREAM_OAUTH_TOKEN_URL` is uploaded to the Worker as a secret
 *     (see deploy.mjs), so we treat it as required at runtime even
 *     though it isn't strictly sensitive — failing fast when missing
 *     avoids confusing "Bearer undefined" upstream rejections.
 */

import { UpstreamError } from './upstreamFetch'

type Env = {
  UPSTREAM_OAUTH_TOKEN_URL?: string
  UPSTREAM_OAUTH_CLIENT_ID?: string
  UPSTREAM_OAUTH_CLIENT_SECRET?: string
  UPSTREAM_OAUTH_SCOPE?: string
  UPSTREAM_OAUTH_AUDIENCE?: string
}

interface CachedToken {
  value: string
  expiresAt: number
}

// 30s safety margin so we never hand out a token that's about to
// expire on the upstream's clock. Most OAuth servers accept slightly
// stale tokens, but several do not (Auth0, Okta) — playing safe.
const REFRESH_SKEW_MS = 30_000

// Fallback lifetime when the token endpoint omits `expires_in`. RFC
// 6749 §5.1 calls `expires_in` "RECOMMENDED" so it can be absent in
// practice; an hour matches the default lifetime used by Auth0,
// Okta, and most identity platforms.
const DEFAULT_EXPIRES_IN_SECONDS = 3600

let cached: CachedToken | undefined

export async function getAccessToken(env: Env): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return cached.value
  }
  cached = await fetchToken(env)
  return cached.value
}

/**
 * Hook for tests + a future 401-retry path. Clears the in-isolate
 * cache so the next `getAccessToken` call re-exchanges. Generated
 * tools do not call this in v1.
 */
export function clearAccessTokenCache(): void {
  cached = undefined
}

interface TokenResponse {
  access_token?: unknown
  expires_in?: unknown
}

async function fetchToken(env: Env): Promise<CachedToken> {
  const tokenUrl = requireEnv(env, 'UPSTREAM_OAUTH_TOKEN_URL')
  const clientId = requireEnv(env, 'UPSTREAM_OAUTH_CLIENT_ID')
  const clientSecret = requireEnv(env, 'UPSTREAM_OAUTH_CLIENT_SECRET')

  // RFC 6749 §2.3.1 — client credentials encoded as HTTP Basic.
  // `btoa` is part of the WebCrypto/Web standard available in Workers
  // and modern Node; avoid `Buffer.from(...).toString('base64')` so the
  // helper stays runtime-agnostic.
  const credentials = btoa(`${clientId}:${clientSecret}`)

  const body = new URLSearchParams({ grant_type: 'client_credentials' })
  if (env.UPSTREAM_OAUTH_SCOPE) body.set('scope', env.UPSTREAM_OAUTH_SCOPE)
  if (env.UPSTREAM_OAUTH_AUDIENCE) body.set('audience', env.UPSTREAM_OAUTH_AUDIENCE)

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  })

  const contentType = res.headers.get('content-type') ?? ''
  const text = await res.text()

  if (!res.ok) {
    throw new UpstreamError({
      method: 'POST',
      url: tokenUrl,
      status: res.status,
      contentType,
      bodySnippet: text.slice(0, 500),
    })
  }

  let parsed: TokenResponse
  try {
    parsed = JSON.parse(text) as TokenResponse
  } catch (err) {
    throw new UpstreamError({
      method: 'POST',
      url: tokenUrl,
      status: res.status,
      contentType,
      bodySnippet: text.slice(0, 500),
      parseError: err instanceof Error ? err.message : String(err),
    })
  }

  if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
    throw new UpstreamError({
      method: 'POST',
      url: tokenUrl,
      status: res.status,
      contentType,
      bodySnippet: text.slice(0, 500),
      parseError: 'token response missing `access_token`',
    })
  }

  const expiresInSeconds =
    typeof parsed.expires_in === 'number' && Number.isFinite(parsed.expires_in)
      ? parsed.expires_in
      : DEFAULT_EXPIRES_IN_SECONDS

  return {
    value: parsed.access_token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  }
}

function requireEnv(env: Env, name: keyof Env): string {
  const value = env[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `${String(name)} is not set — populate it in .env and re-run \`npm run deploy\` ` +
        `(or run \`npx wrangler secret put ${String(name)}\` on the deployed worker).`,
    )
  }
  return value
}
