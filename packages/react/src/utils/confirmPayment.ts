import type {
  Stripe,
  StripeElements,
  PaymentIntent,
  StripePaymentElement,
  StripeCardElement,
} from '@stripe/stripe-js'
import type { SolvaPayCopy } from '../i18n/types'
import { interpolate } from '../i18n/interpolate'
import type { CaptureGrant, ConfirmedPayment } from '../types'
import type { CapturedCard } from '../vault/collect'
import { CardCaptureError } from '../vault/collect'

/**
 * @deprecated `'card-element'` is slated for removal in the next major.
 * Use `'payment-element'` with `PaymentForm.PaymentElement`.
 */
export type ConfirmPaymentMode = 'payment-element' | 'card-element'

export type ConfirmBillingDetails = {
  email?: string
  name?: string
  address?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postal_code?: string
    country?: string
  }
}

export function buildConfirmBillingDetails(input: {
  email?: string
  name?: string
  country?: string
  state?: string
  postalCode?: string
}): ConfirmBillingDetails | undefined {
  const name = input.name?.trim()
  const email = input.email?.trim()
  const country = input.country?.trim()
  if (!name && !email && !country) return undefined

  return {
    ...(name && { name }),
    ...(email && { email }),
    ...(country && {
      address: {
        line1: '',
        line2: '',
        city: '',
        state: input.state?.trim() ?? '',
        postal_code: input.postalCode?.trim() ?? '',
        country,
      },
    }),
  }
}

export type ConfirmPaymentInput = {
  stripe: Stripe
  elements: StripeElements
  clientSecret: string
  /**
   * @deprecated `'card-element'` is slated for removal in the next major.
   * Defaults to `'payment-element'`.
   */
  mode?: ConfirmPaymentMode
  returnUrl: string
  /** Billing details from `useCustomer()` plus the SolvaPay-owned address. */
  billingDetails?: ConfirmBillingDetails
  /**
   * When true, skip the browser redirect during PaymentElement confirmation
   * and resolve only if the intent finishes synchronously. This is what
   * SolvaPay's inline forms want so `onSuccess` fires in the same tab.
   */
  redirectIfRequired?: boolean
  /** Copy bundle for human-readable status messages. */
  copy: SolvaPayCopy
}

export type ConfirmPaymentResult =
  | { status: 'succeeded'; paymentIntent: PaymentIntent }
  | { status: 'pending'; message: string; paymentIntent: PaymentIntent }
  | { status: 'requires_action'; message: string }
  | { status: 'other'; message: string; paymentIntent?: PaymentIntent }
  | { status: 'error'; message: string }

/**
 * Wrap Stripe confirmation so callers don't have to branch between
 * `confirmPayment` (PaymentElement) and `confirmCardPayment` (CardElement).
 */
export async function confirmPayment(
  input: ConfirmPaymentInput,
): Promise<ConfirmPaymentResult> {
  const { stripe, elements, clientSecret, returnUrl, billingDetails, copy } = input
  const mode = input.mode ?? 'payment-element'

  try {
    if (mode === 'payment-element') {
      const paymentElement = elements.getElement('payment') as StripePaymentElement | null
      if (!paymentElement) {
        return { status: 'error', message: copy.errors.paymentElementMissing }
      }

      const { error: submitError } = await elements.submit()
      if (submitError) {
        return {
          status: 'error',
          message: submitError.message || copy.errors.paymentUnexpected,
        }
      }

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: {
          return_url: returnUrl,
          payment_method_data: billingDetails
            ? { billing_details: billingDetails }
            : undefined,
        },
        redirect: 'if_required',
      })

      if (error) {
        return { status: 'error', message: error.message || copy.errors.paymentUnexpected }
      }
      return mapIntent(paymentIntent, copy)
    }

    const cardElement = elements.getElement('card') as StripeCardElement | null
    if (!cardElement) {
      return { status: 'error', message: copy.errors.cardElementMissing }
    }

    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: cardElement,
        billing_details: billingDetails,
      },
    })

    if (error) {
      return { status: 'error', message: error.message || copy.errors.paymentUnexpected }
    }
    return mapIntent(paymentIntent, copy)
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : copy.errors.paymentUnexpected,
    }
  }
}

function mapIntent(
  paymentIntent: PaymentIntent | undefined,
  copy: SolvaPayCopy,
): ConfirmPaymentResult {
  if (!paymentIntent) {
    return { status: 'error', message: copy.errors.paymentUnexpected }
  }
  if (paymentIntent.status === 'succeeded') {
    return { status: 'succeeded', paymentIntent }
  }
  if (paymentIntent.status === 'processing') {
    return {
      status: 'pending',
      message: copy.errors.paymentPending,
      paymentIntent,
    }
  }
  if (paymentIntent.status === 'requires_action') {
    return { status: 'requires_action', message: copy.errors.paymentRequires3ds }
  }
  return {
    status: 'other',
    message: interpolate(copy.errors.paymentStatusPrefix, {
      status: paymentIntent.status,
    }),
    paymentIntent,
  }
}

// ---------- Vault checkout ----------

export type ConfirmVaultPaymentInput = {
  /** SolvaPay payment intent id (`captureMode: 'vault'`). */
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
 * Vault-mode confirm: grant → capture the card into the vault → confirm
 * server-side. Stripe.js is never involved; the backend makes the rail
 * charge and reports where the payer must go if 3DS is required.
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
