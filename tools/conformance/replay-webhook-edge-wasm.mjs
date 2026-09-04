#!/usr/bin/env node
/**
 * Replay the webhook-verification corpus against the edge facade only.
 *
 * Usage:
 *   node scripts/replay-webhook-edge-wasm.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'

function findRepoRoot(startDir) {
  let dir = resolve(startDir)
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`Could not find repo root (pnpm-workspace.yaml) from ${startDir}`)
    }
    dir = parent
  }
}

function loadLayout(repoRoot) {
  let layoutPath = repoRoot
  for (const part of ['contract', 'manifest', 'repo-paths.yaml']) {
    layoutPath = join(layoutPath, part)
  }
  const layout = parseYaml(readFileSync(layoutPath, 'utf8'))
  if (typeof layout !== 'object' || layout === null) {
    throw new Error(`invalid repo-paths manifest at ${layoutPath}`)
  }
  return layout
}

function absRel(repoRoot, rel, ...extra) {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new Error('missing repo-paths entry')
  }
  return join(repoRoot, ...rel.split('/'), ...extra)
}

const repoRoot = findRepoRoot(process.cwd())
const layout = loadLayout(repoRoot)
const fixturesDir = absRel(repoRoot, layout.lookups?.webhookFixtures)

const { verifyWebhook } = await import(
  pathToFileURL(absRel(repoRoot, layout.tsPackages?.server, 'dist', 'edge.js')).href
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
    console.log(`OK  ${file}`)
  } catch (err) {
    console.error(`FAIL ${file}: ${err instanceof Error ? err.message : err}`)
    restoreClock()
    process.exit(1)
  } finally {
    restoreClock()
  }
}

console.log(`OK: ${passed}/${files.length} webhook fixtures via edge WASM`)
