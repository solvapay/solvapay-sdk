import type { SolvaPayCopy } from '../i18n/types'
import { interpolate } from '../i18n/interpolate'
import type { CaptureGrant, ConfirmedPayment } from '../types'
import type { CapturedCard } from '../vault/collect'
import { CardCaptureError } from '../vault/collect'

// ---------- Vault checkout ----------

export type ConfirmVaultPaymentInput = {
  /** SolvaPay payment intent id. */
  paymentIntentId: string
  /** Writes the entered card into the vault under a grant — registered by `PaymentForm.CardFields`. */
  capture: (grant: CaptureGrant) => Promise<CapturedCard>
  createCaptureGrant: (params: { paymentIntentId: string }) => Promise<CaptureGrant>
  confirmPayment: (params: {
    paymentIntentId: string
    cardId?: string
    paymentMethodId?: string
    returnUrl?: string
  }) => Promise<ConfirmedPayment>
  /** Pay with a saved entry instead of capturing a card. Skips the grant and capture. */
  paymentMethodId?: string
  returnUrl: string
  copy: SolvaPayCopy
}

export type ConfirmVaultPaymentResult =
  | { status: 'succeeded'; payment: ConfirmedPayment }
  | { status: 'pending'; message: string; payment: ConfirmedPayment }
  | { status: 'requires_action'; message: string; redirectUrl: string; payment: ConfirmedPayment }
  | { status: 'other'; message: string; payment: ConfirmedPayment }
  | { status: 'error'; message: string }

/**
 * Grant → capture the card into the vault → confirm server-side. The
 * backend makes the rail charge and reports where the payer must go if
 * 3DS is required.
 */
export async function confirmVaultPayment(
  input: ConfirmVaultPaymentInput,
): Promise<ConfirmVaultPaymentResult> {
  const { paymentIntentId, capture, createCaptureGrant, confirmPayment: confirm, returnUrl, copy } =
    input
  try {
    let cardId: string | undefined
    if (!input.paymentMethodId) {
      const grant = await createCaptureGrant({ paymentIntentId })
      const card = await capture(grant)
      cardId = card.cardId
    }
    const payment = await confirm({
      paymentIntentId,
      ...(cardId ? { cardId } : { paymentMethodId: input.paymentMethodId }),
      returnUrl,
    })
    return mapConfirmedPayment(payment, copy)
  } catch (err) {
    if (err instanceof CardCaptureError) {
      return { status: 'error', message: copy.errors.cardCaptureFailed }
    }
    return {
      status: 'error',
      message: err instanceof Error ? err.message : copy.errors.paymentUnexpected,
    }
  }
}

function mapConfirmedPayment(
  payment: ConfirmedPayment | undefined,
  copy: SolvaPayCopy,
): ConfirmVaultPaymentResult {
  if (!payment || typeof payment.processorPaymentId !== 'string') {
    return { status: 'error', message: copy.errors.paymentUnexpected }
  }
  if (payment.redirectUrl && payment.status === 'requires_action') {
    return {
      status: 'requires_action',
      message: copy.errors.paymentRequires3ds,
      redirectUrl: payment.redirectUrl,
      payment,
    }
  }
  if (payment.status === 'requires_action') {
    return { status: 'error', message: copy.errors.authenticationUnavailable }
  }
  if (payment.status === 'succeeded') return { status: 'succeeded', payment }
  if (payment.status === 'processing' || payment.status === 'pending') {
    return { status: 'pending', message: copy.errors.paymentPending, payment }
  }
  if (payment.status === 'failed' || payment.status === 'requires_payment_method') {
    return { status: 'error', message: copy.errors.paymentProcessingFailed }
  }
  return {
    status: 'other',
    message: interpolate(copy.errors.paymentStatusPrefix, { status: payment.status }),
    payment,
  }
}
