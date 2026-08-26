import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkVendoredWidget } from '../check.mjs'
import { vendorWidget } from '../vendor.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const canonicalPath = join(root, 'tools/mcp-app-widget/mcp-app.html')
const sdkCopies = [
  'sdks/python-mcp/python/solvapay_mcp/data/mcp-app.html',
  'sdks/ruby-mcp/lib/solvapay/mcp/data/mcp-app.html',
  'sdks/go/mcp/mcp-app.html',
  'sdks/rust-mcp/mcp-app.html',
  'sdks/typescript/mcp/mcp-app.html',
] as const

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

  it('vendors a byte-identical copy into every SDK', () => {
    const expected = sha256(readFileSync(canonicalPath))
    for (const rel of sdkCopies) {
      expect(sha256(readFileSync(join(root, rel))), rel).toBe(expected)
    }
  })
})

const stubHtml = `<!doctype html>
<html lang="en">
  <head><title>SolvaPay MCP App</title></head>
  <body><div id="root"></div></body>
</html>
`

function writeWidgetTree(fixtureRoot: string, canonical: string, copies: Record<string, string>): void {
  const canonicalRel = 'tools/mcp-app-widget/mcp-app.html'
  mkdirSync(dirname(join(fixtureRoot, canonicalRel)), { recursive: true })
  writeFileSync(join(fixtureRoot, canonicalRel), canonical)
  for (const [rel, html] of Object.entries(copies)) {
    mkdirSync(dirname(join(fixtureRoot, rel)), { recursive: true })
    writeFileSync(join(fixtureRoot, rel), html)
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
    copies[sdkCopies[0]] = `${stubHtml}<!-- drifted -->\n`
    writeWidgetTree(fixtureRoot, stubHtml, copies)

    const problems = checkVendoredWidget({ root: fixtureRoot })
    expect(problems.some(problem => problem.includes(sdkCopies[0]))).toBe(true)
  })

  it('throws naming the build script when dist is missing', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'mcp-app-widget-'))
    expect(() => vendorWidget({ root: fixtureRoot })).toThrow(/build/i)
  })
})
