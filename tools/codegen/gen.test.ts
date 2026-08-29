import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DTO_GEN_ARGS,
  GENERATED_PATHS,
  diffGeneratedHashes,
  formatIdempotenceResult,
  hashGeneratedTree,
  parseArgs,
} from './gen.js'
import { generatedEntry } from '../shared/repo-paths.js'

describe('gen CLI', () => {
  it('parses --check', () => {
    expect(parseArgs(['--check'])).toEqual({ check: true })
    expect(parseArgs([])).toEqual({ check: false })
  })

  it('keeps a non-empty canonical flag set and drift path list', () => {
    expect(DTO_GEN_ARGS).toContain('--snapshot')
    expect(DTO_GEN_ARGS).toContain('--manifest')
    expect(DTO_GEN_ARGS).toContain('--go-parity-out')
    expect(GENERATED_PATHS.length).toBeGreaterThan(20)
    expect(GENERATED_PATHS).toContain(generatedEntry('nativeTs').path)
    expect(GENERATED_PATHS).toContain(generatedEntry('tsGenerated').path)
  })

  it('treats regeneration as up to date when working-tree hashes are unchanged', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'gen-check-'))
    mkdirSync(path.join(root, 'out'))
    writeFileSync(path.join(root, 'out', 'client.rs'), 'mcpBootstrap\n')
    const rels = ['out/client.rs']
    const before = hashGeneratedTree(root, rels)
    const after = hashGeneratedTree(root, rels)
    expect(diffGeneratedHashes(before, after)).toEqual([])
    expect(formatIdempotenceResult([]).exitCode).toBe(0)
  })

  it('fails when regeneration rewrites a generated path', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'gen-check-'))
    mkdirSync(path.join(root, 'crate'))
    writeFileSync(path.join(root, 'crate', 'a.rs'), 'old\n')
    const before = hashGeneratedTree(root, ['crate'])
    writeFileSync(path.join(root, 'crate', 'a.rs'), 'new\n')
    const after = hashGeneratedTree(root, ['crate'])
    const changed = diffGeneratedHashes(before, after)
    expect(changed).toEqual(['crate/a.rs'])
    const result = formatIdempotenceResult(changed)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('pnpm gen')
    expect(result.stdout).toContain('crate/a.rs')
  })
})
