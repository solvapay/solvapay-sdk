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
      /\[data-rail='hosted'\]:has\(>\s*\.solvapay-mcp-summary-rail\)\s*\{[^}]*grid-template-columns:\s*340px\s+minmax\(0,\s*1fr\)/,
    )
    expect(STYLES).toMatch(
      /\[data-rail='hosted'\]:has\(>\s*\.solvapay-mcp-summary-rail\)\s*\{[^}]*gap:\s*56px/,
    )
    expect(STYLES).toMatch(
      /\[data-rail='hosted'\]:has\(>\s*\.solvapay-mcp-summary-rail\)\s*\{[^}]*align-items:\s*stretch/,
    )
    expect(STYLES).not.toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+300px/)
    expect(STYLES).toMatch(
      /\.solvapay-mcp-hosted\[data-mcp-surface='management'\][\s\S]*?\.solvapay-mcp-hosted-layout\s*\{[^}]*flex-direction:\s*column/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-account\s*\{[^}]*flex-direction:\s*column/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\][\s\S]*?\.solvapay-mcp-shell\s*\{[^}]*padding:\s*56px 72px 40px/,
    )
  })

  it('never reads env(safe-area-inset) — hostContext.safeAreaInsets is the source', () => {
    expect(STYLES).not.toMatch(/padding(?:-[a-z]+)?:\s*env\(\s*safe-area-inset/)
  })

  it('hides the in-widget AppHeader in fullscreen — the host owns chrome', () => {
    expect(STYLES).toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\][\s\S]*?\.solvapay-mcp-app-header\s*\{[^}]*display:\s*none/,
    )
  })

  it('fills the host canvas and centres the shell on main', () => {
    expect(STYLES).toMatch(
      /html:has\(\.solvapay-mcp-main\[data-display-mode='fullscreen'\]\)[\s\S]*?#root\s*\{[^}]*height:\s*100%/,
    )
    expect(STYLES).toMatch(
      /html:has\(\.solvapay-mcp-main\[data-display-mode='fullscreen'\]\)\s+#root\s*\{[^}]*padding:\s*0/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\]\s*\{[^}]*align-items:\s*center/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\]\s*\{[^}]*justify-content:\s*safe center/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\][\s\S]*?\.solvapay-mcp-shell\s*\{[^}]*max-inline-size:\s*1144px/,
    )
    expect(STYLES).not.toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\][\s\S]*?\.solvapay-mcp-shell\s*\{[^}]*max-inline-size:\s*none/,
    )
  })

  it('hides the fullscreen chrome row', () => {
    expect(STYLES).toMatch(
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\]\s+\.solvapay-mcp-chrome-row\s*\{[^}]*display:\s*none/,
    )
  })

  it('does not shrink rail-less payment cards below the 1000px hosted column', () => {
    expect(STYLES).not.toMatch(
      /\[data-mcp-surface='payment'\][\s\S]*?\.solvapay-mcp-card:not\(:has\(\.solvapay-mcp-summary-rail\)\)\s*\{[^}]*max-inline-size:\s*760px/,
    )
  })

  it('resets portal text-link chrome so history links are not filled pills', () => {
    expect(STYLES).toMatch(/\.solvapay-mcp-history-link\s*\{[^}]*background:\s*none/)
    expect(STYLES).toMatch(/\.solvapay-mcp-history-link\s*\{[^}]*padding:\s*0/)
    expect(STYLES).toMatch(/\.solvapay-mcp-history-link\s*\{[^}]*border-radius:\s*0/)
    expect(STYLES).toMatch(/\.solvapay-mcp-history-link\s*\{[^}]*border:\s*none/)
    expect(STYLES).toMatch(
      /\.solvapay-mcp-history-link\[data-state='ready'\]:hover\s*\{[^}]*background:\s*none/,
    )
  })
})
