/**
 * Host-blend contract for the MCP widget stylesheet.
 *
 * The iframe must sit on the host canvas: transparent chrome, a hairline
 * frame (no fill, no shadow), tokens from the MCP Apps spec. File-level
 * assertions — jsdom does not apply this stylesheet.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const STYLES = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles.css'),
  'utf8',
)

function firstRule(css: string, selectorPattern: RegExp): string {
  const match = css.match(selectorPattern)
  if (!match?.[1]) {
    throw new Error(`rule not found: ${selectorPattern}`)
  }
  return match[1]
}

describe('MCP widget host blend', () => {
  it('paints html/body transparent so the host canvas shows through', () => {
    const body = firstRule(STYLES, /html,\s*body\s*\{([^}]+)\}/)
    expect(body).toMatch(/background:\s*transparent/)
    expect(body).not.toMatch(/--color-background-primary/)
  })

  it('frames .solvapay-mcp-card with a spec hairline and no fill or shadow', () => {
    const card = firstRule(STYLES, /\.solvapay-mcp-card\s*\{([^}]+)\}/)
    expect(card).toMatch(/border-radius:\s*var\(--border-radius-xl,\s*16px\)/)
    expect(card).toMatch(/border:\s*1px solid var\(--color-border-primary/)
    expect(card).not.toMatch(/background:/)
    expect(card).not.toMatch(/box-shadow:/)
  })
})
