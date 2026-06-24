import { describe, expect, it } from 'vitest'
import {
  COUNTRY_TO_TAX_ID_TYPE,
  SUPPORTED_BUSINESS_COUNTRIES,
  deriveTaxIdType,
  getTaxIdExample,
  getTaxIdFieldLabel,
  getTaxIdHelperText,
  validateBusinessDetails,
} from './business-details'

describe('deriveTaxIdType', () => {
  it('returns eu_vat for EU member states', () => {
    expect(deriveTaxIdType('SE')).toBe('eu_vat')
    expect(deriveTaxIdType('DE')).toBe('eu_vat')
    expect(deriveTaxIdType('FR')).toBe('eu_vat')
  })

  it('returns gb_vat for GB', () => {
    expect(deriveTaxIdType('GB')).toBe('gb_vat')
  })

  it('returns us_ein for US', () => {
    expect(deriveTaxIdType('US')).toBe('us_ein')
  })
})

describe('validateBusinessDetails', () => {
  it('accepts a valid Swedish business', () => {
    const result = validateBusinessDetails({
      isBusiness: true,
      businessName: 'Nordic AB',
      country: 'SE',
      taxId: 'SE556677889001',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.taxId).toBe('SE556677889001')
      expect(result.data.taxIdType).toBe('eu_vat')
    }
  })

  it('accepts a valid German business', () => {
    const result = validateBusinessDetails({
      isBusiness: true,
      businessName: 'Acme GmbH',
      country: 'DE',
      taxId: 'DE123456789',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid US business with EIN', () => {
    const result = validateBusinessDetails({
      isBusiness: true,
      businessName: 'Acme Inc',
      country: 'US',
      taxId: '12-3456789',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.taxIdType).toBe('us_ein')
    }
  })

  it('accepts a valid GB business', () => {
    const result = validateBusinessDetails({
      isBusiness: true,
      businessName: 'Acme Ltd',
      country: 'GB',
      taxId: 'GB123456789',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.taxIdType).toBe('gb_vat')
    }
  })

  it('trims and uppercases taxId', () => {
    const result = validateBusinessDetails({
      isBusiness: true,
      businessName: 'Nordic AB',
      country: 'SE',
      taxId: '  se556677889001  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.taxId).toBe('SE556677889001')
    }
  })

  it('rejects missing businessName when isBusiness is true', () => {
    const result = validateBusinessDetails({
      isBusiness: true,
      businessName: '',
      country: 'SE',
      taxId: 'SE556677889001',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing taxId when isBusiness is true', () => {
    const result = validateBusinessDetails({
      isBusiness: true,
      businessName: 'Nordic AB',
      country: 'SE',
      taxId: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects unsupported country', () => {
    const result = validateBusinessDetails({
      isBusiness: true,
      businessName: 'Test Co',
      country: 'JP',
      taxId: 'JP123456789',
    })
    expect(result.success).toBe(false)
  })

  it('rejects malformed VAT for the region', () => {
    const result = validateBusinessDetails({
      isBusiness: true,
      businessName: 'Acme GmbH',
      country: 'DE',
      taxId: 'DE12',
    })
    expect(result.success).toBe(false)
  })

  it('ignores business fields when isBusiness is false', () => {
    const result = validateBusinessDetails({
      isBusiness: false,
      businessName: '',
      country: 'DE',
      taxId: 'invalid',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.isBusiness).toBe(false)
      expect(result.data.businessName).toBeUndefined()
      expect(result.data.country).toBeUndefined()
      expect(result.data.taxId).toBeUndefined()
    }
  })
})

describe('tax id field helpers', () => {
  it('returns VAT-aware labels', () => {
    expect(getTaxIdFieldLabel('SE')).toBe('VAT ID')
    expect(getTaxIdFieldLabel('GB')).toBe('VAT Number')
    expect(getTaxIdFieldLabel('US')).toContain('EIN')
  })

  it('uses EL prefix for Greece examples', () => {
    expect(getTaxIdExample('GR')).toBe('EL123456789')
  })

  it('provides examples that pass validation for every supported country', () => {
    for (const country of SUPPORTED_BUSINESS_COUNTRIES) {
      const example = getTaxIdExample(country)
      const result = validateBusinessDetails({
        isBusiness: true,
        businessName: 'Example Co',
        country,
        taxId: example,
      })
      expect(result.success, `expected ${country} example ${example} to validate`).toBe(true)
    }
  })

  it('includes the example in helper text', () => {
    expect(getTaxIdHelperText('SE')).toContain('SE123456789123')
  })
})

describe('BusinessDetailsSchema', () => {
  it('exports supported countries aligned with tax id types', () => {
    expect(SUPPORTED_BUSINESS_COUNTRIES.length).toBeGreaterThan(0)
    for (const country of SUPPORTED_BUSINESS_COUNTRIES) {
      expect(COUNTRY_TO_TAX_ID_TYPE[country]).toBeDefined()
    }
  })
})
