import { describe, expect, it } from 'vitest'
import {
  BusinessDetailsSchema,
  BUSINESS_COUNTRY_DISPLAY_NAMES,
  BUSINESS_COUNTRY_OPTIONS,
  COUNTRY_TO_TAX_ID_TYPE,
  SUPPORTED_BUSINESS_COUNTRIES,
  deriveTaxIdType,
  getTaxIdExample,
  getTaxIdFieldLabel,
  getTaxIdHelperText,
  resolveTaxBehavior,
  validateBusinessDetails,
} from './business-details'

describe('BUSINESS_COUNTRY_OPTIONS', () => {
  it('provides a non-empty label for every supported country', () => {
    for (const country of SUPPORTED_BUSINESS_COUNTRIES) {
      expect(BUSINESS_COUNTRY_DISPLAY_NAMES[country].trim().length).toBeGreaterThan(0)
    }

    expect(BUSINESS_COUNTRY_OPTIONS).toHaveLength(SUPPORTED_BUSINESS_COUNTRIES.length)
    for (const option of BUSINESS_COUNTRY_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0)
      expect(option.value).toBeDefined()
    }
  })

  it('sorts options alphabetically by label', () => {
    const labels = BUSINESS_COUNTRY_OPTIONS.map(option => option.label)
    const sortedLabels = [...labels].sort((a, b) => a.localeCompare(b))
    expect(labels).toEqual(sortedLabels)
  })

  it('uses Stripe-aligned English labels', () => {
    expect(BUSINESS_COUNTRY_DISPLAY_NAMES.DE).toBe('Germany')
    expect(BUSINESS_COUNTRY_DISPLAY_NAMES.US).toBe('United States of America')
    expect(BUSINESS_COUNTRY_DISPLAY_NAMES.GB).toBe('United Kingdom')
    expect(BUSINESS_COUNTRY_DISPLAY_NAMES.CZ).toBe('Czechia')
  })
})

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
    if (result.success && result.data.isBusiness) {
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
    if (result.success && result.data.isBusiness) {
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
    if (result.success && result.data.isBusiness) {
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
    if (result.success && result.data.isBusiness) {
      expect(result.data.taxId).toBe('SE556677889001')
    }
  })

  it('accepts business purchase with country only', () => {
    const result = validateBusinessDetails({
      isBusiness: true,
      country: 'SE',
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.isBusiness) {
      expect(result.data.country).toBe('SE')
      expect(result.data.businessName).toBeUndefined()
      expect(result.data.taxId).toBeUndefined()
    }
  })

  it('includes customerName on the non-business branch when provided', () => {
    const result = validateBusinessDetails({
      isBusiness: false,
      customerCountry: 'SE',
      customerName: 'Jane Doe',
    })
    expect(result.success).toBe(true)
    if (result.success && !result.data.isBusiness) {
      expect(result.data.customerName).toBe('Jane Doe')
    }
  })

  it('rejects invalid tax ID format when tax ID is provided', () => {
    const result = validateBusinessDetails({
      isBusiness: true,
      country: 'DE',
      taxId: 'DE12',
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
    if (result.success && !result.data.isBusiness) {
      expect(result.data).toEqual({ isBusiness: false })
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

describe('resolveTaxBehavior', () => {
  it('resolves auto to exclusive for USD and CAD', () => {
    expect(resolveTaxBehavior('auto', 'USD')).toBe('exclusive')
    expect(resolveTaxBehavior('auto', 'CAD')).toBe('exclusive')
    expect(resolveTaxBehavior('auto', 'usd')).toBe('exclusive')
    expect(resolveTaxBehavior('auto', 'cad')).toBe('exclusive')
  })

  it('resolves auto to inclusive for other currencies', () => {
    expect(resolveTaxBehavior('auto', 'EUR')).toBe('inclusive')
    expect(resolveTaxBehavior('auto', 'SEK')).toBe('inclusive')
    expect(resolveTaxBehavior('auto', 'GBP')).toBe('inclusive')
    expect(resolveTaxBehavior('auto', 'eur')).toBe('inclusive')
  })

  it('passes through explicit inclusive and exclusive values', () => {
    expect(resolveTaxBehavior('inclusive', 'USD')).toBe('inclusive')
    expect(resolveTaxBehavior('exclusive', 'EUR')).toBe('exclusive')
  })
})

describe('BusinessDetailsSchema', () => {
  it('exports supported countries aligned with tax id types', () => {
    expect(SUPPORTED_BUSINESS_COUNTRIES.length).toBeGreaterThan(0)
    for (const country of SUPPORTED_BUSINESS_COUNTRIES) {
      expect(COUNTRY_TO_TAX_ID_TYPE[country]).toBeDefined()
    }
  })

  it('preserves customerCountry on the non-business branch', () => {
    const result = BusinessDetailsSchema.parse({
      isBusiness: false,
      customerCountry: 'se',
    })

    expect(result).toEqual({ isBusiness: false, customerCountry: 'SE' })
  })

  it('rejects unsupported customerCountry for non-business purchases', () => {
    const result = validateBusinessDetails({
      isBusiness: false,
      customerCountry: 'ZZ',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['customerCountry'],
          }),
        ]),
      )
    }
  })
})
