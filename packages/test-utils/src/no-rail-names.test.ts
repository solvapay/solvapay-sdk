import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// G11 (VGS plan, section 9): the SDK's public surface names no payment rail and
// carries no rail test credential. Code is scanned with comments stripped; the
// generated API types are scanned whole, since their comments are the API docs.
// The rail name is split so this file does not match itself.
const RAIL = new RegExp('str' + 'ipe', 'i')
const RAIL_TEST_CARD = new RegExp('42' + '42 ?42' + '42 ?42' + '42 ?42' + '42')

const SDK_ROOT = resolve(__dirname, '../../..')
const PACKAGES = join(SDK_ROOT, 'packages')
const GENERATED = join(PACKAGES, 'server/src/types/generated.ts')
const TEST_FILE = /(\.test|\.spec)\.(ts|tsx)$|\/__tests__\/|\/test-helpers\//

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return ['node_modules', 'dist', 'coverage'].includes(name) ? [] : sourceFiles(path)
    }
    return /\.(?:ts|tsx)$/.test(name) ? [path] : []
  })
}

function docFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : docFiles(path)
    return /\.mdx?$/.test(name) ? [path] : []
  })
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const sdkSources = readdirSync(PACKAGES)
  .map(pkg => join(PACKAGES, pkg, 'src'))
  .filter(src => {
    try {
      return statSync(src).isDirectory()
    } catch {
      return false
    }
  })
  .flatMap(src => sourceFiles(src))
  .filter(file => !TEST_FILE.test(relative(SDK_ROOT, file)))

describe('no rail names on the public surface', () => {
  it('scans every package, including the generated API types', () => {
    const relatives = sdkSources.map(file => relative(SDK_ROOT, file))
    expect(relatives).toEqual(
      expect.arrayContaining([
        'packages/core/src/tax-jurisdictions.ts',
        'packages/react/src/helpers/charge-minimums.ts',
        'packages/server/src/types/generated.ts',
      ]),
    )
    expect(relatives.filter(f => TEST_FILE.test(f))).toEqual([])
  })

  it('the detectors read code, not comments', () => {
    expect(RAIL.test('isStr' + 'ipeTaxBuyerCountry')).toBe(true)
    expect(RAIL.test(stripComments('// Str' + 'ipe Tax docs\nconst a = 1'))).toBe(false)
    expect(RAIL_TEST_CARD.test('42' + '42 42' + '42 42' + '42 42' + '42')).toBe(true)
    expect(RAIL_TEST_CARD.test('5555555555554444')).toBe(false)
  })

  it('names no rail in SDK code', () => {
    const offenders = sdkSources
      .filter(file => file !== GENERATED && RAIL.test(stripComments(readFileSync(file, 'utf8'))))
      .map(file => relative(SDK_ROOT, file))
    expect(offenders).toEqual([])
  })

  it('names no rail anywhere in the generated API types, descriptions included', () => {
    const lines = readFileSync(GENERATED, 'utf8')
      .split('\n')
      .map((line, i) => `${i + 1}: ${line.trim()}`)
      .filter(line => RAIL.test(line))
    expect(lines).toEqual([])
  })

  it('names no rail in the SDK docs and package READMEs', () => {
    const docs = [
      ...docFiles(join(SDK_ROOT, 'docs')),
      join(SDK_ROOT, 'README.md'),
      ...readdirSync(PACKAGES).map(pkg => join(PACKAGES, pkg, 'README.md')),
    ].filter(file => {
      try {
        return statSync(file).isFile()
      } catch {
        return false
      }
    })
    expect(docs.map(file => relative(SDK_ROOT, file))).toEqual(
      expect.arrayContaining(['docs/guides/business-checkout.mdx', 'docs/guides/webhooks.mdx']),
    )
    const lines = docs.flatMap(file =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (RAIL.test(line) ? [`${relative(SDK_ROOT, file)}:${i + 1}`] : [])),
    )
    expect(lines).toEqual([])
  })

  it('the generated API types carry no rail identifier, in a field name or an example', () => {
    // `spm_` is SolvaPay's and does not match; `api_call` does not either.
    const railIdentifier = /\b(?:pm|pi|acct|seti)_/
    const lines = readFileSync(GENERATED, 'utf8')
      .split('\n')
      .map((line, i) => `${i + 1}: ${line.trim()}`)
      .filter(line => railIdentifier.test(line))
    expect(lines).toEqual([])
  })

  it('the public auto-recharge config names its card by SolvaPay id only', () => {
    const generated = readFileSync(GENERATED, 'utf8')
    const configType = generated.slice(
      generated.indexOf('AutoRechargeConfigDto: {'),
      generated.indexOf('AutoRechargeDisplayDto: {'),
    )
    expect(configType).toContain('paymentMethod?:')
    for (const field of ['paymentMethodId', 'inFlightPaymentIntentId', 'lockAcquiredAt']) {
      expect(configType).not.toMatch(new RegExp(`^\\s*${field}\\??:`, 'm'))
    }
  })

  it('carries no rail test card number', () => {
    const offenders = sdkSources
      .filter(file => RAIL_TEST_CARD.test(readFileSync(file, 'utf8')))
      .map(file => relative(SDK_ROOT, file))
    expect(offenders).toEqual([])
  })
})
