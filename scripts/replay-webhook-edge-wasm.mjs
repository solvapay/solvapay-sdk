#!/usr/bin/env node
/**
 * Replay the webhook-verification corpus against the edge facade only,
 * with SOLVAPAY_IMPL forced so Node napi's wall-clock path is not involved.
 *
 * Usage:
 *   SOLVAPAY_IMPL=rust node scripts/replay-webhook-edge-wasm.mjs
 *   SOLVAPAY_IMPL=ts node scripts/replay-webhook-edge-wasm.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const fixturesDir = join(repoRoot, 'contract/fixtures/webhook-verification')

const impl = process.env.SOLVAPAY_IMPL ?? 'rust'
process.env.SOLVAPAY_IMPL = impl

const { verifyWebhook } = await import(
  pathToFileURL(join(repoRoot, 'packages/server/dist/edge.js')).href
)

const RealDateNow = Date.now

function patchClock(iso) {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`bad clock: ${iso}`)
  Date.now = () => ms
}

function restoreClock() {
  Date.now = RealDateNow
}

const files = readdirSync(fixturesDir)
  .filter(f => f.endsWith('.json'))
  .sort()

let passed = 0
for (const file of files) {
  const fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'))
  const { body, signature, secret } = fixture.input.args
  try {
    if (fixture.input.clock) patchClock(fixture.input.clock)
    let threw
    let result
    try {
      result = await verifyWebhook({ body, signature, secret })
    } catch (err) {
      threw = err
    }

    if (fixture.expect.error) {
      if (!threw) throw new Error('expected error')
      if (threw.message !== fixture.expect.error.message) {
        throw new Error(
          `message mismatch: got ${JSON.stringify(threw.message)} want ${JSON.stringify(fixture.expect.error.message)}`,
        )
      }
    } else {
      if (threw) throw threw
      if (result?.type !== fixture.expect.result?.type) {
        throw new Error(`result type mismatch: ${JSON.stringify(result?.type)}`)
      }
    }
    passed += 1
    console.log(`OK  ${file} (${impl})`)
  } catch (err) {
    console.error(`FAIL ${file} (${impl}): ${err instanceof Error ? err.message : err}`)
    restoreClock()
    process.exit(1)
  } finally {
    restoreClock()
  }
}

console.log(`OK: ${passed}/${files.length} webhook fixtures via edge (${impl})`)
