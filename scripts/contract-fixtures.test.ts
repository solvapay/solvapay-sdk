import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createDefaultRegistry, replayFixture } from './lib/fixture-harness.js'
import { parseFixture } from './lib/fixture-schema.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES_ROOT = path.join(REPO_ROOT, 'contract/fixtures')

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

const fixtureFiles = discoverFixtureFiles(FIXTURES_ROOT)

describe('contract fixtures', () => {
  it('discovers the Step 4 webhook axis set plus the client sample', () => {
    const relative = fixtureFiles.map(f => path.relative(FIXTURES_ROOT, f))
    expect(relative).toEqual([
      'client/create-payment-intent-success.json',
      'webhook-verification/accept-boundary-300s.json',
      'webhook-verification/accept-boundary-future-299s.json',
      'webhook-verification/accept-boundary-past-299s.json',
      'webhook-verification/accept-extra-comma-parts.json',
      'webhook-verification/accept.json',
      'webhook-verification/invalid-payload-empty-body.json',
      'webhook-verification/invalid-payload-not-json.json',
      'webhook-verification/invalid-signature-length-mismatch.json',
      'webhook-verification/invalid-signature-non-hex-v1.json',
      'webhook-verification/invalid-signature-wrong-hmac.json',
      'webhook-verification/malformed-signature-empty-v1.json',
      'webhook-verification/malformed-signature-missing-t.json',
      'webhook-verification/malformed-signature-missing-v1.json',
      'webhook-verification/malformed-signature-no-parts.json',
      'webhook-verification/malformed-signature-non-numeric-timestamp.json',
      'webhook-verification/missing-signature.json',
      'webhook-verification/timestamp-too-old-future-301s.json',
      'webhook-verification/timestamp-too-old.json',
    ])
  })

  it.each(fixtureFiles.map(file => [path.relative(FIXTURES_ROOT, file), file]))(
    'schema-validates %s',
    (_label, file) => {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
      expect(() => parseFixture(raw)).not.toThrow()
    },
  )

  it.each(fixtureFiles.map(file => [path.relative(FIXTURES_ROOT, file), file]))(
    'replays %s end to end',
    async (_label, file) => {
      const fixture = parseFixture(JSON.parse(readFileSync(file, 'utf8')))
      const registry = createDefaultRegistry()
      await replayFixture(fixture, { registry })
    },
  )
})
