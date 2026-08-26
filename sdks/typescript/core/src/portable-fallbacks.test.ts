import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { callNativeSync } from '@solvapay/server'
import { installNativeCoreApi, resetNativeCoreApiForTests } from './native-dispatch'
import './portable-fallbacks'
import {
  createDefaultRegistry,
  replayFixture,
} from '../../../../tools/conformance/lib/fixture-harness.js'
import { parseFixture } from '../../../../tools/conformance/lib/fixture-schema.js'
import { contractInputPath } from '../../../../tools/shared/repo-paths.js'

const FIXTURES_ROOT = contractInputPath('fixtures')
const PORTABLE_DOMAINS = [
  'business-details',
  'credit-display',
  'seller-identity',
  'plan-pricing',
] as const

function discoverFixtureFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...discoverFixtureFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full)
  }
  return files.sort()
}

const portableFiles = PORTABLE_DOMAINS.flatMap(domain =>
  discoverFixtureFiles(path.join(FIXTURES_ROOT, domain)),
)

describe('portable fallback fixtures', () => {
  afterEach(() => {
    installNativeCoreApi({ callNativeSync })
  })

  it.each(portableFiles.map(file => [path.relative(FIXTURES_ROOT, file), file]))(
    'replays %s on the portable fallback path',
    async (_label, file) => {
      const fixture = parseFixture(JSON.parse(readFileSync(file, 'utf8')))
      const registry = createDefaultRegistry()
      resetNativeCoreApiForTests()
      await replayFixture(fixture, { registry })
    },
  )
})
