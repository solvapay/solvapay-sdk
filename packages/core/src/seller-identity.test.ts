import { describe, expect, it } from 'vitest'
import { SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE } from './seller-identity'
import { getSellerTaxIdentifierDisplayLabel, resolveSellerIdentityDisplay } from './native-core'

describe('SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE', () => {
  it('uses VAT number for EU and GB', () => {
    expect(SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE.eu_vat).toBe('VAT number')
    expect(SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE.gb_vat).toBe('VAT number')
  })

  it('uses EIN for US', () => {
    expect(SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE.us_ein).toBe('EIN')
  })
})

describe('getSellerTaxIdentifierDisplayLabel', () => {
  it('returns country-specific labels', () => {
    expect(getSellerTaxIdentifierDisplayLabel('DE')).toBe('VAT number')
    expect(getSellerTaxIdentifierDisplayLabel('GB')).toBe('VAT number')
    expect(getSellerTaxIdentifierDisplayLabel('US')).toBe('EIN')
  })

  it('falls back to Tax ID for unsupported countries', () => {
    expect(getSellerTaxIdentifierDisplayLabel('CA')).toBe('Tax ID')
    expect(getSellerTaxIdentifierDisplayLabel(null)).toBe('Tax ID')
  })
})

describe('resolveSellerIdentityDisplay', () => {
  it('prefers vatNumber for EU sellers', () => {
    expect(
      resolveSellerIdentityDisplay({
        country: 'DE',
        vatNumber: 'DE123456789',
        taxId: 'DE999999999',
        companyNumber: 'HRB12345',
      }),
    ).toEqual({
      taxIdentifier: { label: 'VAT number', value: 'DE123456789' },
      companyNumber: { label: 'Company number', value: 'HRB12345' },
    })
  })

  it('falls back to taxId for EU sellers without vatNumber', () => {
    expect(
      resolveSellerIdentityDisplay({
        country: 'SE',
        vatNumber: null,
        taxId: 'SE556677889001',
        companyNumber: '5561234567',
      }),
    ).toEqual({
      taxIdentifier: { label: 'VAT number', value: 'SE556677889001' },
      companyNumber: { label: 'Company number', value: '5561234567' },
    })
  })

  it('uses VAT number label for GB sellers', () => {
    expect(
      resolveSellerIdentityDisplay({
        country: 'GB',
        vatNumber: 'GB987654321',
        companyNumber: 'GB123456789',
      }),
    ).toEqual({
      taxIdentifier: { label: 'VAT number', value: 'GB987654321' },
      companyNumber: { label: 'Company number', value: 'GB123456789' },
    })
  })

  it('uses taxId with EIN label for US sellers', () => {
    expect(
      resolveSellerIdentityDisplay({
        country: 'US',
        taxId: '12-3456789',
        companyNumber: '12-3456789',
      }),
    ).toEqual({
      taxIdentifier: { label: 'EIN', value: '12-3456789' },
      companyNumber: null,
    })
  })

  it('falls back to companyNumber for US sellers without taxId', () => {
    expect(
      resolveSellerIdentityDisplay({
        country: 'US',
        taxId: null,
        companyNumber: '12-3456789',
      }),
    ).toEqual({
      taxIdentifier: { label: 'EIN', value: '12-3456789' },
      companyNumber: null,
    })
  })

  it('shows taxId for unsupported countries', () => {
    expect(
      resolveSellerIdentityDisplay({
        country: 'CA',
        taxId: '123456789RT0001',
      }),
    ).toEqual({
      taxIdentifier: { label: 'Tax ID', value: '123456789RT0001' },
      companyNumber: null,
    })
  })

  it('deduplicates company number when it matches the tax row', () => {
    expect(
      resolveSellerIdentityDisplay({
        country: 'DE',
        vatNumber: 'DE123456789',
        companyNumber: 'DE123456789',
      }),
    ).toEqual({
      taxIdentifier: { label: 'VAT number', value: 'DE123456789' },
      companyNumber: null,
    })
  })

  it('returns null rows when all identifiers are missing', () => {
    expect(
      resolveSellerIdentityDisplay({
        country: 'US',
        vatNumber: null,
        taxId: null,
        companyNumber: null,
      }),
    ).toEqual({
      taxIdentifier: null,
      companyNumber: null,
    })
  })
})
