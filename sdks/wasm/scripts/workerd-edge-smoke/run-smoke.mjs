#!/usr/bin/env node
/* global console, fetch, process */
/**
 * Orchestrates the workerd edge WASM smoke: spawn `wrangler dev --local`,
 * poll `/smoke`, assert every field, then kill wrangler.
 *
 * Usage (from repo root or sdks/wasm):
 *   pnpm --filter @solvapay/server-wasm test:workerd-edge-smoke
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SMOKE_DIR = __dirname
const READY_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 400

function wranglerEntry() {
  const require = createRequire(join(SMOKE_DIR, '../../package.json'))
  return require.resolve('wrangler/bin/wrangler.js')
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close()
        reject(new Error('expected TCP listen address'))
        return
      }
      const { port } = addr
      server.close(err => {
        if (err) reject(err)
        else resolve(port)
      })
    })
    server.on('error', reject)
  })
}

function spawnWrangler(port) {
  const child = spawn(
    process.execPath,
    [wranglerEntry(), 'dev', '--local', '--port', String(port)],
    {
      cwd: SMOKE_DIR,
      env: { ...process.env, WRANGLER_LOG: 'error' },
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

  return {
    child,
    get output() {
      return output
    },
    async stop() {
      if (child.killed || child.exitCode !== null) return
      child.kill('SIGTERM')
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        sleep(5_000).then(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
        }),
      ])
    },
  }
}

async function waitForSmoke(baseUrl, getOutput) {
  const start = Date.now()
  let lastErr = null
  while (Date.now() - start < READY_TIMEOUT_MS) {
    try {
      const res = await fetch(new URL('/smoke', baseUrl), {
        signal: AbortSignal.timeout(5_000),
      })
      if (res.ok) {
        return await res.json()
      }
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(
    `workerd smoke at ${baseUrl} did not become ready: ${lastErr}\n--- wrangler output ---\n${getOutput().slice(-4000)}`,
  )
}

function assertBody(body) {
  const failures = []
  if (body?.ok !== true) failures.push(`ok: expected true, got ${JSON.stringify(body?.ok)}`)
  if (body?.webhook?.id !== 'evt_fixture_1') {
    failures.push(`webhook.id: expected evt_fixture_1, got ${JSON.stringify(body?.webhook?.id)}`)
  }
  if (body?.gate?.kind !== 'payment_required') {
    failures.push(`gate.kind: expected payment_required, got ${JSON.stringify(body?.gate?.kind)}`)
  }
  if (body?.businessSuccess !== true) {
    failures.push(
      `businessSuccess: expected true, got ${JSON.stringify(body?.businessSuccess)}`,
    )
  }
  if (body?.merchantDisplayName !== 'Smoke Co') {
    failures.push(
      `merchantDisplayName: expected Smoke Co, got ${JSON.stringify(body?.merchantDisplayName)}`,
    )
  }
  if (failures.length) {
    throw new Error(`workerd edge smoke assertions failed:\n  ${failures.join('\n  ')}`)
  }
}

async function main() {
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  console.log(`Spawning wrangler dev --local on ${baseUrl}`)
  const handle = spawnWrangler(port)
  try {
    const body = await waitForSmoke(baseUrl, () => handle.output)
    assertBody(body)
    console.log('OK — workerd edge smoke passed')
    console.log(JSON.stringify(body, null, 2))
  } finally {
    await handle.stop()
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
