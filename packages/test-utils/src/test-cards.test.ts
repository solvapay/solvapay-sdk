import { describe, expect, it } from 'vitest'
import {
  TEST_CARD_PRODUCTS,
  TEST_CARD_SCENARIO_CODES,
  luhnCheckDigit,
  testCardNumber,
  testCards,
  testPaymentMethod,
} from './test-cards'
import { VAULT_TEST_CARDS } from './fake-collect'

const passesLuhn = (n: string) => luhnCheckDigit(n.slice(0, -1)) === n.slice(-1)

describe('SolvaPay test cards', () => {
  it('pins the published numbers', () => {
    expect(testCards.visa.success).toBe('4111570000000018')
    expect(testCards.visa.declineGeneric).toBe('4111570000001016')
    expect(testCards.visa.declineInsufficientFunds).toBe('4111570000001024')
    expect(testCards.visa.scaRequired).toBe('4111570000003012')
    expect(testCards.visa.refundFails).toBe('4111570000004515')
    expect(testCards.visa.contactCardholder).toBe('4111570000006064')
    expect(testCards.visa.railAnswerLost).toBe('4111570000005041')
    expect(testCards.visaDebit.success).toBe('4111580000000017')
    expect(testCards.visaPrepaid.success).toBe('4111590000000016')
    expect(testCards.mastercard.success).toBe('5454570000000010')
    expect(testCards.mastercardDebit.success).toBe('5454580000000019')
    expect(testCards.amex.success).toBe('378257000000018')
  })

  it('has 34 scenarios with distinct codes for each of 6 products', () => {
    expect(Object.keys(TEST_CARD_SCENARIO_CODES)).toHaveLength(34)
    expect(new Set(Object.values(TEST_CARD_SCENARIO_CODES)).size).toBe(34)
    expect(Object.keys(testCards)).toEqual([
      'visa',
      'visaDebit',
      'visaPrepaid',
      'mastercard',
      'mastercardDebit',
      'amex',
    ])
  })

  it('every number passes Luhn, has the product length and prefix, and ends in its scenario code', () => {
    for (const [product, spec] of Object.entries(TEST_CARD_PRODUCTS)) {
      for (const [scenario, code] of Object.entries(TEST_CARD_SCENARIO_CODES)) {
        const number = testCardNumber(product as never, scenario as never)
        expect([product, scenario, passesLuhn(number)]).toEqual([product, scenario, true])
        expect(number).toHaveLength(spec.length)
        expect(number.startsWith(spec.first8)).toBe(true)
        expect(number.slice(-4, -1)).toBe(code)
      }
    }
  })

  it('names server-side test payment methods in the platform form', () => {
    expect(testPaymentMethod('success')).toBe('spm_test_success')
    expect(testPaymentMethod('declineInsufficientFunds')).toBe(
      'spm_test_decline_insufficient_funds',
    )
    expect(testPaymentMethod('scaOnSetupOnly')).toBe('spm_test_sca_on_setup_only')
  })

  it('uses SolvaPay test cards in the fake Collect presets', () => {
    expect(VAULT_TEST_CARDS).toEqual({
      visaSuccess: { number: '4111570000000018', expMonth: 12, expYear: 2030, cvc: '123' },
      visaDeclined: { number: '4111570000001016', expMonth: 12, expYear: 2030, cvc: '123' },
      visaRequires3ds: { number: '4111570000003012', expMonth: 12, expYear: 2030, cvc: '123' },
    })
  })
})
