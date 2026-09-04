#!/usr/bin/env node
/* global Buffer, URL, console, fetch, process */
/**
 * Demo Rust smoke harness.
 *
 * Usage:
 *   pnpm smoke:rust                          # spawn next dev, assert Rust + route smoke
 *   pnpm smoke:rust -- --base-url URL        # hit a running server (single pass)
 *
 * Env:
 *   SMOKE_BASE_URL
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
const SMOKE_PORT = 13910

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
  const args = { baseUrl: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') continue
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--base-url') args.baseUrl = argv[++i]
    else if (a.startsWith('--base-url=')) args.baseUrl = a.slice('--base-url='.length)
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
      optional: true,
      expect: ({ status, body }) => {
        if (status !== 200) return `expected 200, got ${status}`
        if (body?.impl !== 'rust') return `expected impl=rust, got ${JSON.stringify(body?.impl)}`
        return null
      },
    },
    {
      name: 'merchant',
      method: 'GET',
      path: '/api/merchant',
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
        results.push({ name: c.name, status: 0, skipped: true })
        continue
      }
      failures.push(`${c.name}: fetch failed: ${err}`)
      continue
    }

    if (c.optional && result.status === 404) {
      results.push({ name: c.name, status: 404, skipped: true })
      continue
    }

    const err = c.expect(result)
    if (err) {
      failures.push(`${c.name}: ${err} body=${JSON.stringify(result.body).slice(0, 200)}`)
    }

    results.push({ name: c.name, status: result.status })
  }

  return { results, failures }
}

async function waitForServer(baseUrl, { timeoutMs = 90_000, path = '/api/merchant' } = {}) {
  const start = Date.now()
  let lastErr = null
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(new URL(path, baseUrl), { method: 'GET' })
      if (res.status > 0) return
    } catch (err) {
      lastErr = err
    }
    await sleep(500)
  }
  throw new Error(`Server at ${baseUrl} did not become ready: ${lastErr}`)
}

async function startNextServer({ port, envFile }) {
  const fileEnv = loadEnvFile(envFile)
  const env = {
    ...process.env,
    ...fileEnv,
    PORT: String(port),
    NODE_OPTIONS: '--disable-warning=DEP0205',
  }

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
    const mark = r.skipped ? 'skip' : String(r.status)
    console.log(`  ${mark.padStart(4)}  ${r.name}`)
  }
  if (failures.length) {
    for (const f of failures) console.error(`  FAIL ${f}`)
  }
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
    if (String(err.message ?? err).includes('napiVersion')) throw err
    console.warn(`[diag] ${err.message ?? err}`)
  }
}

async function runSmoke(baseUrl, ctx) {
  await waitForServer(baseUrl)
  await assertDiagRust(baseUrl)
  const suite = await runSuite(baseUrl, ctx)
  printSuiteSummary('run', suite)
  if (suite.failures.length) {
    process.exitCode = 1
    return false
  }
  console.log('\nOK — Rust smoke passed')
  return true
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/smoke-rust.mjs [--base-url URL]')
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

  if (baseUrl) {
    console.log(`Smoke against ${baseUrl} (productRef=${productRef})`)
    await runSmoke(baseUrl, ctx)
    return
  }

  console.log('Spawning next dev for Rust smoke...')
  const envFile = join(APP_ROOT, '.env')
  const handle = await startNextServer({ port: SMOKE_PORT, envFile })
  try {
    console.log(`Server: ${handle.baseUrl}`)
    await runSmoke(handle.baseUrl, ctx)
  } finally {
    await handle.stop()
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
