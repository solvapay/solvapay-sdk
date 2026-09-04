/**
 * Parity gate for the four TypeScript example / scaffold widget copies.
 *
 * These files are intentionally duplicated so each project stays liftable
 * into a real integrator repo. Do not extract a shared workspace package.
 *
 * vite.config.ts is excluded on purpose: the examples carry a monorepo-only
 * @solvapay package alias block so they build SDK packages from workspace
 * source. The scaffold template correctly has none, and the checkout-app
 * aliases differ in comments and order. Those differences are legitimate.
 *
 * The checkout-app demo-tools file is excluded: it is the full toolbox
 * the Supabase copy was trimmed from.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadRepoPathsManifest, lookupPath } from '../shared/repo-paths.js'
import { lookupRel } from '../shared/paths.js'

const WIDGET_HTML_KEYS = [
  'exampleWidgetHtmlCloudflare',
  'exampleWidgetHtmlSupabase',
  'exampleWidgetHtmlCheckout',
  'exampleWidgetHtmlScaffold',
] as const

const WIDGET_TSX_KEYS = [
  'exampleWidgetTsxCloudflare',
  'exampleWidgetTsxSupabase',
  'exampleWidgetTsxCheckout',
  'exampleWidgetTsxScaffold',
] as const

const DEMO_TOOLS_KEYS = ['exampleDemoToolsCloudflare', 'exampleDemoToolsSupabase'] as const

function policyAnchor(): string {
  const docsDir = loadRepoPathsManifest().dirs.docs
  return `${docsDir}/contributing/mcp-apps-sdk-rules.md`
}

function intendedDuplicationMessage(kind: string, rels: string[]): string {
  return [
    `${kind} copies are intentionally duplicated so each example stays a standalone, liftable project.`,
    'Do not extract a shared workspace package.',
    'Fix: apply the same edit to every listed copy, or update this gate if a copy is meant to diverge.',
    `Policy: ${policyAnchor()} ("Demo is not the SDK").`,
    `Copies: ${rels.join(', ')}`,
  ].join(' ')
}

function bodyFromFirstImport(source: string, rel: string): string {
  const idx = source.indexOf('\nimport ')
  const atStart = source.startsWith('import ')
  if (!atStart && idx === -1) {
    throw new Error(`${rel}: no import line found`)
  }
  return atStart ? source : source.slice(idx + 1)
}

describe('example widget parity', () => {
  it('keeps mcp-app.html byte-identical across the four integrator copies', () => {
    const rels = WIDGET_HTML_KEYS.map(key => lookupRel(key))
    const bodies = WIDGET_HTML_KEYS.map(key => readFileSync(lookupPath(key), 'utf8'))
    const first = bodies[0]
    for (let i = 1; i < bodies.length; i += 1) {
      expect(bodies[i], intendedDuplicationMessage('mcp-app.html', rels)).toBe(first)
    }
  })

  it('keeps mcp-app.tsx identical from the first import across the four copies', () => {
    const rels = WIDGET_TSX_KEYS.map(key => lookupRel(key))
    const bodies = WIDGET_TSX_KEYS.map((key, index) => {
      const rel = rels[index]
      if (rel === undefined) {
        throw new Error(`missing lookup rel for ${key}`)
      }
      return bodyFromFirstImport(readFileSync(lookupPath(key), 'utf8'), rel)
    })
    const first = bodies[0]
    for (let i = 1; i < bodies.length; i += 1) {
      expect(bodies[i], intendedDuplicationMessage('mcp-app.tsx body', rels)).toBe(first)
    }
  })

  it('keeps Cloudflare and Supabase demo-tools.ts identical from the first import', () => {
    const rels = DEMO_TOOLS_KEYS.map(key => lookupRel(key))
    const bodies = DEMO_TOOLS_KEYS.map((key, index) => {
      const rel = rels[index]
      if (rel === undefined) {
        throw new Error(`missing lookup rel for ${key}`)
      }
      return bodyFromFirstImport(readFileSync(lookupPath(key), 'utf8'), rel)
    })
    expect(bodies[1], intendedDuplicationMessage('demo-tools.ts body', rels)).toBe(bodies[0])
  })
})
