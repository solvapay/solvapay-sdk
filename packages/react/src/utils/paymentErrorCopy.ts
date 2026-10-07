/**
 * Payer copy for the vault routes' keyed refusals.
 *
 * The backend answers every refusal of a capture grant, a confirm or a card
 * save with a keyed body; the transports carry the key on `TransportError`
 * (`code`, with `reason` and `declineCode` on a 402). This is the one table
 * that turns a key into copy, the same keys and copy as the hosted checkout.
 * Message text is never matched.
 */

import type { SolvaPayCopy } from '../i18n/types'
import { TransportError } from '../transport/errors'

/** The `error` keys of the vault routes' bodies. */
export const PAYMENT_ERROR_CODES = {
  paymentDeclined: 'payment_declined',
  captureGrantExhausted: 'capture_grant_exhausted',
  cardNotInGrantWindow: 'card_not_in_grant_window',
  cardAlreadyUsed: 'card_already_used',
  railCredentialRejected: 'rail_credential_rejected',
  confirmInProgress: 'confirm_in_progress',
  checkoutSessionUnavailable: 'checkout_session_unavailable',
  railOutcomeUnknown: 'rail_outcome_unknown',
  cardPostSaveFailed: 'card_post_save_failed',
  cardNotFound: 'card_not_found',
} as const

export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[keyof typeof PAYMENT_ERROR_CODES]

const CODE_COPY: Record<
  Exclude<PaymentErrorCode, 'payment_declined'>,
  keyof Omit<SolvaPayCopy['vaultErrors'], 'declineCodes' | 'reasons' | 'paymentDeclined'>
> = {
  capture_grant_exhausted: 'captureGrantExhausted',
  card_not_in_grant_window: 'cardNotInGrantWindow',
  card_already_used: 'cardAlreadyUsed',
  rail_credential_rejected: 'railCredentialRejected',
  confirm_in_progress: 'confirmInProgress',
  checkout_session_unavailable: 'checkoutSessionUnavailable',
  rail_outcome_unknown: 'railOutcomeUnknown',
  card_post_save_failed: 'cardPostSaveFailed',
  card_not_found: 'cardNotFound',
}

const DECLINE_CODE_COPY: Record<string, keyof SolvaPayCopy['vaultErrors']['declineCodes']> = {
  insufficient_funds: 'insufficientFunds',
  expired_card: 'expiredCard',
  incorrect_cvc: 'incorrectCvc',
  incorrect_number: 'incorrectNumber',
  authentication_required: 'authenticationRequired',
}

const REASON_COPY: Record<string, keyof SolvaPayCopy['vaultErrors']['reasons']> = {
  authentication_required: 'authenticationRequired',
  authentication_failed: 'authenticationFailed',
  processing_error: 'processingError',
}

/** Copy for a 402: the decline code's, else the reason's, else the plain decline. */
export function declineMessage(
  error: { declineCode?: string; reason?: string },
  copy: SolvaPayCopy,
): string {
  const byCode = error.declineCode ? DECLINE_CODE_COPY[error.declineCode] : undefined
  if (byCode) return copy.vaultErrors.declineCodes[byCode]
  const byReason = error.reason ? REASON_COPY[error.reason] : undefined
  if (byReason) return copy.vaultErrors.reasons[byReason]
  return copy.vaultErrors.paymentDeclined
}

/**
 * The payer's copy for a keyed refusal; `undefined` for any other failure
 * (an unkeyed message is written for the integrator, not the payer).
 */
export function paymentErrorMessage(error: unknown, copy: SolvaPayCopy): string | undefined {
  if (!(error instanceof TransportError) || !error.code) return undefined
  if (error.code === PAYMENT_ERROR_CODES.paymentDeclined) return declineMessage(error, copy)
  const key = CODE_COPY[error.code as keyof typeof CODE_COPY]
  return key ? copy.vaultErrors[key] : undefined
}

/**
 * What the form shows for a failed grant, capture, confirm or save: the
 * keyed copy, else the error's own message, else `fallback`.
 */
export function paymentFailureMessage(
  error: unknown,
  copy: SolvaPayCopy,
  fallback: string,
): string {
  const keyed = paymentErrorMessage(error, copy)
  if (keyed) return keyed
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/** The backend's error key on a failure, when it answered one. */
export function paymentErrorCode(error: unknown): string | undefined {
  return error instanceof TransportError ? error.code : undefined
}
