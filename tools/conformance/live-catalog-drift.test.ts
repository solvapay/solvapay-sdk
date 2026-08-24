import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SHADOW_SCENARIOS } from '../../contract/shadow/scenarios.js'
import { lookupPath } from '../shared/repo-paths.js'

type CatalogFlags = Map<string, boolean>

function parseByIdThenFlag(src: string, idRe: RegExp, trueFlagRe: RegExp): CatalogFlags {
  const matches = [...src.matchAll(idRe)]
  const out: CatalogFlags = new Map()
  for (let i = 0; i < matches.length; i += 1) {
    const id = matches[i]?.[1]
    if (id === undefined) {
      continue
    }
    const start = matches[i]?.index ?? 0
    const end = i + 1 < matches.length ? (matches[i + 1]?.index ?? src.length) : src.length
    out.set(id, trueFlagRe.test(src.slice(start, end)))
  }
  return out
}

function rustFlags(src: string): CatalogFlags {
  return parseByIdThenFlag(src, /\bid: "([^"]+)"/g, /expect_error:\s*true/)
}

function pythonFlags(src: string): CatalogFlags {
  return parseByIdThenFlag(src, /Scenario\(\s*"([^"]+)"/g, /expect_error\s*=\s*True/)
}

function rubyFlags(src: string): CatalogFlags {
  return parseByIdThenFlag(src, /\bid: "([^"]+)"/g, /expect_error:\s*true/)
}

function goFlags(src: string): CatalogFlags {
  return parseByIdThenFlag(src, /\bID: "([^"]+)"/g, /ExpectError:\s*true/)
}

function errorIds(flags: CatalogFlags): string[] {
  return [...flags.entries()]
    .filter(([, expectError]) => expectError)
    .map(([id]) => id)
    .sort()
}

describe('live catalog expectError drift', () => {
  const expectedIds = SHADOW_SCENARIOS.map(scenario => scenario.id).sort()
  const expectedErrorIds = SHADOW_SCENARIOS.filter(scenario => scenario.expectError === true)
    .map(scenario => scenario.id)
    .sort()

  const catalogs: { name: string; flags: CatalogFlags }[] = [
    { name: 'rust', flags: rustFlags(readFileSync(lookupPath('rustLiveScenarios'), 'utf8')) },
    { name: 'python', flags: pythonFlags(readFileSync(lookupPath('pythonLiveContract'), 'utf8')) },
    { name: 'ruby', flags: rubyFlags(readFileSync(lookupPath('rubyLiveContract'), 'utf8')) },
    { name: 'go', flags: goFlags(readFileSync(lookupPath('goLiveScenarios'), 'utf8')) },
  ]

  it('should keep live catalog ids aligned with scenarios.ts', () => {
    for (const catalog of catalogs) {
      expect([...catalog.flags.keys()].sort(), catalog.name).toEqual(expectedIds)
    }
  })

  it('should keep expect-error ids aligned with scenarios.ts', () => {
    for (const catalog of catalogs) {
      expect(errorIds(catalog.flags), catalog.name).toEqual(expectedErrorIds)
    }
  })
})
