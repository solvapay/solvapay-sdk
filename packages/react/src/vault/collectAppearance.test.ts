import { describe, expect, it } from 'vitest'
import { buildCollectFieldCss, mergeCollectCss } from './collectAppearance'

describe('buildCollectFieldCss', () => {
  it('mirrors Stripe defaults when no appearance is given', () => {
    const css = buildCollectFieldCss(undefined)
    expect(css).toMatchObject({
      boxSizing: 'border-box',
      width: '100%',
      fontSize: '16px',
      border: '1px solid #d1d5db',
      '&::placeholder': { color: '#6b7280' },
    })
    expect(css['&:focus']).toMatchObject({ borderColor: '#0570de' })
    expect(css['&.invalid.touched']).toMatchObject({ borderColor: '#df1b41' })
    expect(css['@font-face']).toBeUndefined()
  })

  it('takes colours, font and metrics from the token-derived appearance rules', () => {
    const css = buildCollectFieldCss({
      variables: {
        colorText: 'rgb(1, 2, 3)',
        colorTextSecondary: 'rgb(9, 9, 9)',
        colorBackground: 'rgb(255, 255, 255)',
        colorPrimary: 'rgb(0, 0, 255)',
        colorDanger: 'rgb(255, 0, 0)',
        borderRadius: '12px',
        fontFamily: 'Inter, sans-serif',
        fontSizeBase: '15px',
      },
      rules: {
        '.Input': { fontSize: '15px', lineHeight: '22px', padding: '7px 11px', border: '1px solid rgb(200, 200, 200)' },
        '.Input:focus': { borderColor: 'rgb(1, 2, 3)', boxShadow: '0 0 0 1px rgb(1, 2, 3)' },
      },
    })
    expect(css).toMatchObject({
      fontFamily: 'Inter, sans-serif',
      fontSize: '15px',
      lineHeight: '22px',
      padding: '7px 11px',
      color: 'rgb(1, 2, 3)',
      backgroundColor: 'rgb(255, 255, 255)',
      border: '1px solid rgb(200, 200, 200)',
      borderRadius: '12px',
      '&::placeholder': { color: 'rgb(9, 9, 9)' },
      '&:focus': { borderColor: 'rgb(1, 2, 3)', boxShadow: '0 0 0 1px rgb(1, 2, 3)' },
      '&.invalid.touched': { borderColor: 'rgb(255, 0, 0)' },
    })
  })

  it('turns appearance.fonts with src into @font-face inside the iframe', () => {
    const css = buildCollectFieldCss({
      fonts: [
        { family: 'Inter', src: 'url(data:font/woff2;base64,AAAA) format("woff2")', weight: '400' },
        { cssSrc: 'https://fonts.googleapis.com/css?family=Roboto' },
      ],
    } as never)
    expect(css['@font-face']).toEqual({
      fontFamily: 'Inter',
      src: 'url(data:font/woff2;base64,AAAA) format("woff2")',
      fontWeight: '400',
    })
  })
})

describe('mergeCollectCss', () => {
  it('overrides flat keys and merges nested selectors', () => {
    const merged = mergeCollectCss(
      { color: 'a', '&:focus': { borderColor: 'b', boxShadow: 'c' } },
      { color: 'x', '&:focus': { borderColor: 'y' } },
    )
    expect(merged).toEqual({ color: 'x', '&:focus': { borderColor: 'y', boxShadow: 'c' } })
  })
})
