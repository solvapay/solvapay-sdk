import { describe, expect, it } from 'vitest'
import { DTO_GEN_ARGS, GENERATED_PATHS, parseArgs } from './gen.js'

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
    expect(GENERATED_PATHS).toContain('packages/server/src/native.ts')
  })
})
