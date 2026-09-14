import { describe, expect, it } from 'vitest'
import { normaliseVendorState, toCaptureError, toCredential } from './captureForm'
import { CaptureError, emptyCaptureState, isComplete, isReady, isSessionUsable } from './types'

const vendorField = (over: Record<string, unknown> = {}) => ({
  isValid: true,
  isDirty: true,
  isTouched: true,
  isFocused: false,
  ...over,
})

describe('normaliseVendorState', () => {
  it('maps vendor field names onto ours and nothing else', () => {
    const next = normaliseVendorState(emptyCaptureState(), {
      card_number: vendorField({ cardType: 'VISA', last4: '4242' }),
      unrelated_field: vendorField(),
    })

    expect(next.fields.cardNumber.mounted).toBe(true)
    expect(next.fields.cardNumber.valid).toBe(true)
    expect(next.brand).toBe('visa')
    expect(next.last4).toBe('4242')
    // An unknown vendor key must not invent a field.
    expect(Object.keys(next.fields).sort()).toEqual([
      'cardNumber',
      'cardholderName',
      'cvc',
      'expiry',
    ])
  })

  it('is ready only once every required field has mounted', () => {
    let state = normaliseVendorState(emptyCaptureState(), { card_number: vendorField() })
    expect(state.ready).toBe(false)

    state = normaliseVendorState(state, { card_expirationDate: vendorField() })
    expect(state.ready).toBe(false)

    state = normaliseVendorState(state, { card_cvc: vendorField() })
    expect(state.ready).toBe(true)
    expect(state.complete).toBe(true)
  })

  it('does not require the cardholder name', () => {
    const state = normaliseVendorState(emptyCaptureState(), {
      card_number: vendorField(),
      card_expirationDate: vendorField(),
      card_cvc: vendorField(),
    })
    expect(state.fields.cardholderName.mounted).toBe(false)
    expect(state.complete).toBe(true)
  })

  it('is incomplete while any required field is invalid', () => {
    const state = normaliseVendorState(emptyCaptureState(), {
      card_number: vendorField(),
      card_expirationDate: vendorField(),
      card_cvc: vendorField({ isValid: false, errorMessages: ['is not valid'] }),
    })
    expect(state.ready).toBe(true)
    expect(state.complete).toBe(false)
    expect(state.fields.cvc.message).toBe('is not valid')
  })

  it('keeps a previously detected brand when a later event omits it', () => {
    const first = normaliseVendorState(emptyCaptureState(), {
      card_number: vendorField({ cardType: 'mastercard', last4: '4444' }),
    })
    const second = normaliseVendorState(first, { card_cvc: vendorField() })
    expect(second.brand).toBe('mastercard')
    expect(second.last4).toBe('4444')
  })

  it('reports an unrecognised brand as unknown rather than dropping it', () => {
    const state = normaliseVendorState(emptyCaptureState(), {
      card_number: vendorField({ cardType: 'some-new-scheme' }),
    })
    expect(state.brand).toBe('unknown')
  })
})

describe('toCredential', () => {
  const card = {
    data: {
      id: 'crd_123',
      attributes: {
        pan_alias: 'tok_sandbox_abc',
        cvc_alias: 'tok_sandbox_def',
        exp_month: 12,
        exp_year: 30,
        last4: '4242',
        card_brand: 'VISA',
        card_type: 'debit',
        card_fingerprint: 'fp_abc',
        enriched_attributes: { card_properties: { issuer_country: 'SE' } },
      },
    },
  }

  it('returns a handle and descriptors, and no card data', () => {
    const result = toCredential(card)
    expect(result.handle).toBe('crd_123')
    expect(result.descriptors).toEqual({
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
      funding: 'debit',
      issuerCountry: 'SE',
    })
    expect(JSON.stringify(result)).not.toContain('tok_sandbox')
  })

  it('normalises a two digit expiry year to four', () => {
    expect(toCredential(card).descriptors.expYear).toBe(2030)
  })

  it('leaves a four digit expiry year alone', () => {
    const four = { data: { ...card.data, attributes: { ...card.data.attributes, exp_year: 2031 } } }
    expect(toCredential(four).descriptors.expYear).toBe(2031)
  })

  it('accepts a flat response shape as well as a nested one', () => {
    const flat = { id: 'crd_flat', exp_month: 1, exp_year: 2029, last4: '1111', card_brand: 'amex' }
    const result = toCredential(flat)
    expect(result.handle).toBe('crd_flat')
    expect(result.descriptors.brand).toBe('amex')
  })

  it('throws rather than returning a credential with no identifier', () => {
    expect(() => toCredential({ data: { attributes: { exp_month: 1, exp_year: 30 } } })).toThrow(
      CaptureError,
    )
  })

  it('throws rather than returning a credential with no usable expiry', () => {
    expect(() => toCredential({ data: { id: 'crd_1', attributes: { last4: '4242' } } })).toThrow(
      /expiry/i,
    )
  })
})

describe('toCaptureError', () => {
  it('passes a CaptureError through untouched', () => {
    const original = new CaptureError('incomplete', 'nope')
    expect(toCaptureError(original)).toBe(original)
  })

  it('treats a 4xx as a rejection and a 5xx as a vault error', () => {
    expect(toCaptureError({ status: 422, message: 'bad card' }).code).toBe('rejected')
    expect(toCaptureError({ status: 503, message: 'down' }).code).toBe('vault_error')
  })

  it('keeps the request id, which is what support asks for', () => {
    expect(toCaptureError({ status: 500, requestId: 'req_9' }).requestId).toBe('req_9')
  })

  it('recognises a network failure with no status', () => {
    expect(toCaptureError({ message: 'network request failed' }).code).toBe('network')
  })
})

describe('session and field guards', () => {
  it('treats a session inside its window as usable', () => {
    const now = 1_000_000
    expect(
      isSessionUsable(
        {
          token: 't',
          tenantId: 'v',
          environment: 'sandbox',
          captureSessionId: 'cap_1',
          expiresAt: now + 60_000,
        },
        now,
      ),
    ).toBe(true)
  })

  it('treats an expired session as unusable', () => {
    const now = 1_000_000
    expect(
      isSessionUsable(
        {
          token: 't',
          tenantId: 'v',
          environment: 'sandbox',
          captureSessionId: 'cap_1',
          expiresAt: now - 1,
        },
        now,
      ),
    ).toBe(false)
  })

  it('refuses a session that expires within the slack window', () => {
    const now = 1_000_000
    expect(
      isSessionUsable(
        {
          token: 't',
          tenantId: 'v',
          environment: 'sandbox',
          captureSessionId: 'cap_1',
          expiresAt: now + 500,
        },
        now,
      ),
    ).toBe(false)
  })

  it('agrees with the state helpers', () => {
    const state = emptyCaptureState()
    expect(isReady(state.fields)).toBe(false)
    expect(isComplete(state.fields)).toBe(false)
  })
})

describe('toCredential: leading digits', () => {
  const vaultResponse = (attributes: Record<string, unknown>) => ({
    data: {
      id: 'card_7f3a1c92b4d6',
      attributes: { exp_month: 12, exp_year: 2030, last4: '4242', ...attributes },
    },
  })

  it('ignores the vault bin entirely', () => {
    const credential = toCredential(vaultResponse({ bin: '424242' }))
    expect(JSON.stringify(credential)).not.toContain('424242')
  })

  it('ignores first8 entirely', () => {
    const credential = toCredential(vaultResponse({ first8: '42424242' }))
    expect(JSON.stringify(credential)).not.toContain('42424242')
  })

  it('keeps nothing of the card but the last four', () => {
    const credential = toCredential(
      vaultResponse({ bin: '424242', first8: '42424242', card_fingerprint: 'fp_1' }),
    )
    expect(credential.descriptors.last4).toBe('4242')
    expect(JSON.stringify(credential)).not.toContain('fp_1')
    expect(Object.keys(credential.descriptors).sort()).toEqual([
      'brand',
      'expMonth',
      'expYear',
      'funding',
      'issuerCountry',
      'last4',
    ])
  })
})
