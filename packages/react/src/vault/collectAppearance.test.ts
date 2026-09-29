import { describe, expect, it } from 'vitest'
import { buildCollectFieldCss, mergeCollectCss } from './collectAppearance'

const STOCK_CSS = {
  boxSizing: 'border-box',
  width: '100%',
  margin: 0,
  outline: 'none',
  appearance: 'none',
  fontSize: '16px',
  lineHeight: '24px',
  padding: '8px 12px',
  color: '#1a1a1a',
  backgroundColor: '#ffffff',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  boxShadow: 'none',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  '&::placeholder': { color: '#6b7280' },
  '&:focus': { borderColor: '#0570de', boxShadow: '0 0 0 1px #0570de' },
  '&.invalid.touched': { borderColor: '#df1b41' },
  '&.invalid.touched:focus': { borderColor: '#df1b41', boxShadow: '0 0 0 1px #df1b41' },
}

describe('buildCollectFieldCss', () => {
  it('uses the stock field look when no appearance is given', () => {
    expect(buildCollectFieldCss(undefined)).toStrictEqual(STOCK_CSS)
  })

  it('treats an empty appearance the same as none', () => {
    expect(buildCollectFieldCss({})).toStrictEqual(STOCK_CSS)
    expect(buildCollectFieldCss({ variables: {}, rules: {} })).toStrictEqual(STOCK_CSS)
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
        '.Input': {
          fontSize: '15px',
          lineHeight: '22px',
          padding: '7px 11px',
          border: '1px solid rgb(200, 200, 200)',
        },
        '.Input:focus': { borderColor: 'rgb(1, 2, 3)', boxShadow: '0 0 0 1px rgb(1, 2, 3)' },
      },
    })
    expect(css).toStrictEqual({
      boxSizing: 'border-box',
      width: '100%',
      margin: 0,
      outline: 'none',
      appearance: 'none',
      fontFamily: 'Inter, sans-serif',
      fontSize: '15px',
      lineHeight: '22px',
      padding: '7px 11px',
      color: 'rgb(1, 2, 3)',
      backgroundColor: 'rgb(255, 255, 255)',
      border: '1px solid rgb(200, 200, 200)',
      borderRadius: '12px',
      boxShadow: 'none',
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      '&::placeholder': { color: 'rgb(9, 9, 9)' },
      '&:focus': { borderColor: 'rgb(1, 2, 3)', boxShadow: '0 0 0 1px rgb(1, 2, 3)' },
      '&.invalid.touched': { borderColor: 'rgb(255, 0, 0)' },
      '&.invalid.touched:focus': {
        borderColor: 'rgb(255, 0, 0)',
        boxShadow: '0 0 0 1px rgb(255, 0, 0)',
      },
    })
  })

  it('lets .Input rules win over variables and derives focus/danger from variables (dark theme)', () => {
    const css = buildCollectFieldCss({
      variables: {
        colorText: '#ffffff',
        colorTextPlaceholder: '#888888',
        colorTextSecondary: '#999999',
        colorBackground: '#000000',
        colorBorder: '#333333',
        colorPrimary: '#00ff00',
        colorDanger: '#ff0000',
        borderRadius: '4px',
        fontLineHeight: '20px',
      },
      rules: {
        '.Input': {
          color: '#eeeeee',
          backgroundColor: '#111111',
          borderColor: '#444444',
          borderRadius: '2px',
          boxShadow: '0 1px 2px #000',
        },
        '.Input:focus': { border: '2px dashed #abcdef', outline: '2px solid #abcdef' },
        '.Input--invalid': { border: '1px solid #cc0000', color: '#ffcccc' },
        '.Input::placeholder': { color: '#777777' },
      },
    })
    expect(css).toStrictEqual({
      boxSizing: 'border-box',
      width: '100%',
      margin: 0,
      outline: 'none',
      appearance: 'none',
      fontSize: '16px',
      lineHeight: '20px',
      padding: '8px 12px',
      color: '#eeeeee',
      backgroundColor: '#111111',
      border: '1px solid #444444',
      borderRadius: '2px',
      boxShadow: '0 1px 2px #000',
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      '&::placeholder': { color: '#777777' },
      '&:focus': {
        borderColor: '#abcdef',
        boxShadow: '0 0 0 1px #abcdef',
        outline: '2px solid #abcdef',
      },
      '&.invalid.touched': { borderColor: '#cc0000', color: '#ffcccc' },
      '&.invalid.touched:focus': { borderColor: '#cc0000', boxShadow: '0 0 0 1px #cc0000' },
    })
  })

  it('ignores blank rule values and a border shorthand without a colour', () => {
    const css = buildCollectFieldCss({
      variables: { colorBorder: '#abcabc', colorText: '   ' },
      rules: { '.Input': { border: '1px solid', color: '' } },
    })
    expect(css.border).toBe('1px solid #abcabc')
    expect(css.color).toBe('#1a1a1a')
  })

  it('turns appearance.fonts with src into @font-face inside the iframe', () => {
    const css = buildCollectFieldCss({
      fonts: [
        { family: 'Inter', src: 'url(data:font/woff2;base64,AAAA) format("woff2")', weight: '400' },
        { cssSrc: 'https://fonts.googleapis.com/css?family=Roboto' },
      ],
    } as never)
    expect(css).toStrictEqual({
      ...STOCK_CSS,
      '@font-face': {
        fontFamily: 'Inter',
        src: 'url(data:font/woff2;base64,AAAA) format("woff2")',
        fontWeight: '400',
      },
    })
  })

  it('emits an array of @font-face entries for several fonts, keeping style and display', () => {
    const css = buildCollectFieldCss({
      fonts: [
        { family: 'Inter', src: 'url(a.woff2)', weight: '400', style: 'normal', display: 'swap' },
        { family: 'Inter', src: 'url(b.woff2)', weight: '700', style: 'italic' },
        { family: 'NoSrc' },
      ],
    } as never)
    expect(css['@font-face']).toStrictEqual([
      {
        fontFamily: 'Inter',
        src: 'url(a.woff2)',
        fontWeight: '400',
        fontStyle: 'normal',
        fontDisplay: 'swap',
      },
      { fontFamily: 'Inter', src: 'url(b.woff2)', fontWeight: '700', fontStyle: 'italic' },
    ])
  })
})

describe('mergeCollectCss', () => {
  it('overrides flat keys and merges nested selectors', () => {
    const merged = mergeCollectCss(
      { color: 'a', '&:focus': { borderColor: 'b', boxShadow: 'c' } },
      { color: 'x', '&:focus': { borderColor: 'y' } },
    )
    expect(merged).toStrictEqual({ color: 'x', '&:focus': { borderColor: 'y', boxShadow: 'c' } })
  })

  it('returns the base untouched when there is no override and does not mutate it', () => {
    const base = { color: 'a', '&:focus': { borderColor: 'b' } }
    expect(mergeCollectCss(base, undefined)).toBe(base)
    const merged = mergeCollectCss(base, { color: 'z', '&:focus': { boxShadow: 's' } })
    expect(merged).toStrictEqual({ color: 'z', '&:focus': { borderColor: 'b', boxShadow: 's' } })
    expect(base).toStrictEqual({ color: 'a', '&:focus': { borderColor: 'b' } })
  })

  it('replaces (not merges) arrays and adds keys the base does not have', () => {
    const merged = mergeCollectCss(
      { '@font-face': [{ fontFamily: 'A' }], '&:focus': { borderColor: 'b' } },
      { '@font-face': [{ fontFamily: 'B' }], '&::placeholder': { color: 'p' }, '&:focus': 'flat' },
    )
    expect(merged).toStrictEqual({
      '@font-face': [{ fontFamily: 'B' }],
      '&:focus': 'flat',
      '&::placeholder': { color: 'p' },
    })
  })
})
