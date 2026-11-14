---
'@solvapay/server': minor
---

`verifyWebhook` (Node and edge) refuses an empty secret with `error.code` `webhook_secret_missing` (`WEBHOOK_ERROR_CODES.secret`), before it reads the signature. HMAC accepts a zero-length key, so with an unset secret the Node verifier accepted any event signed with an empty key, and the edge verifier threw an uncoded `DataError`. If your webhook endpoint now fails every delivery with this code, set its signing secret (`whsec_…`).
