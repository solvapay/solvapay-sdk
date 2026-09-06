/**
 * Host-matched Stripe Elements appearance from live `--solvapay-*` tokens.
 *
 * Colour tokens in both SDK stylesheets are `light-dark()` pairs. For an
 * unregistered custom property the computed value is the raw token stream,
 * so `getPropertyValue` is identical in light and dark. Resolve each colour
 * by round-tripping it through a real `color` property, which does resolve
 * `light-dark()` at computed-value time and is scheme-aware.
 *
 * Read from the form root, not `document.documentElement`. In the MCP
 * widget the token bridge lives on `.solvapay-mcp-main`; custom properties
 * inherit, so any descendant of the bridge is a valid root.
 *
 * Missing-token policy: omit, never throw. The SDK stylesheet is opt-in,
 * so headless integrators have no palette, and `--solvapay-font: inherit`
 * resolves to the empty string on `:root`. An absent optional theme token
 * is a valid state, not a failure.
 */
import type { Appearance } from '@stripe/stripe-js'

const SENTINEL_TOKEN = '--solvapay-radius'

const COLOR_VARIABLES = {
  colorBackground: '--solvapay-surface',
  colorText: '--solvapay-accent',
  colorTextSecondary: '--solvapay-muted-foreground',
  colorPrimary: '--solvapay-selection',
  colorDanger: '--solvapay-danger',
} as const

const DIRECT_VARIABLES = {
  borderRadius: '--solvapay-radius',
  fontFamily: '--solvapay-font',
} as const

const CSS_WIDE_KEYWORDS = new Set([
  '',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
])

type StripeVariables = NonNullable<Appearance['variables']>
type StripeRules = NonNullable<Appearance['rules']>

function isUsableToken(value: string): boolean {
  return !CSS_WIDE_KEYWORDS.has(value.trim().toLowerCase())
}

function readToken(style: CSSStyleDeclaration, name: string): string | undefined {
  const value = style.getPropertyValue(name).trim()
  return isUsableToken(value) ? value : undefined
}

function resolveColor(probe: HTMLElement, raw: string): string | undefined {
  probe.style.color = raw
  const resolved = getComputedStyle(probe).color.trim()
  if (!isUsableToken(resolved)) return undefined
  if (resolved.toLowerCase().includes('light-dark')) return undefined
  return resolved
}

export function buildStripeAppearance(root: Element): Appearance | undefined {
  const style = getComputedStyle(root)
  if (!readToken(style, SENTINEL_TOKEN)) return undefined

  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;left:-9999px;top:0'
  root.appendChild(probe)

  const variables: StripeVariables = {
    gridRowSpacing: '16px',
  }

  for (const [stripeKey, token] of Object.entries(COLOR_VARIABLES)) {
    const raw = readToken(style, token)
    if (!raw) continue
    const resolved = resolveColor(probe, raw)
    if (!resolved) continue
    variables[stripeKey as keyof typeof COLOR_VARIABLES] = resolved
  }

  for (const [stripeKey, token] of Object.entries(DIRECT_VARIABLES)) {
    const raw = readToken(style, token)
    if (!raw) continue
    variables[stripeKey as keyof typeof DIRECT_VARIABLES] = raw
  }

  const border = (() => {
    const raw = readToken(style, '--solvapay-border')
    return raw ? resolveColor(probe, raw) : undefined
  })()
  const accent = variables.colorText
  const muted = variables.colorTextSecondary
  const radius = variables.borderRadius
  const surface = variables.colorBackground

  probe.remove()

  const rules: StripeRules = {
    '.Input': {
      height: '40px',
      padding: '0 12px',
      boxShadow: 'none',
      ...(border ? { border: `1px solid ${border}` } : {}),
      ...(radius ? { borderRadius: radius } : {}),
    },
    '.Input:focus': {
      outline: 'none',
      ...(accent
        ? {
            borderColor: accent,
            boxShadow: `0 0 0 1px ${accent}`,
          }
        : {}),
    },
    '.Label': {
      fontSize: '13px',
      fontWeight: '500',
      marginBottom: '8px',
      ...(muted ? { color: muted } : {}),
    },
    '.Tab': {
      ...(border ? { border: `1px solid ${border}` } : {}),
    },
    '.Tab--selected': {
      ...(surface ? { backgroundColor: surface } : {}),
      ...(border ? { border: `1px solid ${border}` } : {}),
      ...(accent ? { color: accent } : {}),
    },
    '.AccordionItem': {
      border: 'none',
      padding: '0',
    },
  }

  return { variables, rules }
}
