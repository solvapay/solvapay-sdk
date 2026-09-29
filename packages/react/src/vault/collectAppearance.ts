/**
 * Translate the SDK's `appearance` into VGS Collect field `css`, so
 * `CardFields` match the host's `--solvapay-*` theme.
 *
 * Sources, in priority order (later wins):
 * 1. `appearance.variables` — colours, font, radius, base size.
 * 2. `appearance.rules['.Input']`, `['.Input:focus']`, `['.Input--invalid']`,
 *    `['.Input::placeholder']` — the same rules `buildAppearance`
 *    derives from `--solvapay-*` tokens.
 * 3. `appearance.fonts` — `{ family, src, weight, style }` entries become
 *    `@font-face` inside the hosted iframe (Collect cannot see host fonts).
 *
 * The result is a plain CSS-in-JS object in Collect's dialect (camelCase
 * keys, `&:focus` / `&.invalid.touched` / `&::placeholder` selectors).
 */
import type { Appearance } from '../types/appearance'

export type CollectCss = Record<string, unknown>

type RuleSet = Record<string, string>

const DEFAULTS = {
  fontSize: '16px',
  lineHeight: '24px',
  padding: '8px 12px',
  borderRadius: '6px',
  color: '#1a1a1a',
  placeholder: '#6b7280',
  background: '#ffffff',
  border: '#d1d5db',
  focus: '#0570de',
  danger: '#df1b41',
}

function rule(appearance: Appearance | undefined, selector: string): RuleSet {
  const rules = appearance?.rules as Record<string, RuleSet> | undefined
  return rules?.[selector] ?? {}
}

function pick(...values: Array<string | undefined>): string | undefined {
  return values.find(v => typeof v === 'string' && v.trim() !== '')
}

/** The border colour out of a shorthand like `1px solid #ccc`, when present. */
function borderColorOf(border: string | undefined): string | undefined {
  if (!border) return undefined
  const parts = border.trim().split(/\s+/)
  return parts.length >= 3 ? parts.slice(2).join(' ') : undefined
}

function fontFaces(appearance: Appearance | undefined): CollectCss[] {
  const fonts = appearance?.fonts ?? []
  const faces: CollectCss[] = []
  for (const f of fonts) {
    if (!f.family || !f.src) continue
    faces.push({
      fontFamily: f.family,
      src: f.src,
      ...(f.weight ? { fontWeight: f.weight } : {}),
      ...(f.style ? { fontStyle: f.style } : {}),
      ...(f.display ? { fontDisplay: f.display } : {}),
    })
  }
  return faces
}

/**
 * Build the Collect `css` for one hosted field from an `Appearance`.
 * Pass `undefined` for the SDK's stock field look (`DEFAULTS`).
 */
export function buildCollectFieldCss(appearance: Appearance | undefined): CollectCss {
  const v = (appearance?.variables ?? {}) as Record<string, string | undefined>
  const input = rule(appearance, '.Input')
  const focus = rule(appearance, '.Input:focus')
  const invalid = rule(appearance, '.Input--invalid')
  const placeholder = rule(appearance, '.Input::placeholder')

  const color = pick(input.color, v.colorText, DEFAULTS.color)
  const placeholderColor = pick(
    placeholder.color,
    v.colorTextPlaceholder,
    v.colorTextSecondary,
    DEFAULTS.placeholder,
  )
  const background = pick(input.backgroundColor, v.colorBackground, DEFAULTS.background)
  const borderColor = pick(
    borderColorOf(input.border),
    input.borderColor,
    v.colorBorder,
    DEFAULTS.border,
  ) as string
  const focusColor = pick(
    focus.borderColor,
    borderColorOf(focus.border),
    v.colorPrimary,
    DEFAULTS.focus,
  ) as string
  const danger = pick(
    invalid.borderColor,
    borderColorOf(invalid.border),
    invalid.color,
    v.colorDanger,
    DEFAULTS.danger,
  ) as string
  const radius = pick(input.borderRadius, v.borderRadius, DEFAULTS.borderRadius)
  const fontFamily = pick(input.fontFamily, v.fontFamily)
  const fontSize = pick(input.fontSize, v.fontSizeBase, DEFAULTS.fontSize)
  const lineHeight = pick(input.lineHeight, v.fontLineHeight, DEFAULTS.lineHeight)
  const padding = pick(input.padding, DEFAULTS.padding)

  const css: CollectCss = {
    boxSizing: 'border-box',
    width: '100%',
    margin: 0,
    outline: 'none',
    appearance: 'none',
    ...(fontFamily ? { fontFamily } : {}),
    fontSize,
    lineHeight,
    padding,
    color,
    backgroundColor: background,
    border: `1px solid ${borderColor}`,
    borderRadius: radius,
    boxShadow: pick(input.boxShadow, 'none'),
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    '&::placeholder': { color: placeholderColor },
    '&:focus': {
      borderColor: focusColor,
      boxShadow: pick(focus.boxShadow, `0 0 0 1px ${focusColor}`),
      ...(focus.outline ? { outline: focus.outline } : {}),
    },
    '&.invalid.touched': {
      borderColor: danger,
      ...(invalid.color ? { color: invalid.color } : {}),
    },
    '&.invalid.touched:focus': {
      borderColor: danger,
      boxShadow: `0 0 0 1px ${danger}`,
    },
  }

  const faces = fontFaces(appearance)
  if (faces.length === 1) css['@font-face'] = faces[0]
  else if (faces.length > 1) css['@font-face'] = faces

  return css
}

/** Deep-merge `override` over `base` (one level of nested selector objects). */
export function mergeCollectCss(base: CollectCss, override: CollectCss | undefined): CollectCss {
  if (!override) return base
  const out: CollectCss = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      out[key] = { ...(existing as CollectCss), ...(value as CollectCss) }
    } else {
      out[key] = value
    }
  }
  return out
}
