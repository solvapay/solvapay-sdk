/**
 * Primitive vocabulary + inline density contract for the MCP stylesheet.
 *
 * The v2 mocks share one class set (Section, Eyebrow, LineItem, …) and
 * one component at 420px / 760px. File-level assertions — jsdom does
 * not apply this stylesheet.
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

const PRIMITIVE_CLASSES = [
  '.solvapay-mcp-section',
  '.solvapay-mcp-eyebrow',
  '.solvapay-mcp-line-item',
  '.solvapay-mcp-amount-ladder',
  '.solvapay-mcp-preset-tile',
  '.solvapay-mcp-plan-row',
  '.solvapay-mcp-status-dot',
  '.solvapay-mcp-pill',
  '.solvapay-mcp-field',
  '.solvapay-mcp-toggle',
  '.solvapay-mcp-ledger-row',
  '.solvapay-mcp-attribution',
] as const

describe('MCP primitive vocabulary', () => {
  it('defines every v2 primitive class', () => {
    for (const className of PRIMITIVE_CLASSES) {
      expect(STYLES).toContain(className)
    }
  })

  it('shares LineItem rules with the checkout order-summary and receipt rows', () => {
    expect(STYLES).toMatch(
      /\.solvapay-mcp-line-item[\s\S]*?\.solvapay-mcp-checkout-order-summary-row[\s\S]*?\.solvapay-mcp-checkout-receipt-row\s*\{/,
    )
  })

  it('keeps PresetTile transparent by default and inverse only when selected', () => {
    const tile = firstRule(STYLES, /\.solvapay-mcp-preset-tile\s*\{([^}]+)\}/)
    expect(tile).toMatch(/background:\s*transparent/)
    expect(tile).toMatch(/border:\s*1px solid var\(--color-border-primary\)/)
    expect(tile).toMatch(/min-height:\s*60px/)
    expect(tile).not.toMatch(/--color-background-primary/)

    const selected = firstRule(
      STYLES,
      /\.solvapay-mcp-preset-tile\[data-state='selected'\]\s*\{([^}]+)\}/,
    )
    expect(selected).toMatch(/background:\s*var\(--color-background-inverse\)/)
    expect(selected).not.toMatch(/--color-background-primary/)
  })

  it('fixes PlanRow geometry so selection only changes border and check fill', () => {
    const row = firstRule(STYLES, /\.solvapay-mcp-plan-row\s*\{([^}]+)\}/)
    expect(row).toMatch(/border:\s*1px solid var\(--color-border-secondary\)/)
    expect(row).toMatch(/background:\s*transparent/)
    expect(row).not.toMatch(/--color-background-primary/)

    const selected = firstRule(
      STYLES,
      /\.solvapay-mcp-plan-row\[data-state='selected'\]\s*\{([^}]+)\}/,
    )
    expect(selected).toMatch(/border-color:\s*var\(--color-background-inverse\)/)
    expect(selected).not.toMatch(/padding:/)
    expect(selected).not.toMatch(/min-height:/)

    const check = firstRule(STYLES, /\.solvapay-mcp-plan-row-check\s*\{([^}]+)\}/)
    expect(check).toMatch(/width:\s*20px/)
    expect(check).toMatch(/height:\s*20px/)
    expect(check).toMatch(/flex:\s*0 0 20px/)
    expect(check).toMatch(/background:\s*transparent/)
  })

  it('sizes Toggle 44×26 with a 20px knob and token fills', () => {
    const toggle = firstRule(STYLES, /\.solvapay-mcp-toggle\s*\{([^}]+)\}/)
    expect(toggle).toMatch(/width:\s*44px/)
    expect(toggle).toMatch(/height:\s*26px/)
    expect(toggle).toMatch(/background:\s*var\(--color-background-secondary\)/)

    const knob = firstRule(STYLES, /\.solvapay-mcp-toggle-knob\s*\{([^}]+)\}/)
    expect(knob).toMatch(/width:\s*20px/)
    expect(knob).toMatch(/height:\s*20px/)

    const on = firstRule(
      STYLES,
      /\.solvapay-mcp-toggle\[data-state='on'\]\s*\{([^}]+)\}/,
    )
    expect(on).toMatch(/background:\s*var\(--color-background-inverse\)/)
  })

  it('uses --color-ring-primary for primitive focus, not an invented ring token', () => {
    expect(STYLES).toMatch(
      /\.solvapay-mcp-preset-tile:focus-visible[\s\S]*?--color-ring-primary/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-plan-row:focus-visible[\s\S]*?--color-ring-primary/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-field-control:focus-within[\s\S]*?--color-ring-primary/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-toggle:focus-visible[\s\S]*?--color-ring-primary/,
    )
  })

  it('sizes inline Field controls at 44px and never fills them with canvas primary', () => {
    const control = firstRule(STYLES, /\.solvapay-mcp-field-control\s*\{([^}]+)\}/)
    expect(control).toMatch(/min-height:\s*var\(--solvapay-control-height/)
    expect(control).toMatch(/background:\s*transparent/)
    expect(control).toMatch(/border:\s*1px solid var\(--color-border-primary\)/)
    expect(STYLES).toMatch(/--solvapay-control-height:\s*44px/)
  })
})

describe('MCP inline density contract', () => {
  it('names the inline container mcp and the fullscreen container mcp-hosted', () => {
    const main = firstRule(STYLES, /\.solvapay-mcp-main\s*\{([^}]+)\}/)
    expect(main).toMatch(/container-type:\s*inline-size/)
    expect(main).toMatch(/container-name:\s*mcp/)

    const fullscreen = firstRule(
      STYLES,
      /\.solvapay-mcp-main\[data-display-mode='fullscreen'\]\s*\{([^}]+)\}/,
    )
    expect(fullscreen).toMatch(/container-name:\s*mcp mcp-hosted/)
  })

  it('scopes the 760px density query to mcp and the 1000px payment split to mcp-hosted', () => {
    expect(STYLES).toMatch(/@container\s+mcp\s*\(min-width:\s*760px\)/)
    expect(STYLES).toMatch(/@container\s+mcp-hosted\s*\(min-width:\s*1000px\)/)
    expect(STYLES).not.toMatch(/@container\s*\(min-width:\s*1000px\)/)
  })

  it('defaults to the 420px type scale and lifts it at 760px', () => {
    const main = firstRule(STYLES, /\.solvapay-mcp-main\s*\{([^}]+)\}/)
    expect(main).toMatch(/--solvapay-type-balance:\s*500 30px\/1/)
    expect(main).toMatch(/--solvapay-type-title:\s*600 18px\/1\.3/)
    expect(main).toMatch(/--solvapay-type-plan-row:\s*600 15px\/1\.3/)
    expect(main).toMatch(/--solvapay-card-padding:\s*20px/)
    expect(main).toMatch(/--solvapay-section-gap:\s*18px/)

    const wide = STYLES.match(/@container\s+mcp\s*\(min-width:\s*760px\)\s*\{([\s\S]*?)\n\}/)
    expect(wide?.[1]).toMatch(/--solvapay-type-balance:\s*500 36px\/1/)
    expect(wide?.[1]).toMatch(/--solvapay-type-title:\s*600 20px\/1\.3/)
    expect(wide?.[1]).toMatch(/--solvapay-type-plan-row:\s*600 17px\/1\.3/)
    expect(wide?.[1]).toMatch(/--solvapay-card-padding:\s*24px/)
    expect(wide?.[1]).toMatch(/--solvapay-section-gap:\s*20px/)
  })

  it('stacks split rows by default and places them side-by-side at 760px', () => {
    const split = firstRule(STYLES, /\.solvapay-mcp-split-row\s*\{([^}]+)\}/)
    expect(split).toMatch(/flex-direction:\s*column/)

    expect(STYLES).toMatch(
      /@container\s+mcp\s*\(min-width:\s*760px\)[\s\S]*?\.solvapay-mcp-split-row\s*\{[^}]*flex-direction:\s*row/,
    )
  })

  it('splits inline payment at 260px when the mcp container is 760px wide', () => {
    expect(STYLES).toMatch(
      /@container\s+mcp\s*\(min-width:\s*760px\)[\s\S]*?\[data-rail='inline'\]:has\(>\s*\.solvapay-mcp-summary-rail\)\s*\{[^}]*grid-template-columns:\s*260px\s+minmax\(0,\s*1fr\)/,
    )
    expect(STYLES).toMatch(
      /@container\s+mcp\s*\(min-width:\s*760px\)[\s\S]*?\[data-rail='inline'\]:has\(>\s*\.solvapay-mcp-summary-rail\)\s*\{[^}]*gap:\s*32px/,
    )
    expect(STYLES).toMatch(
      /@container\s+mcp\s*\(min-width:\s*760px\)[\s\S]*?\[data-rail='inline'\]:has\(>\s*\.solvapay-mcp-summary-rail\)\s*\{[^}]*align-items:\s*stretch/,
    )
  })

  it('centers the inline chrome, card and shell as one block without capping main', () => {
    const main = firstRule(STYLES, /\.solvapay-mcp-main\s*\{([^}]+)\}/)
    expect(main).toMatch(/width:\s*100%/)
    expect(main).not.toMatch(/max-inline-size/)

    const block = firstRule(
      STYLES,
      /\.solvapay-mcp-chrome-row,\s*\.solvapay-mcp-main\s*>\s*\.solvapay-mcp-card,\s*\.solvapay-mcp-shell\s*\{([^}]+)\}/,
    )
    expect(block).toMatch(/width:\s*100%/)
    expect(block).toMatch(/max-inline-size:\s*760px/)
    expect(block).toMatch(/margin-inline:\s*auto/)

    const body = firstRule(STYLES, /\.solvapay-mcp-shell-body\s*\{([^}]+)\}/)
    expect(body).not.toMatch(/max-inline-size/)
  })

  it('keeps the inline cap equal to the mcp density threshold so the split cannot fire in a card too narrow to hold it', () => {
    const block = firstRule(
      STYLES,
      /\.solvapay-mcp-chrome-row,\s*\.solvapay-mcp-main\s*>\s*\.solvapay-mcp-card,\s*\.solvapay-mcp-shell\s*\{([^}]+)\}/,
    )
    const capMatch = block.match(/max-inline-size:\s*(\d+)px/)
    const thresholdMatch = STYLES.match(/@container\s+mcp\s*\(min-width:\s*(\d+)px\)/)
    expect(capMatch?.[1]).toBe(thresholdMatch?.[1])
  })
})
