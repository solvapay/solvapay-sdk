---
'@solvapay/server': minor
---

`verifyWebhook` (Node and edge) now fails with a stable `error.code` you can branch on: `webhook_signature_missing`, `webhook_signature_malformed`, `webhook_timestamp_out_of_tolerance`, `webhook_signature_invalid` or `webhook_payload_invalid` (exported as `WEBHOOK_ERROR_CODES`). It takes an optional `now` to check the timestamp against. A timestamp that is not all digits (`t=123abc`) is now rejected as malformed instead of being read as `123`, and spaces around the header's parts are allowed. Messages changed slightly; branch on the code, not the message.

The paywall message for a customer with no active plan no longer states the checkout links' expiry twice when it lists plans.
