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
  '.solvapay-mcp-status-pill',
  '.solvapay-mcp-fact-band',
  '.solvapay-mcp-usage-meter',
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
    expect(row).toMatch(/flex-direction:\s*row/)
    expect(row).toMatch(/text-align:\s*left/)
    expect(row).toMatch(/box-shadow:\s*none/)
    expect(row).not.toMatch(/--color-background-primary/)

    const selected = firstRule(
      STYLES,
      /\.solvapay-mcp-plan-row\[data-state='selected'\]\s*\{([^}]+)\}/,
    )
    expect(selected).toMatch(/border-color:\s*var\(--color-background-inverse\)/)
    expect(selected).not.toMatch(/padding:/)
    expect(selected).not.toMatch(/min-height:/)
    expect(selected).not.toMatch(/box-shadow:/)

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

  it('accents StatusPill with warning tokens and never invents an accent palette', () => {
    const accent = firstRule(
      STYLES,
      /\.solvapay-mcp-status-pill\[data-tone='accent'\]\s*\{([^}]+)\}/,
    )
    expect(accent).toMatch(/--color-background-warning/)
    expect(accent).toMatch(/--color-text-warning/)
    expect(accent).not.toMatch(/#[0-9A-Fa-f]{3,8}/)
  })

  it('defaults FactBand to key-value rows and becomes fixed-width columns at 760px', () => {
    const band = firstRule(STYLES, /\.solvapay-mcp-fact-band\s*\{([^}]+)\}/)
    expect(band).toMatch(/flex-direction:\s*column/)
    expect(band).not.toMatch(/grid-template-columns/)

    expect(STYLES).toMatch(
      /@container\s+mcp\s*\(min-width:\s*760px\)[\s\S]*?\.solvapay-mcp-fact-band\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*196px\)/,
    )
  })

  it('pins MCP UsageMeter fill tokens to warning, not the shared 75/90 red critical', () => {
    const main = firstRule(STYLES, /\.solvapay-mcp-main\s*\{([^}]+)\}/)
    expect(main).toMatch(/--solvapay-usage-warning:\s*var\(--color-text-warning\)/)
    expect(main).toMatch(/--solvapay-usage-critical:\s*var\(--color-text-warning\)/)
    expect(main).toMatch(/--solvapay-usage-safe:\s*var\(--color-text-primary\)/)
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
    expect(STYLES).toMatch(
      /@container\s+mcp-hosted\s*\(min-width:\s*1000px\)[\s\S]*?\[data-rail='hosted'\]:has\(>\s*\.solvapay-mcp-summary-rail\)/,
    )
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

describe('MCP tax-summary rail stack', () => {
  it('is a plain stack, not a bordered form box', () => {
    const rule = firstRule(STYLES, /\.solvapay-mcp-tax-summary\s*\{([^}]+)\}/)
    expect(rule).toMatch(/display:\s*flex/)
    expect(rule).toMatch(/flex-direction:\s*column/)
    expect(rule).not.toMatch(/border:\s*1px solid/)
    expect(rule).not.toMatch(/padding:\s*10px 12px/)
    expect(rule).not.toMatch(/border-radius/)
  })

  it('keeps the total-row hairline and tax-note selectors', () => {
    const total = firstRule(
      STYLES,
      /\.solvapay-mcp-tax-summary \.solvapay-tax-summary-row--total\s*\{([^}]+)\}/,
    )
    expect(total).toMatch(/border-top/)
    expect(STYLES).toMatch(
      /\.solvapay-mcp-tax-summary \[data-solvapay-topup-form-summary-tax-note\]/,
    )
    expect(STYLES).toMatch(
      /\.solvapay-mcp-tax-summary \[data-solvapay-payment-form-summary-tax-note\]/,
    )
  })
})

const WEB_STYLES = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'styles.css'),
  'utf8',
)

describe('MCP payment form deboxing', () => {
  it('keeps .solvapay-mcp-business-details as a borderless stack', () => {
    const rule = firstRule(STYLES, /\.solvapay-mcp-business-details\s*\{([^}]+)\}/)
    expect(rule).toMatch(/display:\s*flex/)
    expect(rule).toMatch(/flex-direction:\s*column/)
    expect(rule).toMatch(/gap:\s*16px/)
    expect(rule).not.toMatch(/border:/)
    expect(rule).not.toMatch(/padding:/)
  })

  it('widens the top-up form group gap', () => {
    const rule = firstRule(STYLES, /\.solvapay-mcp-topup-form\s*\{([^}]+)\}/)
    expect(rule).toMatch(/gap:\s*20px/)
  })

  it('gives the shared business-details fields section a column gap', () => {
    expect(WEB_STYLES).toMatch(
      /\[data-solvapay-payment-form-business-details-fields\],\s*\[data-solvapay-topup-form-business-details-fields\]\s*\{[^}]*gap:/,
    )
  })

  it('neutrals the business checkbox with the inverse token', () => {
    expect(STYLES).toMatch(
      /\.solvapay-mcp-business-details input\[type=['"]checkbox['"]\]\s*\{[^}]*accent-color:\s*var\(--color-background-inverse\)/,
    )
  })

  it('gives the hosted body a section gap between header and form', () => {
    const rule = firstRule(STYLES, /\.solvapay-mcp-hosted-body\s*\{([^}]+)\}/)
    expect(rule).toMatch(/display:\s*flex/)
    expect(rule).toMatch(/flex-direction:\s*column/)
    expect(rule).toMatch(/gap:\s*var\(--solvapay-section-gap\)/)
    expect(STYLES).toMatch(
      /\.solvapay-mcp-hosted-body > \.solvapay-mcp-back-link\s*\{[^}]*margin-bottom:\s*0/,
    )
  })

  it('locks the business-details input ratios the Stripe builder mirrors', () => {
    expect(WEB_STYLES).toMatch(
      /\[data-solvapay-payment-form-business-details-name\][\s\S]*?height:\s*2\.5rem/,
    )
    expect(WEB_STYLES).toMatch(
      /\[data-solvapay-payment-form-business-details-name\][\s\S]*?padding:\s*0 0\.75rem/,
    )
  })
})
