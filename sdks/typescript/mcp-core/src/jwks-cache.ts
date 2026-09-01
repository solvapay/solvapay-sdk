/**
 * Host-side JWKS cache. Timers live here; core only verifies.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000

const cache = new Map<string, { json: unknown; expiresAt: number }>()

/** `{issuer}/.well-known/jwks.json` with a single trailing slash stripped. */
export function jwksUrlFromIssuer(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/.well-known/jwks.json`
}

/**
 * Return cached JWKS or fetch and store. `nowMs` is explicit so tests can pin it.
 */
export async function cachedJwks(
  jwksUrl: string,
  fetchJwks: (url: string) => Promise<unknown>,
  nowMs: number,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<unknown> {
  const hit = cache.get(jwksUrl)
  if (hit && hit.expiresAt > nowMs) {
    return hit.json
  }
  const json = await fetchJwks(jwksUrl)
  cache.set(jwksUrl, { json, expiresAt: nowMs + ttlMs })
  return json
}

/** Test seam. */
export function resetJwksCacheForTests(): void {
  cache.clear()
}
