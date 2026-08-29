---
'@solvapay/server': patch
---

Remove the internal deprecated `webhook-native` shim. `verifyWebhookNative` is imported from `./native`. `resetWebhookBindingCache` and `setWebhookBindingForTests` were never exported from `index.ts` and are absent from the public-surface snapshot.
