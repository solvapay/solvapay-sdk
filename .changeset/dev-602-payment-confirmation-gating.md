---
'@solvapay/react': major
'@solvapay/server': minor
---

Gate payment success on real confirmation and remove the legacy Card Element surface.

**Breaking (`@solvapay/react`):**
- Removed `StripePaymentFormWrapper`, `PaymentForm.CardElement` / `PaymentFormCardElement`, and the `card-element` `ConfirmPaymentMode`.
- `confirmPayment` is Payment Element only; use `PaymentForm.PaymentElement` with `stripe.confirmPayment` and a `return_url`.
- Renamed i18n key `errors.cardElementMissing` → `errors.paymentElementMissing`.

**Added:**
- `paymentIntentReturn` helpers and return-path resume in `PaymentForm` / `TopupForm`.
- `processing` is treated as pending (not error) in `confirmPayment`, `reconcilePayment`, and backend `/process`.
- `ConfirmPaymentResult` adds a `pending` status for async payment methods.

**`@solvapay/server`:**
- `ProcessPaymentResult` and `TopupProcessResult` include a `processing` status.
