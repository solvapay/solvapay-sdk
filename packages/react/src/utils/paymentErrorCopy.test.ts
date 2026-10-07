import { describe, it, expect } from 'vitest'
import { enCopy } from '../i18n/en'
import { TransportError } from '../transport/errors'
import {
  PAYMENT_ERROR_CODES,
  declineMessage,
  paymentErrorCode,
  paymentErrorMessage,
  paymentFailureMessage,
} from './paymentErrorCopy'

describe('paymentErrorCopy', () => {
  it('has copy for every vault error key', () => {
    for (const code of Object.values(PAYMENT_ERROR_CODES)) {
      const message = paymentErrorMessage(new TransportError('x', { code }), enCopy)
      expect(message, code).toBeTruthy()
      expect(message, code).not.toContain('_')
    }
  })

  it('maps each key to the hosted checkout copy', () => {
    const copyFor = (code: string) => paymentErrorMessage(new TransportError('x', { code }), enCopy)
    expect(copyFor('capture_grant_exhausted')).toBe(enCopy.vaultErrors.captureGrantExhausted)
    expect(copyFor('card_not_in_grant_window')).toBe(enCopy.vaultErrors.cardNotInGrantWindow)
    expect(copyFor('card_already_used')).toBe(enCopy.vaultErrors.cardAlreadyUsed)
    expect(copyFor('rail_credential_rejected')).toBe(enCopy.vaultErrors.railCredentialRejected)
    expect(copyFor('confirm_in_progress')).toBe(enCopy.vaultErrors.confirmInProgress)
    expect(copyFor('checkout_session_unavailable')).toBe(
      enCopy.vaultErrors.checkoutSessionUnavailable,
    )
    expect(copyFor('rail_outcome_unknown')).toBe(enCopy.vaultErrors.railOutcomeUnknown)
    expect(copyFor('card_post_save_failed')).toBe(enCopy.vaultErrors.cardPostSaveFailed)
    expect(copyFor('card_not_found')).toBe(enCopy.vaultErrors.cardNotFound)
  })

  it('picks the decline copy by decline code, then by reason, then the plain decline', () => {
    expect(
      declineMessage({ declineCode: 'insufficient_funds', reason: 'card_declined' }, enCopy),
    ).toBe(enCopy.vaultErrors.declineCodes.insufficientFunds)
    expect(declineMessage({ declineCode: 'authentication_required' }, enCopy)).toBe(
      enCopy.vaultErrors.declineCodes.authenticationRequired,
    )
    expect(declineMessage({ reason: 'authentication_failed' }, enCopy)).toBe(
      enCopy.vaultErrors.reasons.authenticationFailed,
    )
    expect(declineMessage({ reason: 'processing_error' }, enCopy)).toBe(
      enCopy.vaultErrors.reasons.processingError,
    )
    expect(declineMessage({ declineCode: 'lost_card', reason: 'card_declined' }, enCopy)).toBe(
      enCopy.vaultErrors.paymentDeclined,
    )
    expect(declineMessage({}, enCopy)).toBe(enCopy.vaultErrors.paymentDeclined)
    expect(
      paymentErrorMessage(
        new TransportError('x', { code: 'payment_declined', declineCode: 'expired_card' }),
        enCopy,
      ),
    ).toBe(enCopy.vaultErrors.declineCodes.expiredCard)
  })

  it('gives no copy for an unkeyed or unknown error, and never matches message text', () => {
    expect(paymentErrorMessage(new Error('payment_declined'), enCopy)).toBeUndefined()
    expect(paymentErrorMessage(new TransportError('payment_declined'), enCopy)).toBeUndefined()
    expect(
      paymentErrorMessage(new TransportError('x', { code: 'unknown_key' }), enCopy),
    ).toBeUndefined()
    expect(paymentErrorMessage('nope', enCopy)).toBeUndefined()
  })

  it('falls back to the message, then the given copy, for an unkeyed failure', () => {
    expect(paymentFailureMessage(new Error('Grant limit reached'), enCopy, 'fallback')).toBe(
      'Grant limit reached',
    )
    expect(paymentFailureMessage(new Error(''), enCopy, 'fallback')).toBe('fallback')
    expect(paymentFailureMessage('nope', enCopy, 'fallback')).toBe('fallback')
    expect(
      paymentFailureMessage(
        new TransportError('raw', { code: 'card_not_found' }),
        enCopy,
        'fallback',
      ),
    ).toBe(enCopy.vaultErrors.cardNotFound)
  })

  it('exposes the key of a keyed failure', () => {
    expect(paymentErrorCode(new TransportError('x', { code: 'confirm_in_progress' }))).toBe(
      'confirm_in_progress',
    )
    expect(paymentErrorCode(new Error('x'))).toBeUndefined()
  })
})
