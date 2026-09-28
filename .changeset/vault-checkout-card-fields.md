---
"@solvapay/react": minor
"@solvapay/server": minor
"@solvapay/next": minor
"@solvapay/mcp-core": minor
---

Vault checkout. When the backend creates a payment intent with `captureMode: 'vault'`, `PaymentForm` and `TopupForm` render `CardFields` (VGS Collect hosted inputs, themed from the same `appearance` / `--solvapay-*` tokens as Stripe Elements, with labels, brand icon and inline validation) instead of `PaymentElement`, and confirm server-side through the new `createCaptureGrant` / `confirmPayment` transport methods. Stripe.js is not loaded in that mode. `@solvapay/server` gains `createCaptureGrantCore` / `confirmPaymentCore` and the matching client methods; `@solvapay/next` exports `createCaptureGrant` / `confirmPayment` route helpers; the MCP server registers `create_capture_grant` and `confirm_payment`. `PaymentIntentResult` now carries `id`, `captureMode` and `vault`, with `clientSecret` / `publishableKey` optional; `onSuccess` receives a `SucceededPayment` (Stripe `PaymentIntent` or the backend's `ConfirmedPayment`).
