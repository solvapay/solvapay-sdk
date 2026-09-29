/**
 * SolvaPay's canonical test cards (design doc, section 8), for SDK tests and
 * sandbox integrations. The platform's catalogue (`@platform/connector-kit`,
 * `testing.ts`) is the source; `test-cards.test.ts` pins every number.
 *
 * A number names a product by its first eight digits and a scenario by the
 * three digits before the Luhn check digit. They work in sandbox only, and
 * whatever rail runs behind SolvaPay.
 */

export const TEST_CARD_PRODUCTS = {
  visa: { first8: '41115700', length: 16 },
  visaDebit: { first8: '41115800', length: 16 },
  visaPrepaid: { first8: '41115900', length: 16 },
  mastercard: { first8: '54545700', length: 16 },
  mastercardDebit: { first8: '54545800', length: 16 },
  amex: { first8: '37825700', length: 15 },
} as const

export const TEST_CARD_SCENARIO_CODES = {
  success: '001',
  declineGeneric: '101',
  declineInsufficientFunds: '102',
  declineLostCard: '103',
  declineStolenCard: '104',
  declineExpired: '105',
  declineCvc: '106',
  processingError: '107',
  declineVelocity: '108',
  savesThenDeclines: '109',
  riskBlocked: '201',
  riskHighest: '202',
  riskElevated: '203',
  cvcCheckFails: '204',
  postalCheckFails: '205',
  scaRequired: '301',
  scaFails: '302',
  scaFrictionless: '303',
  scaOnSetupOnly: '304',
  disputeFraud: '401',
  disputeNotReceived: '402',
  disputeInquiry: '403',
  earlyFraudWarning: '404',
  refundFails: '451',
  asyncSuccess: '501',
  indeterminate: '502',
  railTimeout: '503',
  cardUpdated: '601',
  cardExpiryUpdated: '602',
  cardClosed: '603',
  tokenSuspended: '604',
  tokenProvisionFailed: '605',
  contactCardholder: '606',
} as const

export type TestCardProduct = keyof typeof TEST_CARD_PRODUCTS
export type TestCardScenario = keyof typeof TEST_CARD_SCENARIO_CODES

/** Luhn check digit for the digits before it. */
export function luhnCheckDigit(digits: string): string {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 0) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return String((10 - (sum % 10)) % 10)
}

/** The SolvaPay test card number for a product and scenario, without spaces. */
export function testCardNumber(product: TestCardProduct, scenario: TestCardScenario): string {
  const p = TEST_CARD_PRODUCTS[product]
  const body = p.first8 + '0'.repeat(p.length - 12) + TEST_CARD_SCENARIO_CODES[scenario]
  return body + luhnCheckDigit(body)
}

/** `testCards.visa.declineInsufficientFunds` → `'4111570000001024'`. */
export const testCards = Object.fromEntries(
  (Object.keys(TEST_CARD_PRODUCTS) as TestCardProduct[]).map(product => [
    product,
    Object.fromEntries(
      (Object.keys(TEST_CARD_SCENARIO_CODES) as TestCardScenario[]).map(scenario => [
        scenario,
        testCardNumber(product, scenario),
      ]),
    ),
  ]),
) as { [P in TestCardProduct]: { [S in TestCardScenario]: string } }

/** Named test payment methods for server-side sandbox tests, e.g. `spm_test_decline_insufficient_funds`. */
export function testPaymentMethod(scenario: TestCardScenario): string {
  return `spm_test_${scenario.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)}`
}
