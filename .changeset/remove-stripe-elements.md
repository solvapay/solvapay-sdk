---
'@solvapay/react': major
'@solvapay/server': minor
'@solvapay/next': minor
'@solvapay/mcp-core': minor
'@solvapay/mcp': patch
---

- react (breaking): the Stripe Elements path and the `@stripe/react-stripe-js` / `@stripe/stripe-js` dependencies are removed; `CardFields` is the only card entry (`PaymentForm.PaymentElement` / `CardElement`, `TopupForm.PaymentElement`, `StripePaymentFormWrapper`, `confirmPayment`, `useStripeProbe`, `readPaymentIntentClientSecret`, `publishableKey` props and `clientSecret` / `stripePromise` / `captureMode` hook fields are gone), `appearance` uses the SDK's own `Appearance` type, and `AutoRecharge.CardSetup` saves cards through the vault on a customer session (`createCardSetupGrant` / `saveCard` transport methods), shown when the save returns `requiresPaymentMethod`, with a 3DS redirect and resume.
- server: payment-intent helpers return only `id`, `captureMode: 'vault'`, `vault`, `processorPaymentId` and `customerRef` (no client secret, publishable key or account id); adds `createCardSetupGrantCore` / `saveCardCore` (status `succeeded` / `requires_action` with `redirectUrl` / `processing`, optional `returnUrl`) and the customer-session capture-grant, payment-methods and get-session client methods; `SaveAutoRechargeResponse` gains `requiresPaymentMethod`.
- next: adds `createCardSetupGrant` and `saveCard` route helpers.
- mcp-core: the default CSP allows the VGS card field origins instead of Stripe's, the bootstrap payload drops `stripePublishableKey`, and `create_card_setup_grant` / `save_card` tools are registered.
- mcp: docs describe the vault card field CSP baseline.
