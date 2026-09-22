/**
 * jsdom 29 resolves `light-dark()` on the `color` property from the used
 * `color-scheme` of the element (inherited from an ancestor). These tests
 * feed `light-dark()` pairs — not hex — and assert the scheme-aware
 * `rgb(...)` the production builder reads after its colour round-trip.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { buildStripeAppearance } from './buildStripeAppearance'

const FULL_PALETTE: Record<string, string> = {
  '--solvapay-radius': '8px',
  '--solvapay-surface': 'light-dark(#FFFFFF, #171717)',
  '--solvapay-accent': 'light-dark(#000000, #E8E8E8)',
  '--solvapay-muted-foreground': 'light-dark(#6B6A67, #A3A29E)',
  '--solvapay-selection': 'light-dark(#4D89A2, #6B9CAE)',
  '--solvapay-danger': 'light-dark(#C4322A, #F97066)',
  '--solvapay-border': 'light-dark(#D9D9D9, #3A3A3A)',
  '--solvapay-font': 'Inter, sans-serif',
}

function paletteRoot(
  overrides: Record<string, string | null> = {},
  scheme: 'light' | 'dark' = 'light',
): HTMLElement {
  const root = document.createElement('div')
  root.style.colorScheme = scheme
  if (overrides.fontSize == null) {
    root.style.fontSize = '16px'
  }
  for (const [token, value] of Object.entries({ ...FULL_PALETTE, ...overrides })) {
    if (value === null) continue
    if (token === 'fontSize') {
      root.style.fontSize = value
      continue
    }
    root.style.setProperty(token, value)
  }
  document.body.appendChild(root)
  return root
}

describe('buildStripeAppearance', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('returns undefined when the sentinel --solvapay-radius is absent', () => {
    const root = paletteRoot({ '--solvapay-radius': null })
    expect(buildStripeAppearance(root)).toBeUndefined()
  })

  it('omits fontFamily when --solvapay-font is inherit and does not throw', () => {
    const root = paletteRoot({ '--solvapay-font': 'inherit' })
    const appearance = buildStripeAppearance(root)
    expect(appearance?.variables?.fontFamily).toBeUndefined()
    expect(appearance?.variables?.borderRadius).toBe('8px')
  })

  it('omits a Stripe variable whose source token is empty and does not throw', () => {
    const root = paletteRoot({ '--solvapay-selection': null })
    const appearance = buildStripeAppearance(root)
    expect(appearance?.variables?.colorPrimary).toBeUndefined()
    expect(appearance?.variables?.colorBackground).toBe('rgb(255, 255, 255)')
  })

  it('maps SolvaPay tokens onto the Stripe variable table', () => {
    const appearance = buildStripeAppearance(paletteRoot())
    expect(appearance?.variables).toMatchObject({
      colorBackground: 'rgb(255, 255, 255)',
      colorText: 'rgb(0, 0, 0)',
      colorTextSecondary: 'rgb(107, 106, 103)',
      colorPrimary: 'rgb(77, 137, 162)',
      colorDanger: 'rgb(196, 50, 42)',
      borderRadius: '8px',
      fontFamily: 'Inter, sans-serif',
      fontSizeBase: '16px',
      gridRowSpacing: '12px',
      gridColumnSpacing: '12px',
    })
  })

  it('resolves the same light-dark tokens to different rgb values in light vs dark', () => {
    const light = buildStripeAppearance(paletteRoot({}, 'light'))
    const dark = buildStripeAppearance(paletteRoot({}, 'dark'))
    expect(light?.variables?.colorBackground).toBe('rgb(255, 255, 255)')
    expect(dark?.variables?.colorBackground).toBe('rgb(23, 23, 23)')
    expect(light?.variables?.colorText).toBe('rgb(0, 0, 0)')
    expect(dark?.variables?.colorText).toBe('rgb(232, 232, 232)')
  })

  it('derives input metrics from the host root font size', () => {
    const widget = buildStripeAppearance(paletteRoot({ fontSize: '14px' }))
    expect(widget?.variables?.fontSizeBase).toBe('14px')
    expect(widget?.variables?.gridRowSpacing).toBe('10.5px')
    expect(widget?.variables?.gridColumnSpacing).toBe('10.5px')
    expect(widget?.rules?.['.Input']).toMatchObject({
      fontSize: '14px',
      lineHeight: '21px',
      padding: '6px 10.5px',
    })
    expect(widget?.rules?.['.Input']).not.toHaveProperty('height')

    const web = buildStripeAppearance(paletteRoot({ fontSize: '16px' }))
    expect(web?.rules?.['.Input']).toMatchObject({
      fontSize: '16px',
      lineHeight: '24px',
      padding: '7px 12px',
    })
    expect(web?.rules?.['.Input']).not.toHaveProperty('height')
  })

  it('mirrors host input chrome on Stripe Input / Label / Tab / AccordionItem', () => {
    const appearance = buildStripeAppearance(paletteRoot())
    expect(appearance?.rules?.['.Input']).toMatchObject({
      fontSize: '16px',
      lineHeight: '24px',
      padding: '7px 12px',
      boxShadow: 'none',
      border: '1px solid rgb(217, 217, 217)',
      borderRadius: '8px',
      fontFamily: 'Inter, sans-serif',
    })
    expect(appearance?.rules?.['.Input']).not.toHaveProperty('height')
    expect(appearance?.rules?.['.Input:focus']).toMatchObject({
      borderColor: 'rgb(0, 0, 0)',
      boxShadow: '0 0 0 1px rgb(0, 0, 0)',
      outline: 'none',
    })
    expect(appearance?.rules?.['.Label']).toMatchObject({
      fontSize: '13px',
      fontWeight: '500',
      color: 'rgb(107, 106, 103)',
      marginBottom: '8px',
    })
    expect(appearance?.rules?.['.Error']).toMatchObject({
      fontSize: '12px',
      marginTop: '6px',
      color: 'rgb(196, 50, 42)',
    })
    expect(appearance?.rules?.['.Tab']).toMatchObject({
      border: '1px solid rgb(217, 217, 217)',
    })
    expect(appearance?.rules?.['.AccordionItem']).toEqual({
      border: 'none',
      padding: '0',
    })
  })
})
