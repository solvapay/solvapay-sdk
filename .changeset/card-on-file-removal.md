---
'@solvapay/server': minor
---

Add `removePaymentMethod({ customerRef })` on the API client and `removePaymentMethodCore(request)`: removes the customer's card on file (`DELETE /v1/sdk/payment-method`) and detaches it on the payment rail. The next saved card becomes the default; auto-recharge on the removed card waits for a new card.
