#!/usr/bin/env node
/**
 * Demo smoke + rust-vs-ts parity harness.
 *
 * Usage:
 *   pnpm smoke:rust                          # spawn rust+ts servers, diff
 *   pnpm smoke:rust -- --base-url URL        # hit a running server (single pass)
 *   pnpm smoke:rust -- --base-url URL --ts-url URL   # diff two running servers
 *   pnpm smoke:rust -- --parity              # explicit spawn mode (default when no URL)
 *
 * Env:
 *   SMOKE_BASE_URL / SMOKE_TS_URL
 *   SMOKE_PRODUCT_REF (falls back to SOLVAPAY_PRODUCT_REF from .env)
 *   SMOKE_AUTH_TOKEN  (optional Bearer; else mints a short-lived JWT from SUPABASE_JWT_SECRET)
 */

import { spawn } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = join(__dirname, '..')

const VOLATILE_KEYS = new Set([
  'clientSecret',
  'client_secret',
  'paymentIntentId',
  'payment_intent_id',
  'createdAt',
  'updatedAt',
  'created_at',
  'updated_at',
  'timestamp',
  'expiresAt',
  'expires_at',
  'requestId',
  'request_id',
  'sessionId',
  'session_id',
  'id',
])

const VOLATILE_SUFFIXES = ['At', 'Secret', 'Token', 'Url', 'URL']

function loadEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function parseArgs(argv) {
  const args = { parity: false, baseUrl: null, tsUrl: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') continue
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--parity') args.parity = true
    else if (a === '--base-url') args.baseUrl = argv[++i]
    else if (a === '--ts-url') args.tsUrl = argv[++i]
    else if (a.startsWith('--base-url=')) args.baseUrl = a.slice('--base-url='.length)
    else if (a.startsWith('--ts-url=')) args.tsUrl = a.slice('--ts-url='.length)
    else if (!a.startsWith('-') && !args.baseUrl) args.baseUrl = a
  }
  return args
}

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function mintSupabaseJwt(secret, sub = `smoke-${randomUUID()}`) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(
    JSON.stringify({
      sub,
      email: `${sub}@smoke.solvapay.test`,
      role: 'authenticated',
      aud: 'authenticated',
      iat: now,
      exp: now + 60 * 60,
    }),
  )
  const data = `${header}.${payload}`
  const sig = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

function isVolatileKey(key) {
  if (VOLATILE_KEYS.has(key)) return true
  return VOLATILE_SUFFIXES.some(suffix => key.endsWith(suffix) && key.length > suffix.length)
}

function stripVolatileInString(value) {
  return value
    .replace(/\d{4}-\d{2}-\d{2}T[^"'\s]*/g, '<ts>')
    .replace(/\b(pi_|seti_|cus_|pur_|prd_|pln_|cs_|tok_|pm_)[A-Za-z0-9_]+/g, '<ref>')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      '<uuid>',
    )
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (isVolatileKey(k)) continue
      if (v === null || v === undefined) continue
      out[k] = normalize(v)
    }
    return out
  }
  if (typeof value === 'string') {
    // Opaque refs / Stripe ids / ISO timestamps
    if (/^(pi_|seti_|cus_|pur_|prd_|pln_|cs_|tok_|pm_)/.test(value)) return '<ref>'
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return '<ts>'
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      return '<uuid>'
    }
    return stripVolatileInString(value)
  }
  return value
}

/**
 * Collapse known rust-vs-ts HTTP error envelope differences so the smoke can
 * flag semantic parity bugs without failing on wrapper wording / status mapping.
 */
function normalizeParityResult(result) {
  let status = result.status
  let body = normalize(result.body)

  const blob = typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? {})
  const embedded =
    blob.match(/\\?"statusCode\\?"\s*:\s*(\d+)/) ||
    blob.match(/failed\s*\((\d{3})\)/i) ||
    blob.match(/\((\d{3})\):\s*\{/)
  if (embedded && status >= 400) {
    status = Number(embedded[1])
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body
    // Prefer the inner details string when present (rust wraps; ts often surfaces it as error).
    const core = typeof record.details === 'string' ? record.details : record.error
    if (typeof core === 'string' && status >= 400) {
      let message = stripVolatileInString(core)
      // Drop leading wrapper phrases ("Failed to fetch merchant", etc.)
      message = message.replace(/^[^:]+:\s*/, '')
      // If the remainder is JSON-ish backend payload, keep just the message field.
      const msgField = message.match(/"message"\s*:\s*"([^"]+)"/)
      if (msgField) message = msgField[1]
      body = { error: message }
    }
  }

  return { status, body }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function diffPaths(a, b, path = '') {
  const diffs = []
  if (typeof a !== typeof b) {
    diffs.push(`${path || '/'}: type ${typeof a} !== ${typeof b}`)
    return diffs
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${path || '/'}: array length ${a.length} !== ${b.length}`)
    }
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) {
      diffs.push(...diffPaths(a[i], b[i], `${path}/${i}`))
    }
    return diffs
  }
  if (a !== null && b !== null && typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
      if (!(key in a)) diffs.push(`${path}/${key}: missing in rust`)
      else if (!(key in b)) diffs.push(`${path}/${key}: missing in ts`)
      else diffs.push(...diffPaths(a[key], b[key], `${path}/${key}`))
    }
    return diffs
  }
  if (a !== b) diffs.push(`${path || '/'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)
  return diffs
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, init)
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { _nonJson: text.slice(0, 200) }
  }
  return { status: res.status, body, ok: res.ok }
}

function buildCases({ productRef, authToken }) {
  const auth = authToken ? { Authorization: `Bearer ${authToken}` } : {}
  const jsonHeaders = { 'content-type': 'application/json', ...auth }

  return [
    {
      name: 'diag-impl',
      method: 'GET',
      path: '/api/diag/impl',
      // Node-only; skipped on edge/workerd when absent
      optional: true,
      expect: ({ status, body }) => {
        if (status !== 200) return `expected 200, got ${status}`
        if (!body || typeof body.impl !== 'string') return 'missing impl'
        return null
      },
    },
    {
      name: 'merchant',
      method: 'GET',
      path: '/api/merchant',
      // Backend may 404/500 depending on local stack; binding must still respond.
      expect: ({ status, body }) =>
        status > 0 && !String(body?.details ?? body?.error ?? '').includes('Cannot find module')
          ? null
          : `status ${status} body=${JSON.stringify(body).slice(0, 120)}`,
    },
    {
      name: 'get-product',
      method: 'GET',
      path: `/api/get-product?productRef=${encodeURIComponent(productRef)}`,
      expect: ({ status, body }) =>
        status > 0 && !String(body?.details ?? body?.error ?? '').includes('Cannot find module')
          ? null
          : `status ${status} body=${JSON.stringify(body).slice(0, 120)}`,
    },
    {
      name: 'list-plans',
      method: 'GET',
      path: `/api/list-plans?productRef=${encodeURIComponent(productRef)}`,
      expect: ({ status, body }) =>
        status > 0 && !String(body?.details ?? body?.error ?? '').includes('Cannot find module')
          ? null
          : `status ${status} body=${JSON.stringify(body).slice(0, 120)}`,
    },
    {
      name: 'check-purchase',
      method: 'GET',
      path: `/api/check-purchase?productRef=${encodeURIComponent(productRef)}`,
      headers: auth,
      expect: ({ status }) => (status > 0 ? null : `status ${status}`),
    },
    {
      name: 'customer-balance',
      method: 'GET',
      path: '/api/customer-balance',
      headers: auth,
      expect: ({ status, body }) =>
        status > 0 && !String(body?.details ?? body?.error ?? '').includes('Cannot find module')
          ? null
          : `status ${status} body=${JSON.stringify(body).slice(0, 120)}`,
    },
    {
      name: 'auto-recharge',
      method: 'GET',
      path: '/api/auto-recharge',
      headers: auth,
      expect: ({ status, body }) =>
        status > 0 && !String(body?.details ?? body?.error ?? '').includes('Cannot find module')
          ? null
          : `status ${status} body=${JSON.stringify(body).slice(0, 120)}`,
    },
    {
      name: 'sync-customer',
      method: 'POST',
      path: '/api/sync-customer',
      headers: jsonHeaders,
      body: {},
      expect: ({ status, body }) =>
        status > 0 && !String(body?.details ?? body?.error ?? '').includes('Cannot find module')
          ? null
          : `status ${status} body=${JSON.stringify(body).slice(0, 120)}`,
    },
    {
      name: 'create-payment-intent',
      method: 'POST',
      path: '/api/create-payment-intent',
      headers: jsonHeaders,
      body: { productRef, planRef: 'pln_smoke_missing' },
      expect: ({ status }) => (status > 0 ? null : `status ${status}`),
    },
    {
      name: 'process-payment',
      method: 'POST',
      path: '/api/process-payment',
      headers: jsonHeaders,
      body: { paymentIntentId: 'pi_smoke_missing', productRef, planRef: 'pln_smoke_missing' },
      expect: ({ status }) => (status > 0 ? null : `status ${status}`),
    },
    {
      name: 'create-topup-payment-intent',
      method: 'POST',
      path: '/api/create-topup-payment-intent',
      headers: jsonHeaders,
      body: { amount: 500, currency: 'usd' },
      expect: ({ status }) => (status > 0 ? null : `status ${status}`),
    },
    {
      name: 'process-topup-payment',
      method: 'POST',
      path: '/api/process-topup-payment',
      headers: jsonHeaders,
      body: { paymentIntentId: 'pi_smoke_missing' },
      expect: ({ status }) => (status > 0 ? null : `status ${status}`),
    },
    {
      name: 'activate-plan',
      method: 'POST',
      path: '/api/activate-plan',
      headers: jsonHeaders,
      body: { productRef, planRef: 'pln_smoke_missing' },
      expect: ({ status }) => (status > 0 ? null : `status ${status}`),
    },
    {
      name: 'track-usage',
      method: 'POST',
      path: '/api/track-usage',
      headers: jsonHeaders,
      body: { productRef, action: 'smoke', units: 1 },
      expect: ({ status }) => (status > 0 ? null : `status ${status}`),
    },
    {
      name: 'create-customer-session',
      method: 'POST',
      path: '/api/create-customer-session',
      headers: jsonHeaders,
      body: {},
      expect: ({ status }) => (status > 0 ? null : `status ${status}`),
    },
    {
      name: 'attach-business-details',
      method: 'POST',
      path: '/api/attach-business-details',
      headers: jsonHeaders,
      body: { companyName: 'Smoke Test Co' },
      expect: ({ status }) => (status > 0 ? null : `status ${status}`),
    },
    {
      name: 'cancel-renewal',
      method: 'POST',
      path: '/api/cancel-renewal',
      headers: jsonHeaders,
      body: { purchaseRef: 'pur_smoke_missing', reason: 'smoke' },
      expect: ({ status }) => (status > 0 ? null : `status ${status}`),
    },
    {
      name: 'reactivate-renewal',
      method: 'POST',
      path: '/api/reactivate-renewal',
      headers: jsonHeaders,
      body: { purchaseRef: 'pur_smoke_missing' },
      expect: ({ status }) => (status > 0 ? null : `status ${status}`),
    },
  ]
}

async function runSuite(baseUrl, ctx) {
  const cases = buildCases(ctx)
  const results = []
  const failures = []

  for (const c of cases) {
    const url = new URL(c.path, baseUrl).toString()
    const init = {
      method: c.method,
      headers: c.headers ?? {},
    }
    if (c.body !== undefined) {
      init.body = JSON.stringify(c.body)
    }

    let result
    try {
      result = await fetchJson(url, init)
    } catch (err) {
      if (c.optional) {
        results.push({
          name: c.name,
          status: 0,
          body: { skipped: true, error: String(err) },
          normalized: { skipped: true },
        })
        continue
      }
      failures.push(`${c.name}: fetch failed: ${err}`)
      continue
    }

    if (c.optional && result.status === 404) {
      results.push({
        name: c.name,
        status: 404,
        body: result.body,
        normalized: { skipped: true },
      })
      continue
    }

    const err = c.expect(result)
    if (err) {
      failures.push(`${c.name}: ${err} body=${JSON.stringify(result.body).slice(0, 200)}`)
    }

    results.push({
      name: c.name,
      status: result.status,
      body: result.body,
      normalized: normalizeParityResult({
        name: c.name,
        status: result.status,
        body: result.body,
      }),
    })
  }

  return { results, failures }
}

async function waitForServer(baseUrl, { timeoutMs = 90_000, path = '/api/merchant' } = {}) {
  const start = Date.now()
  let lastErr = null
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(new URL(path, baseUrl), { method: 'GET' })
      // Any HTTP response means the server is up
      if (res.status > 0) return
    } catch (err) {
      lastErr = err
    }
    await sleep(500)
  }
  throw new Error(`Server at ${baseUrl} did not become ready: ${lastErr}`)
}

async function startNextServer({ port, impl, envFile }) {
  const fileEnv = loadEnvFile(envFile)
  const env = {
    ...process.env,
    ...fileEnv,
    SOLVAPAY_IMPL: impl,
    PORT: String(port),
    NODE_OPTIONS: '--disable-warning=DEP0205',
  }

  // --webpack: Turbopack rebundles workspace @solvapay/server and breaks napi.
  const child = spawn(
    process.execPath,
    [
      join(APP_ROOT, 'node_modules/next/dist/bin/next'),
      'dev',
      '--webpack',
      '--port',
      String(port),
    ],
    {
      cwd: APP_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let output = ''
  child.stdout.on('data', chunk => {
    output += chunk.toString()
  })
  child.stderr.on('data', chunk => {
    output += chunk.toString()
  })

  const baseUrl = `http://127.0.0.1:${port}`
  try {
    await waitForServer(baseUrl)
  } catch (err) {
    child.kill('SIGTERM')
    throw new Error(`${err.message}\n--- server output ---\n${output.slice(-4000)}`)
  }

  return {
    baseUrl,
    impl,
    async stop() {
      if (child.killed) return
      child.kill('SIGTERM')
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        sleep(5_000).then(() => child.kill('SIGKILL')),
      ])
    },
  }
}

function printSuiteSummary(label, { results, failures }) {
  console.log(`\n[${label}] ${results.length} routes, ${failures.length} failures`)
  for (const r of results) {
    const mark = r.normalized?.skipped ? 'skip' : String(r.status)
    console.log(`  ${mark.padStart(4)}  ${r.name}`)
  }
  if (failures.length) {
    for (const f of failures) console.error(`  FAIL ${f}`)
  }
}

function compareSuites(rustSuite, tsSuite) {
  const diffs = []
  const rustByName = new Map(rustSuite.results.map(r => [r.name, r]))
  const tsByName = new Map(tsSuite.results.map(r => [r.name, r]))
  const names = new Set([...rustByName.keys(), ...tsByName.keys()])

  for (const name of names) {
    const rust = rustByName.get(name)
    const ts = tsByName.get(name)
    if (!rust || !ts) {
      diffs.push(`${name}: missing in ${rust ? 'ts' : 'rust'} suite`)
      continue
    }
    // Diag intentionally reports the active impl — exclude from parity.
    if (name === 'diag-impl') continue
    if (rust.normalized?.skipped || ts.normalized?.skipped) continue
    if (!deepEqual(rust.normalized, ts.normalized)) {
      const pathDiffs = diffPaths(rust.normalized, ts.normalized).slice(0, 20)
      diffs.push(`${name}:\n    ${pathDiffs.join('\n    ')}`)
    }
  }
  return diffs
}

async function assertDiagRust(baseUrl) {
  try {
    const diag = await fetchJson(new URL('/api/diag/impl', baseUrl))
    if (diag.status === 404) {
      console.warn('[diag] /api/diag/impl not available (edge/workerd?) — skipping napi assert')
      return
    }
    if (diag.body?.impl !== 'rust') {
      throw new Error(`expected diag.impl=rust, got ${JSON.stringify(diag.body)}`)
    }
    if (!diag.body?.napiVersion) {
      throw new Error(`expected non-empty napiVersion, got ${JSON.stringify(diag.body)}`)
    }
    console.log(`[diag] impl=rust napiVersion=${diag.body.napiVersion}`)
  } catch (err) {
    if (String(err).includes('fetch failed') || String(err).includes('ECONNREFUSED')) throw err
    // Edge-only deployments may not expose the Node diag route
    if (String(err.message ?? err).includes('napiVersion')) throw err
    console.warn(`[diag] ${err.message ?? err}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node scripts/smoke-rust.mjs [--parity] [--base-url URL] [--ts-url URL]`)
    process.exit(0)
  }

  const fileEnv = {
    ...loadEnvFile(join(APP_ROOT, '.env')),
    ...loadEnvFile(join(APP_ROOT, '.env.local')),
  }

  const productRef =
    process.env.SMOKE_PRODUCT_REF ||
    fileEnv.SOLVAPAY_PRODUCT_REF ||
    fileEnv.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF ||
    'prd_E9QZEQHN'

  let authToken = process.env.SMOKE_AUTH_TOKEN || null
  const jwtSecret = process.env.SUPABASE_JWT_SECRET || fileEnv.SUPABASE_JWT_SECRET
  if (!authToken && jwtSecret) {
    authToken = mintSupabaseJwt(jwtSecret)
  }

  const ctx = { productRef, authToken }
  const baseUrl = args.baseUrl || process.env.SMOKE_BASE_URL || null
  const tsUrl = args.tsUrl || process.env.SMOKE_TS_URL || null
  const wantParity = args.parity || (!baseUrl && !tsUrl) || Boolean(tsUrl)

  if (baseUrl && !tsUrl && !args.parity) {
    // Single-pass against a running server (local rust or workerd preview)
    console.log(`Smoke against ${baseUrl} (productRef=${productRef})`)
    await waitForServer(baseUrl)
    await assertDiagRust(baseUrl)
    const suite = await runSuite(baseUrl, ctx)
    printSuiteSummary('run', suite)
    if (suite.failures.length) {
      process.exitCode = 1
      return
    }
    console.log('\nOK — single-pass smoke passed')
    return
  }

  // Next.js 16 allows only one `next dev` per project dir, so spawn rust then
  // ts sequentially on the same port when URLs are not supplied.
  const parityPort = 13910
  let rustSuite
  let tsSuite

  if (baseUrl && tsUrl) {
    console.log(`Rust: ${baseUrl}`)
    console.log(`TS:   ${tsUrl}`)
    await assertDiagRust(baseUrl)
    rustSuite = await runSuite(baseUrl, ctx)
    tsSuite = await runSuite(tsUrl, ctx)
  } else {
    console.log('Parity mode: spawning next servers sequentially (rust, then ts)...')
    const envFile = join(APP_ROOT, '.env')

    let handle = await startNextServer({ port: parityPort, impl: 'rust', envFile })
    try {
      console.log(`Rust: ${handle.baseUrl}`)
      await assertDiagRust(handle.baseUrl)
      rustSuite = await runSuite(handle.baseUrl, ctx)
    } finally {
      await handle.stop()
      await sleep(1000)
    }

    handle = await startNextServer({ port: parityPort, impl: 'ts', envFile })
    try {
      console.log(`TS:   ${handle.baseUrl}`)
      tsSuite = await runSuite(handle.baseUrl, ctx)
    } finally {
      await handle.stop()
    }
  }

  printSuiteSummary('rust', rustSuite)
  printSuiteSummary('ts', tsSuite)

  if (rustSuite.failures.length || tsSuite.failures.length) {
    process.exitCode = 1
  }

  if (wantParity) {
    const diffs = compareSuites(rustSuite, tsSuite)
    if (diffs.length) {
      console.error(`\nParity diffs (${diffs.length}):`)
      for (const d of diffs) console.error(`  ${d}`)
      process.exitCode = 1
    } else {
      console.log('\nOK — rust-vs-ts response diff is empty')
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
