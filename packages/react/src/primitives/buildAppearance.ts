/**
 * Host-matched card-field `Appearance` from live `--solvapay-*` tokens.
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
import type { Appearance, AppearanceRules, AppearanceVariables } from '../types/appearance'

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

/** Mirrors the business-details input rule in styles.css — locked by contract test. */
const CONTROL_HEIGHT_RATIO = 2.5
const CONTROL_PADDING_X_RATIO = 0.75
const LINE_HEIGHT_RATIO = 1.5

function readRootFontPx(root: Element): number {
  const px = parseFloat(getComputedStyle(root).fontSize)
  return Number.isFinite(px) && px > 0 ? px : 16
}

function px(value: number): string {
  return `${value}px`
}

function deriveControlMetrics(rootPx: number) {
  const lineHeight = LINE_HEIGHT_RATIO * rootPx
  const paddingY = (CONTROL_HEIGHT_RATIO * rootPx - 2 - lineHeight) / 2
  const paddingX = CONTROL_PADDING_X_RATIO * rootPx
  return {
    fontSize: px(rootPx),
    lineHeight: px(lineHeight),
    padding: `${px(paddingY)} ${px(paddingX)}`,
  }
}

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

export function buildAppearance(root: Element): Appearance | undefined {
  const style = getComputedStyle(root)
  if (!readToken(style, SENTINEL_TOKEN)) return undefined

  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;left:-9999px;top:0'
  root.appendChild(probe)

  const metrics = deriveControlMetrics(readRootFontPx(root))

  const variables: AppearanceVariables = {
    fontSizeBase: metrics.fontSize,
    fontLineHeight: metrics.lineHeight,
  }

  for (const [key, token] of Object.entries(COLOR_VARIABLES)) {
    const raw = readToken(style, token)
    if (!raw) continue
    const resolved = resolveColor(probe, raw)
    if (!resolved) continue
    variables[key as keyof typeof COLOR_VARIABLES] = resolved
  }

  for (const [key, token] of Object.entries(DIRECT_VARIABLES)) {
    const raw = readToken(style, token)
    if (!raw) continue
    variables[key as keyof typeof DIRECT_VARIABLES] = raw
  }

  const border = (() => {
    const raw = readToken(style, '--solvapay-border')
    return raw ? resolveColor(probe, raw) : undefined
  })()
  if (border) variables.colorBorder = border
  const accent = variables.colorText
  const muted = variables.colorTextSecondary
  const danger = variables.colorDanger
  const radius = variables.borderRadius
  const fontFamily = variables.fontFamily

  probe.remove()

  const rules: AppearanceRules = {
    '.Input': {
      fontSize: metrics.fontSize,
      lineHeight: metrics.lineHeight,
      padding: metrics.padding,
      boxShadow: 'none',
      ...(fontFamily ? { fontFamily } : {}),
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
    '.Input--invalid': {
      ...(danger ? { borderColor: danger } : {}),
    },
    '.Input::placeholder': {
      ...(muted ? { color: muted } : {}),
    },
  }

  return { variables, rules }
}
