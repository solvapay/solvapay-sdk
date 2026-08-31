import { formatPrice, headlineCharges, minorUnitsPerMajor } from '@solvapay/core'
import { installWidgetCoreSync } from '../src/install-widget-core-sync'

describe('installWidgetCoreSync', () => {
  beforeAll(() => {
    installWidgetCoreSync()
  })

  it('formats SEK whole amounts with a suffix kr', () => {
    expect(formatPrice(10000, 'sek', null, null, null, null)).toBe('100\u00a0kr')
  })

  it('formats USD fractional minor units', () => {
    expect(formatPrice(1999, 'usd', null, null, null, null)).toBe('$19.99')
  })

  it('reports 100 minor units per SEK', () => {
    expect(minorUnitsPerMajor('SEK')).toBe(100)
  })

  it('reads headline flat charges from options[]', () => {
    const charges = headlineCharges({
      options: [{ kind: 'charge', per: 'flat', amountMinor: 10000, currency: 'SEK' }],
    })
    expect(charges).toEqual([{ per: 'flat', amountMinor: 10000, currency: 'SEK' }])
  })
})
