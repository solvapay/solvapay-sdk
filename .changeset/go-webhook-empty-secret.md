---
'@solvapay/go': patch
---

`VerifyWebhook` refuses an empty secret with code `webhook_secret_missing` (`WebhookSecretMissing`), before it reads the signature. Before, an unset secret verified any event signed with an empty key.
