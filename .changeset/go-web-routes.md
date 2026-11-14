---
'@solvapay/go': minor
---

React web checkout with a Go backend: `NewWebHandler(WebOptions{Client, GetUser})` serves every route the `@solvapay/react` components call (check-purchase, payment and top-up intents, renewal, checkout and customer sessions, plans, product, merchant, balance, payment method, auto-recharge, usage, limits, history, sync-customer, track-usage) under `/api`, answering as `@solvapay/server/fetch` does: 404 for unknown paths, 405 with `Allow`, and TypeScript's error bodies. Identity comes only from the merchant's own `GetUser`; a client header is never taken as the user. The widget's `set_renewal` tool now reads the purchase first and refuses, with 403, to cancel or reactivate a purchase that belongs to another customer.
