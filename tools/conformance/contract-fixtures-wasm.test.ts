/**
 * Replay `contract/fixtures/client/` through the WASM `FetchTransport` client.
 *
 * The default fixture harness installs `@solvapay/server-wasm` as the
 * `WasmClient` override so `globalThis.fetch` can intercept the wire.
 * This suite is the wasm-binding CI entry: it fails if that binding
 * cannot load.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadWasmBinding } from '@solvapay/server'
import { createDefaultRegistry, replayFixture } from './lib/fixture-harness.js'
import { parseFixture } from './lib/fixture-schema.js'
import { contractInputPath } from '../shared/repo-paths.js'

const FIXTURES_ROOT = contractInputPath('fixtures')
const CLIENT_ROOT = path.join(FIXTURES_ROOT, 'client')

function discoverFixtureFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...discoverFixtureFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(full)
    }
  }
  return files.sort()
}

const clientFiles = discoverFixtureFiles(CLIENT_ROOT)

describe('client fixtures on WASM FetchTransport', () => {
  it('loads the edge WASM binding', async () => {
    const binding = await loadWasmBinding()
    expect(typeof binding.ready).toBe('function')
  })

  it.each(clientFiles.map(file => [path.relative(FIXTURES_ROOT, file), file]))(
    'replays %s',
    async (_label, file) => {
      const fixture = parseFixture(JSON.parse(readFileSync(file, 'utf8')))
      const registry = createDefaultRegistry()
      await replayFixture(fixture, { registry })
    },
  )
})
