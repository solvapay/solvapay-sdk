/**
 * The page the rail sends the payer back to after a customer action (3DS)
 * started from the MCP widget.
 *
 * The widget runs in the host's iframe and opens the bank's page through
 * the host (`ui/open-link`); it stays mounted and follows the payment
 * through the backend meanwhile. The payer lands here when the bank is
 * done, and this page only tells them to go back to the chat. Nothing is
 * confirmed or read here: the backend already has the outcome and the
 * widget picks it up.
 *
 * The backend accepts a return URL only on the origin of the provider's
 * website registered in the SolvaPay console (or the hosted pages). The
 * MCP server's `publicBaseUrl` must therefore share that origin, or every
 * confirm answers 400.
 */

import { withoutTrailingSlash } from './oauth-discovery'

/** The route the MCP app shell serves the return page on. */
export const PAYMENT_RETURN_PATH = '/solvapay/payment-return'

/** The return URL the widget's confirms carry: the return page under `publicBaseUrl`. */
export function paymentReturnUrl(publicBaseUrl: string): string {
  return `${withoutTrailingSlash(publicBaseUrl)}${PAYMENT_RETURN_PATH}`
}

export interface PaymentReturnPageOptions {
  /** Name shown in the page title and heading; defaults to SolvaPay. */
  brandName?: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The static HTML of the return page. */
export function renderPaymentReturnPage(options: PaymentReturnPageOptions = {}): string {
  const brand = escapeHtml(options.brandName ?? 'SolvaPay')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${brand}: authentication complete</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f6f7f9; color: #111827; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  main { max-width: 28rem; padding: 2rem; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
  p { margin: 0 0 .5rem; line-height: 1.5; color: #374151; }
</style>
</head>
<body>
<main>
<h1>Authentication complete</h1>
<p>Your bank has finished checking this payment. Go back to the chat to see the result; this window can be closed.</p>
<p>${brand} does not charge you again.</p>
</main>
</body>
</html>
`
}

/** `GET` on {@link PAYMENT_RETURN_PATH}: the return page as a `Response`. */
export function paymentReturnResponse(options: PaymentReturnPageOptions = {}): Response {
  return new Response(renderPaymentReturnPage(options), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  })
}

/** Whether `pathname` is the return page's route (with or without a trailing slash). */
export function isPaymentReturnPath(pathname: string): boolean {
  return pathname === PAYMENT_RETURN_PATH || pathname === `${PAYMENT_RETURN_PATH}/`
}
