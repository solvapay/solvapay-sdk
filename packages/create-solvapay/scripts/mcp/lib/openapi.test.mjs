import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSpec, swaggerParserInstallHint } from './openapi.mjs'

const tempDirs = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function writeSpec(document) {
  const dir = mkdtempSync(join(tmpdir(), 'openapi-spec-'))
  tempDirs.push(dir)
  const specPath = join(dir, 'openapi.json')
  writeFileSync(specPath, JSON.stringify(document))
  return specPath
}

const minimalSpec = version => ({
  openapi: version,
  info: { title: 'trial', version: '1.0.0' },
  paths: {},
})

describe('loadSpec OpenAPI version', () => {
  it('normalises an OpenAPI 3.1.x patch version to 3.1.1 before parsing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const specPath = writeSpec(minimalSpec('3.1.2'))

    const { spec } = await loadSpec(specPath)

    expect(spec.openapi).toBe('3.1.1')
    expect(log).toHaveBeenCalledWith('OpenAPI 3.1.x patch version normalised to 3.1.1 for parsing.')
  })

  it('leaves OpenAPI 3.1.1 unchanged and does not print the normalisation line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const specPath = writeSpec(minimalSpec('3.1.1'))

    const { spec } = await loadSpec(specPath)

    expect(spec.openapi).toBe('3.1.1')
    expect(log).not.toHaveBeenCalledWith(
      'OpenAPI 3.1.x patch version normalised to 3.1.1 for parsing.',
    )
  })

  it('wraps an unsupported OpenAPI version in a readable error', async () => {
    const specPath = writeSpec(minimalSpec('3.2.0'))

    await expect(loadSpec(specPath)).rejects.toThrow(/Could not parse OpenAPI spec/)
    await expect(loadSpec(specPath)).rejects.toThrow(/Unsupported OpenAPI version: 3.2.0/)
  })
})

describe('swaggerParserInstallHint', () => {
  it('names the scripts/mcp directory that owns the swagger-parser dependency', () => {
    expect(swaggerParserInstallHint()).toMatch(/Run `npm install` inside .+\/scripts\/mcp\b/)
  })
})
