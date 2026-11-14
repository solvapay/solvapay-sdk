---
'@solvapay/python': patch
---

`verify_webhook` refuses an empty secret with code `webhook_secret_missing`, before it reads the signature. Before, an unset secret verified any event signed with an empty key.
