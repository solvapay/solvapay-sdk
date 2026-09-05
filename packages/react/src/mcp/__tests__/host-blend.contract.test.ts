/**
 * Host-blend contract for the MCP widget stylesheet.
 *
 * The iframe must sit on the host canvas: transparent chrome, a hairline
 * frame (no fill, no shadow), tokens from the MCP Apps spec. Fallbacks
 * live in one `:root` `light-dark()` block — never as inline
 * `var(--x, #hex)` pairs. File-level assertions — jsdom does not apply
 * this stylesheet.
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

function rootBlock(css: string): string {
  const match = css.match(/:root\s*\{([^}]+)\}/)
  if (!match?.[1]) {
    throw new Error(':root block not found')
  }
  return match[1]
}

function parseLightDark(css: string, token: string): { light: string; dark: string } {
  const match = css.match(
    new RegExp(`${token}:\\s*light-dark\\((#[0-9A-Fa-f]{6}),\\s*(#[0-9A-Fa-f]{6})\\)`),
  )
  if (!match?.[1] || !match[2]) {
    throw new Error(`light-dark pair not found for ${token}`)
  }
  return { light: match[1], dark: match[2] }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace('#', '')
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  }
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const toLinear = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA)
  const l2 = relativeLuminance(hexB)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

const CLAUDE_SURFACES = {
  light: ['#F5F4ED'] as const,
  dark: ['#262624', '#30302E'] as const,
}

describe('MCP widget host blend', () => {
  it('paints html/body transparent so the host canvas shows through', () => {
    const body = firstRule(STYLES, /html,\s*body\s*\{([^}]+)\}/)
    expect(body).toMatch(/background:\s*transparent/)
    expect(body).not.toMatch(/--color-background-primary/)
  })

  it('frames .solvapay-mcp-card with a spec hairline and no fill or shadow', () => {
    const card = firstRule(STYLES, /\.solvapay-mcp-card\s*\{([^}]+)\}/)
    expect(card).toMatch(/border-radius:\s*var\(--border-radius-xl\)/)
    expect(card).toMatch(/border:\s*1px solid var\(--color-border-primary\)/)
    expect(card).not.toMatch(/background:/)
    expect(card).not.toMatch(/box-shadow:/)
  })

  it('does not invent --color-* names the MCP Apps spec does not define', () => {
    const invented = [
      '--color-background-accent',
      '--color-background-subtle',
      '--color-background-elevated',
      '--color-background-raised',
      '--color-background-success-subtle',
      '--color-border-default',
      '--color-text-on-accent',
      '--color-text-on-primary',
      '--color-border,',
      '--color-background,',
      '--color-text,',
    ]
    for (const token of invented) {
      expect(STYLES).not.toContain(token)
    }
    expect(STYLES).toMatch(/--color-background-inverse/)
    expect(STYLES).toMatch(/--color-text-inverse/)
  })

  it('defines host-owned tokens once on :root with light-dark()', () => {
    const root = rootBlock(STYLES)
    expect(root).toMatch(/color-scheme:\s*light dark/)
    expect(parseLightDark(root, '--color-text-secondary')).toEqual({
      light: '#6B6A67',
      dark: '#A3A29E',
    })
    expect(parseLightDark(root, '--solvapay-identifier')).toEqual({
      light: '#65659B',
      dark: '#9B9BE0',
    })
    expect(parseLightDark(root, '--solvapay-danger')).toEqual({
      light: '#C4322A',
      dark: '#F97066',
    })
    expect(parseLightDark(root, '--color-border-primary')).toEqual({
      light: '#8A8A8A',
      dark: '#7E7E7E',
    })
    expect(root).toMatch(/--border-radius-xs:/)
    expect(root).toMatch(/--border-radius-sm:/)
    expect(root).toMatch(/--border-radius-md:/)
    expect(root).toMatch(/--border-radius-lg:/)
    expect(root).toMatch(/--border-radius-xl:/)
    expect(root).toMatch(/--border-radius-full:/)
    expect(root).toMatch(/--color-ring-primary:/)
    expect(root).not.toMatch(/IBM Plex Mono/)
  })

  it('relocates fallbacks to :root and never inlines var(--x, #hex)', () => {
    expect(STYLES).not.toMatch(/var\(\s*--[a-z0-9-]+\s*,\s*#/i)
    expect(STYLES).not.toMatch(/\[data-theme/)
    expect(STYLES).not.toMatch(/prefers-color-scheme/)
  })

  it('does not paint inner elements with the host canvas fill', () => {
    const withoutRoot = STYLES.replace(/:root\s*\{[^}]+\}/, '')
    expect(withoutRoot).not.toMatch(/background:\s*var\(--color-background-primary\)/)
    expect(withoutRoot).not.toMatch(/background:\s*#fff(?:fff)?\b/i)
    expect(withoutRoot).not.toMatch(/background:\s*#f9fafb/i)
  })

  it('drops tour-only tokens and unreachable rules instead of defining them', () => {
    expect(STYLES).not.toContain('--color-background-tertiary')
    expect(STYLES).not.toContain('--shadow-lg')
    expect(STYLES).not.toContain('--color-text-tertiary')
    expect(STYLES).not.toMatch(/\.solvapay-mcp-tour-/)
    expect(STYLES).not.toMatch(/\.solvapay-mcp-tablist/)
    expect(STYLES).not.toMatch(/\.solvapay-mcp-tab[^\w-]/)
    expect(STYLES).not.toMatch(/\.solvapay-mcp-paywall-/)
    expect(STYLES).not.toMatch(/\.solvapay-mcp-plan-actions/)
    expect(STYLES).not.toMatch(/\.solvapay-mcp-plan-topup-prompt/)
    expect(STYLES).not.toMatch(/\.solvapay-mcp-shell-panel/)
    expect(STYLES).not.toMatch(/\.solvapay-mcp-header h1/)
    expect(STYLES).not.toMatch(/\.solvapay-mcp-activation-flow/)
    expect(STYLES).not.toMatch(/\.solvapay-mcp-checkout-terms/)
  })

  it('bridges --solvapay-* onto host-published --color-* inside the widget', () => {
    const main = firstRule(STYLES, /\.solvapay-mcp-main\s*\{([^}]+)\}/)
    expect(main).toMatch(/--solvapay-surface:\s*var\(--color-background-primary\)/)
    expect(main).toMatch(/--solvapay-muted:\s*var\(--color-background-secondary\)/)
    expect(main).toMatch(/--solvapay-muted-foreground:\s*var\(--color-text-secondary\)/)
    expect(main).toMatch(/--solvapay-border:\s*var\(--color-border-secondary\)/)
    expect(main).toMatch(/--solvapay-destructive:\s*var\(--solvapay-danger\)/)
    expect(main).toMatch(/--solvapay-accent-foreground:\s*var\(--solvapay-accent-text\)/)
  })

  it('meets WCAG 2.2 AA against our surfaces and Claude canvases', () => {
    const root = rootBlock(STYLES)
    const backgrounds = {
      light: [
        parseLightDark(root, '--color-background-primary').light,
        parseLightDark(root, '--color-background-secondary').light,
        parseLightDark(root, '--solvapay-row-hover').light,
        parseLightDark(root, '--solvapay-control-hover').light,
        parseLightDark(root, '--solvapay-selection-wash').light,
        ...CLAUDE_SURFACES.light,
      ],
      dark: [
        parseLightDark(root, '--color-background-primary').dark,
        parseLightDark(root, '--color-background-secondary').dark,
        parseLightDark(root, '--solvapay-row-hover').dark,
        parseLightDark(root, '--solvapay-control-hover').dark,
        parseLightDark(root, '--solvapay-selection-wash').dark,
        ...CLAUDE_SURFACES.dark,
      ],
    }
    const textTokens = [
      '--color-text-primary',
      '--color-text-secondary',
      '--solvapay-identifier',
      '--solvapay-danger',
    ] as const

    for (const token of textTokens) {
      const pair = parseLightDark(root, token)
      for (const background of backgrounds.light) {
        expect(contrastRatio(pair.light, background)).toBeGreaterThanOrEqual(4.5)
      }
      for (const background of backgrounds.dark) {
        expect(contrastRatio(pair.dark, background)).toBeGreaterThanOrEqual(4.5)
      }
    }

    const border = parseLightDark(root, '--color-border-primary')
    for (const background of backgrounds.light) {
      expect(contrastRatio(border.light, background)).toBeGreaterThanOrEqual(3)
    }
    for (const background of backgrounds.dark) {
      expect(contrastRatio(border.dark, background)).toBeGreaterThanOrEqual(3)
    }
  })
})
