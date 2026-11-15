# @solvapay/go

## 0.1.0

### Minor Changes

- 1959dc8: First release of the Go SDK, `github.com/solvapay/solvapay-sdk/go`, at v0.1.0: an API client generated from the committed spec, the paywall, webhooks, paid MCP tools and agent payments (a preview: SolvaPay turns them on per merchant, and live agent payments aren't open yet). It has its own version line, separate from the TypeScript packages, and passes the conformance suite pinned in `go/conformance.lock`.
- 37da91c: React web checkout with a Go backend: `NewWebHandler(WebOptions{Client, GetUser})` serves every route the `@solvapay/react` components call (check-purchase, payment and top-up intents, renewal, checkout and customer sessions, plans, product, merchant, balance, payment method, auto-recharge, usage, limits, history, sync-customer, track-usage) under `/api`, answering as `@solvapay/server/fetch` does: 404 for unknown paths, 405 with `Allow`, and TypeScript's error bodies. Identity comes only from the merchant's own `GetUser`; a client header is never taken as the user. The widget's `set_renewal` tool now reads the purchase first and refuses, with 403, to cancel or reactivate a purchase that belongs to another customer.

### Patch Changes

- fb4fa8a: `VerifyWebhook` refuses an empty secret with code `webhook_secret_missing` (`WebhookSecretMissing`), before it reads the signature. Before, an unset secret verified any event signed with an empty key.
