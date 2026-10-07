/**
 * Resuming a payment after a 3DS return.
 *
 * When the server-side confirm answers `requires_action` and the browser
 * navigates to `redirectUrl` itself, the form first tags the return URL
 * with the SolvaPay payment id (`solvapay_payment`) and keeps the rail
 * reference the backend reconciles on in `sessionStorage`. The rail brings
 * the payer back to that URL; the form reads the tag, takes the record and
 * reconciles that payment through the backend without creating another.
 * The tag and whatever the rail appended are then stripped so a refresh
 * does not resume twice.
 */

export const PAYMENT_RETURN_PARAM = 'solvapay_payment'

/** Params the rail may append on the way back; stripped with ours. */
const RAIL_RETURN_PARAMS = [
  'redirect_status',
  'payment_intent',
  'payment_intent_client_secret',
] as const

const STORAGE_PREFIX = 'solvapay:payment-return:'

export interface PaymentReturn {
  /** SolvaPay payment intent id. */
  paymentIntentId: string
}

export interface PaymentReturnRecord extends PaymentReturn {
  /** The rail reference the backend's process route reconciles on. */
  processorPaymentId: string
}

/** `href` with the payment return param set (replacing any previous one). */
export function buildPaymentReturnUrl(href: string, resume: PaymentReturn): string {
  const url = new URL(href)
  url.searchParams.set(PAYMENT_RETURN_PARAM, resume.paymentIntentId)
  return url.toString()
}

/** Read the payment return param from a query string, when present. */
export function readPaymentReturn(search: string): PaymentReturn | undefined {
  const paymentIntentId = new URLSearchParams(search).get(PAYMENT_RETURN_PARAM)
  return paymentIntentId ? { paymentIntentId } : undefined
}

function storage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.sessionStorage
  } catch {
    // Storage access can throw (sandboxed frame, disabled storage): a
    // return then has no record and resolves to the unresolved copy.
    return undefined
  }
}

/** Keep the payment the browser is about to leave for, so the return can reconcile it. */
export function rememberPaymentReturn(record: PaymentReturnRecord): void {
  storage()?.setItem(
    `${STORAGE_PREFIX}${record.paymentIntentId}`,
    JSON.stringify({ processorPaymentId: record.processorPaymentId }),
  )
}

/** Read and clear the record for a returned payment; `undefined` when none was kept. */
export function takePaymentReturn(paymentIntentId: string): PaymentReturnRecord | undefined {
  const store = storage()
  if (!store) return undefined
  const key = `${STORAGE_PREFIX}${paymentIntentId}`
  const raw = store.getItem(key)
  if (raw === null) return undefined
  store.removeItem(key)
  try {
    const parsed = JSON.parse(raw) as { processorPaymentId?: unknown }
    if (typeof parsed.processorPaymentId !== 'string' || !parsed.processorPaymentId) {
      return undefined
    }
    return { paymentIntentId, processorPaymentId: parsed.processorPaymentId }
  } catch {
    return undefined
  }
}

/** `href` without the payment return param (and the rail's own return params). */
export function withoutPaymentReturnParams(href: string): string {
  const url = new URL(href)
  for (const param of [PAYMENT_RETURN_PARAM, ...RAIL_RETURN_PARAMS]) {
    url.searchParams.delete(param)
  }
  return url.toString()
}

/** Remove the return params from the current URL without reloading. No-op outside the browser. */
export function stripPaymentReturnParams(): void {
  if (typeof window === 'undefined') return
  const next = new URL(withoutPaymentReturnParams(window.location.href))
  const current = new URL(window.location.href)
  if (next.search === current.search) return
  window.history.replaceState({}, '', `${next.pathname}${next.search}${next.hash}`)
}
