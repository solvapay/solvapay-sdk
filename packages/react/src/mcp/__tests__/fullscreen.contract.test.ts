/**
 * Fullscreen hosted-page contract for the MCP widget stylesheet.
 *
 * Fullscreen is the hosted page, not a stretched widget: a centered
 * 1000px column, payment rail 340, management one column, no in-widget
 * header. File-level assertions — jsdom does not apply this stylesheet.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const STYLES = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles.css'),
  'utf8',
)

describe('MCP fullscreen hosted geometry', () => {
  it('centers a 1000px hosted column in fullscreen', () => {
    expect(STYLES).toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\][\s\S]*?\.solvapay-mcp-hosted\s*\{[^}]*max-width:\s*1000px/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\][\s\S]*?\.solvapay-mcp-hosted\s*\{[^}]*margin-inline:\s*auto/,
    )
  })

  it('uses a 1000px container query so narrower hosts keep the inline stack', () => {
    expect(STYLES).toMatch(/@container[^{]+min-width:\s*1000px/)
    expect(STYLES).toMatch(/container-type:\s*inline-size/)
    expect(STYLES).toMatch(/container-name:\s*mcp mcp-hosted/)
  })

  it('pads fullscreen preset tiles and pins an 18px selected check', () => {
    expect(STYLES).toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\]\s+\.solvapay-mcp-preset-tile\s*\{[^}]*padding:\s*16px/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-preset-tile\[data-state='selected'\]::after\s*\{[^}]*width:\s*18px/,
    )
  })

  it('lays payment out as 340px rail + action and keeps management as one column', () => {
    expect(STYLES).toMatch(
      /\.solvapay-mcp-hosted-layout:has\(>\s*\.solvapay-mcp-summary-rail\)\s*\{[^}]*grid-template-columns:\s*340px\s+minmax\(0,\s*1fr\)/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-hosted-layout:has\(>\s*\.solvapay-mcp-summary-rail\)\s*\{[^}]*gap:\s*56px/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-hosted-layout:has\(>\s*\.solvapay-mcp-summary-rail\)\s*\{[^}]*align-items:\s*stretch/,
    )
    expect(STYLES).not.toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+300px/)
    expect(STYLES).toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\][\s\S]*?\.solvapay-mcp-shell\s*\{[^}]*padding:\s*56px 72px 40px/,
    )
  })

  it('hides the in-widget AppHeader in fullscreen — the host owns chrome', () => {
    expect(STYLES).toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\][\s\S]*?\.solvapay-mcp-app-header\s*\{[^}]*display:\s*none/,
    )
  })

  it('lifts the inline reading-measure cap so the hosted column can use 1000px', () => {
    expect(STYLES).toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\][\s\S]*?\.solvapay-mcp-shell\s*\{[^}]*max-inline-size:\s*none/,
    )
  })
})
