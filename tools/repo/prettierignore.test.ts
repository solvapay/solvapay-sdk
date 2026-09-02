import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lookupPath } from '../shared/repo-paths.js'

/** Paths that match Prettier's glob but must never be rewritten. */
const REQUIRED_IGNORE_PREFIXES = [
  'target/',
  '**/target/',
  '.mypy_cache/',
  '**/.mypy_cache/',
  '.pytest_cache/',
  '**/.pytest_cache/',
  '.ruff_cache/',
  '**/.ruff_cache/',
  'internal/fuzz/',
  'sdks/ruby/tmp/',
  '**/.ci-venv/',
  '.ci-venv/',
  '**/*.generated.d.ts',
  '**/*.generated.ts',
  'sdks/typescript/server/src/types/generated.ts',
  'sdks/wasm/pkg/',
  'contract/mcp-fixtures/',
  'contract/manifest/boundary-types.snapshot.json',
  'docs/api.json',
  'tools/codegen/dto-gen/assets/',
] as const

describe('.prettierignore', () => {
  it('should ignore Cargo artifacts, language caches, fuzz corpus, and generated trees', () => {
    const body = readFileSync(lookupPath('prettierIgnore'), 'utf8')
    const lines = new Set(
      body
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#')),
    )
    for (const prefix of REQUIRED_IGNORE_PREFIXES) {
      expect(lines.has(prefix), prefix).toBe(true)
    }
  })
})
