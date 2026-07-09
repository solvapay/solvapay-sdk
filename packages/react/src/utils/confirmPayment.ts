import type {
  Stripe,
  StripeElements,
  PaymentIntent,
  StripePaymentElement,
  StripeCardElement,
} from '@stripe/stripe-js'
import type { SolvaPayCopy } from '../i18n/types'
import { interpolate } from '../i18n/interpolate'

/**
 * @deprecated `'card-element'` is slated for removal in the next major.
 * Use `'payment-element'` with `PaymentForm.PaymentElement`.
 */
export type ConfirmPaymentMode = 'payment-element' | 'card-element'

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
  /** Billing details from `useCustomer()` (echoed from backend). */
  billingDetails?: { email?: string; name?: string }
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
export async function confirmPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentResult> {
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
          payment_method_data: billingDetails ? { billing_details: billingDetails } : undefined,
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
