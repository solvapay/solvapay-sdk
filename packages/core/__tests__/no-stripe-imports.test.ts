import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guard: the card path is the vault CardFields only; no source file may
// import a processor browser SDK. The scope is split so this file does not
// match itself.
const SCOPE = '@' + 'stripe/'
const IMPORT_PATTERN = new RegExp(
  `(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*|mock\\s*\\(\\s*|import\\s+)['"]${SCOPE}`,
)

const PACKAGE_ROOT = resolve(__dirname, '..')
const SRC = join(PACKAGE_ROOT, 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path)
    return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(name) ? [path] : []
  })
}

describe('no processor SDK imports', () => {
  it('finds no source file importing the processor SDK', () => {
    const offenders = sourceFiles(SRC)
      .filter(file => IMPORT_PATTERN.test(readFileSync(file, 'utf8')))
      .map(file => relative(PACKAGE_ROOT, file))
    expect(offenders).toEqual([])
  })

  it('declares no processor SDK dependency in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >
    const declared = ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']
      .flatMap(field => Object.keys(pkg[field] ?? {}))
      .filter(name => name.startsWith(SCOPE))
    expect(declared).toEqual([])
  })

  it('matches an import of the processor SDK (pattern self-check)', () => {
    expect(IMPORT_PATTERN.test(`import { x } from '${SCOPE}js'`)).toBe(true)
    expect(IMPORT_PATTERN.test(`const m = await import("${SCOPE}js")`)).toBe(true)
    expect(IMPORT_PATTERN.test(`import '${SCOPE}js'`)).toBe(true)
    expect(IMPORT_PATTERN.test(`vi.mock('${SCOPE}js', () => ({}))`)).toBe(true)
    expect(IMPORT_PATTERN.test(`import { x } from '@solvapay/core'`)).toBe(false)
  })
})
