---
'@solvapay/server': patch
---

`CustomerWebhookObject` gains an optional `externalRef` (`string | null`): your own ID for the customer, now sent on `customer.*` webhook events.
