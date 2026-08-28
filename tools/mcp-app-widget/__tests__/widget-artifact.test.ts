import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { joinRel, REPO_ROOT } from '../../shared/paths.js'
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

  it('does not embed WebAssembly', () => {
    const html = readFileSync(canonicalPath, 'utf8')
    expect(html.includes('WebAssembly') || html.includes('application/wasm')).toBe(false)
  })

  it('does not fetch data: URLs (host connect-src rejects them)', () => {
    const html = readFileSync(canonicalPath, 'utf8')
    expect(html).not.toContain('href="data:,"')
    expect(html).not.toContain('href="data:')
  })

  it('vendors a byte-identical copy into every SDK', () => {
    const expected = sha256(readFileSync(canonicalPath))
    for (const rel of sdkCopies) {
      expect(sha256(readFileSync(joinRel(REPO_ROOT, rel))), rel).toBe(expected)
    }
  })

  it('matches dist when the widget build output is present', () => {
    expect(checkVendoredWidget({ root: REPO_ROOT })).toEqual([])
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
