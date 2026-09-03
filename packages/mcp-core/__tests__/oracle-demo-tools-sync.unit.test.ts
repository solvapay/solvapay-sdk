/**
 * The three example `demo-tools.ts` copies share a byte-identical
 * Oracle helper region (`ORACLE_HISTORY_DAYS` → end of `deriveVerdict`).
 * Extraction is blocked by the Supabase Edge Deno constraint; this
 * hash assertion is what stops the next one-copy edit from shipping.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples')

const COPIES = [
  join(EXAMPLES_DIR, 'mcp-checkout-app', 'src', 'demo-tools.ts'),
  join(EXAMPLES_DIR, 'cloudflare-workers-mcp', 'src', 'demo-tools.ts'),
  join(EXAMPLES_DIR, 'supabase-edge-mcp', 'supabase', 'functions', 'mcp', 'demo-tools.ts'),
] as const

function oracleHelperRegion(source: string, file: string): string {
  const start = source.indexOf('const ORACLE_HISTORY_DAYS')
  if (start < 0) {
    throw new Error(`${file} has no ORACLE_HISTORY_DAYS marker`)
  }
  const fn = source.indexOf('function deriveVerdict', start)
  if (fn < 0) {
    throw new Error(`${file} has no deriveVerdict after ORACLE_HISTORY_DAYS`)
  }
  let depth = 0
  let i = source.indexOf('{', fn)
  if (i < 0) {
    throw new Error(`${file} deriveVerdict has no body`)
  }
  for (; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`${file} deriveVerdict is unclosed`)
}

describe('Oracle demo-tools helper region', () => {
  it('is byte-identical across the three example copies', () => {
    const hashes = COPIES.map(file => {
      const region = oracleHelperRegion(readFileSync(file, 'utf8'), file)
      return {
        file,
        hash: createHash('sha256').update(region).digest('hex'),
        lines: region.split('\n').length,
      }
    })
    expect(hashes[0].lines).toBeGreaterThan(100)
    expect(hashes[1].hash).toBe(hashes[0].hash)
    expect(hashes[2].hash).toBe(hashes[0].hash)
  })
})
