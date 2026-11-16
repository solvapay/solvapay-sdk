/**
 * Suite `web-routes`: the HTTP routes the `@solvapay/react` components call on
 * the merchant's backend, as `@solvapay/server/fetch` serves them
 * (`solvapayRoutes()`, React's default paths under `/api`).
 *
 * `webRoute` sends one request and returns what the route answers (status and
 * JSON body) and every request it made to SolvaPay's API, scripted by `api` as
 * in other suites: each exchange is used once, nothing else may be called.
 *
 * `user` is who the merchant's own auth says is calling. The TypeScript runner
 * sends it as an HS256 token signed with the route's configured secret, so the
 * route verifies it; another SDK hands the same user to its identity hook.
 * `user: null` sends no credentials at all.
 */
import { SignJWT } from 'jose'
import { solvapayRoutes } from '@solvapay/server/fetch'
import type { Implementation } from './operations'

type Json = Record<string, unknown>

const CONFORMANCE_API = 'https://api.conformance.test'
const APP_ORIGIN = 'https://app.conformance.test'
const JWT_SECRET = 'conformance-web-routes-secret-0123456789'

interface ApiExchange {
  method: string
  path: string
  status?: number
  body?: unknown
}

const ENV: Record<string, string | undefined> = {
  SOLVAPAY_SECRET_KEY: 'sk_sandbox_conformance',
  SOLVAPAY_API_BASE_URL: CONFORMANCE_API,
  SOLVAPAY_JWT_SECRET: JWT_SECRET,
  SUPABASE_JWT_SECRET: undefined,
  SOLVAPAY_JWKS_URL: undefined,
  SUPABASE_URL: undefined,
  SOLVAPAY_AUTH_TRUST_GATEWAY: undefined,
  SOLVAPAY_AUTH_STRICT: undefined,
}

function parsed(text: string): unknown {
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function tokenFor(user: Json): Promise<string> {
  const claims: Json = { sub: user.id }
  if (user.email !== undefined) claims.email = user.email
  if (user.name !== undefined) claims.name = user.name
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(JWT_SECRET))
}

async function webRoute(args: Json): Promise<unknown> {
  const pending = [...((args.api ?? []) as ApiExchange[])]
  const apiCalls: Json[] = []
  const realFetch = globalThis.fetch
  const savedEnv = Object.fromEntries(Object.keys(ENV).map(k => [k, process.env[k]]))
  for (const [k, v] of Object.entries(ENV)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const body = typeof init?.body === 'string' ? parsed(init.body) : undefined
    apiCalls.push({
      method,
      path: url.pathname,
      ...(url.search ? { query: url.search.slice(1) } : {}),
      ...(body !== undefined ? { body } : {}),
    })
    const at = pending.findIndex(e => e.method === method && e.path === url.pathname)
    if (at < 0) throw new Error(`Unexpected API call: ${method} ${url.pathname}`)
    const [exchange] = pending.splice(at, 1)
    return new Response(exchange.body === undefined ? null : JSON.stringify(exchange.body), {
      status: exchange.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  const warn = console.warn
  const error = console.error
  const log = console.log
  // The helpers log API failures; a case compares the answer, not the log.
  console.warn = () => undefined
  console.error = () => undefined
  console.log = () => undefined
  try {
    const headers = new Headers((args.headers ?? {}) as Record<string, string>)
    const user = args.user as Json | null | undefined
    if (user) headers.set('authorization', `Bearer ${await tokenFor(user)}`)
    let body: string | undefined
    if (args.body !== undefined) {
      body = JSON.stringify(args.body)
      headers.set('content-type', 'application/json')
    }
    const query = args.query
      ? `?${new URLSearchParams(args.query as Record<string, string>).toString()}`
      : ''
    const response = await solvapayRoutes()(
      new Request(`${APP_ORIGIN}${args.path as string}${query}`, {
        method: (args.method as string | undefined) ?? 'GET',
        headers,
        ...(body !== undefined ? { body } : {}),
      }),
    )
    const result: Json = { status: response.status, body: parsed(await response.text()) }
    const allow = response.headers.get('allow')
    if (allow !== null) result.allow = allow
    if (pending.length > 0) {
      throw new Error(`API calls not made: ${pending.map(e => `${e.method} ${e.path}`).join(', ')}`)
    }
    result.apiCalls = apiCalls
    return result
  } finally {
    globalThis.fetch = realFetch
    console.warn = warn
    console.error = error
    console.log = log
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

export const WEB_ROUTE_OPERATIONS: Record<string, Implementation[]> = {
  webRoute: [{ name: 'fetch', run: (args: Json) => webRoute(args) }],
}
