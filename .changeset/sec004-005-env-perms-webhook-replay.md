---
'@solvapay/init': patch
'@solvapay/server': minor
---

`solvapay init` now writes `.env` as owner-only (`0600`) and adds `.env` to `.gitignore` before the secret is persisted. `verifyWebhook` / `solvapayWebhook` accept an optional `seenEventId` hook so integrators can reject webhook replays after signature verification; return HTTP 2xx for `duplicate_event`.
