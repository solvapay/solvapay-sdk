import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT, joinRel } from '../../shared/paths.js'
import { lookupPath, mcpAppWidgetLayout } from '../../shared/repo-paths.js'
import { checkVendoredWidget } from '../check.js'
import { vendorWidget } from '../vendor.js'

const layout = mcpAppWidgetLayout()
const canonicalPath = lookupPath('mcpAppWidgetCanonical')
const sdkCopies = layout.copiesRel

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('canonical MCP App widget artifact', () => {
  it('bundles a script into the canonical artifact', () => {
    const html = readFileSync(canonicalPath, 'utf8')
    expect(html).toContain('<script')
  })

  it('bundles the SolvaPay MCP React app', () => {
    const html = readFileSync(canonicalPath, 'utf8')
    expect(html).toContain('solvapay://bootstrap.json')
  })

  it('includes portable fallback implementations, not only the dispatch throw', () => {
    const html = readFileSync(canonicalPath, 'utf8')
    expect(html).toContain('EIN (Employer Identification Number)')
  })

  it('registers a portable fallback for every dispatch method the bundle references', () => {
    const html = readFileSync(canonicalPath, 'utf8')
    const dispatchSrc = readFileSync(
      joinRel(REPO_ROOT, 'sdks/typescript/core/src/native-dispatch.ts'),
      'utf8',
    )
    const portableSrc = readFileSync(
      joinRel(REPO_ROOT, 'sdks/typescript/core/src/portable-fallbacks.ts'),
      'utf8',
    )
    const union = dispatchSrc.slice(
      dispatchSrc.indexOf('export type NativeCoreSyncMethod'),
      dispatchSrc.indexOf('type NativeCoreApi'),
    )
    const methods = [...union.matchAll(/\| '([A-Za-z0-9_]+)'/g)].map(match => match[1])
    const fallbackBlock = portableSrc.slice(
      portableSrc.indexOf('installCoreSyncFallbacks({'),
      portableSrc.lastIndexOf('})'),
    )
    const fallbacks = new Set(
      [...fallbackBlock.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map(match => match[1]),
    )
    const referenced = methods.filter(method => {
      return (
        html.includes(`"${method}"`) ||
        html.includes(`'${method}'`) ||
        html.includes('`' + method + '`')
      )
    })
    expect(referenced.length).toBeGreaterThan(0)
    expect(referenced.filter(method => !fallbacks.has(method))).toEqual([])
  })

  it('vendors a byte-identical copy into every SDK', () => {
    const expected = sha256(readFileSync(canonicalPath))
    for (const rel of sdkCopies) {
      expect(sha256(readFileSync(joinRel(REPO_ROOT, rel))), rel).toBe(expected)
    }
  })
})

const stubHtml = `<!doctype html>
<html lang="en">
  <head><title>SolvaPay MCP App</title></head>
  <body><div id="root"></div></body>
</html>
`

function writeWidgetTree(
  fixtureRoot: string,
  canonical: string,
  copies: Record<string, string>,
): void {
  mkdirSync(dirname(joinRel(fixtureRoot, layout.canonicalRel)), { recursive: true })
  writeFileSync(joinRel(fixtureRoot, layout.canonicalRel), canonical)
  for (const [rel, html] of Object.entries(copies)) {
    mkdirSync(dirname(joinRel(fixtureRoot, rel)), { recursive: true })
    writeFileSync(joinRel(fixtureRoot, rel), html)
  }
}

describe('vendored widget guards', () => {
  it('reports a canonical artifact with no bundled script', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'mcp-app-widget-'))
    const copies = Object.fromEntries(sdkCopies.map(rel => [rel, stubHtml]))
    writeWidgetTree(fixtureRoot, stubHtml, copies)

    const problems = checkVendoredWidget({ root: fixtureRoot })
    expect(problems.length).toBeGreaterThan(0)
  })

  it('reports a copy that drifted from the canonical artifact', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'mcp-app-widget-'))
    const copies = Object.fromEntries(sdkCopies.map(rel => [rel, stubHtml]))
    const drifted = sdkCopies[0]
    copies[drifted] = `${stubHtml}<!-- drifted -->\n`
    writeWidgetTree(fixtureRoot, stubHtml, copies)

    const problems = checkVendoredWidget({ root: fixtureRoot })
    expect(problems.some(problem => problem.includes(drifted))).toBe(true)
  })

  it('throws naming the build script when dist is missing', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'mcp-app-widget-'))
    expect(() => vendorWidget({ root: fixtureRoot })).toThrow(/build/i)
  })
})
