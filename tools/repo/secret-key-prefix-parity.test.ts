/**
 * Prefix-table parity for secret keys.
 *
 * `@solvapay/init` owns the classifier. `example-deploy` cannot import it:
 * init resolves only through dist/, and example preflight scripts run with
 * no build step. The scaffolded template deploy script is a third copy and
 * stays outside this gate — it runs under bare node in a generated project.
 *
 * Pins the prefix table only. The placeholder predicates differ on purpose.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOOLS_DIR, toolPackageDir } from '../shared/paths.js'

const INIT_ENV = join(toolPackageDir('init'), 'src', 'env.ts')
const PREFLIGHT = join(TOOLS_DIR, 'example-deploy', 'src', 'preflight.mjs')

const EXPECTED_PREFIXES = {
  live: 'sk_live_',
  sandbox: 'sk_sandbox_',
  test: 'sk_test_',
} as const

function readPrefixTable(source: string, label: string): Record<string, string> {
  const match = source.match(/SECRET_KEY_PREFIXES = \{([^}]+)\}/)
  const body = match?.[1]
  if (body === undefined) {
    throw new Error(`${label}: SECRET_KEY_PREFIXES not found`)
  }
  const table: Record<string, string> = {}
  for (const entry of body.split(',')) {
    const pair = entry.match(/(\w+):\s*'([^']+)'/)
    if (pair?.[1] === undefined || pair[2] === undefined) continue
    table[pair[1]] = pair[2]
  }
  return table
}

describe('secret-key prefix parity', () => {
  it('keeps the example-deploy prefix table equal to the init classifier', () => {
    const initTable = readPrefixTable(readFileSync(INIT_ENV, 'utf8'), 'init')
    const preflightTable = readPrefixTable(readFileSync(PREFLIGHT, 'utf8'), 'preflight')
    expect(initTable).toEqual(EXPECTED_PREFIXES)
    expect(preflightTable).toEqual(initTable)
  })
})
