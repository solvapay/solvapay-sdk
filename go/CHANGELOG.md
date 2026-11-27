# @solvapay/go

## 0.1.2

### Patch Changes

- 00ba50d: The generated API clients follow the platform's spec, rewritten for its zod 4 upgrade. It now matches what the API accepts.
  - `timestamp` on a usage event is optional; the API stamps the event when it is left out. In Go, `Timestamp` is now `*string`.
  - A completed agent call's `cost` needs both `amount` and `currency`, as the API already required. In Go, both are now `string` rather than `*string`.
  - A Python request model checks its values against the API's limits when it is built: email addresses, three-letter currency codes, date-times with seconds, and integers up to 2^53 - 1.

## 0.1.1

### Patch Changes

- cefc710: `account` no longer tells a customer who can call to "continue", as in `@solvapay/mcp-core`. The "To continue, call …" line ends the text only when the customer is blocked (no plan, short of credits, allowance used up, a free plan to claim). The bootstrap payload's `product` now carries only `reference`, `name`, `status`, `description` and `imageUrl`, so the merchant's `metadata` and its own `balance` and `totalTransactions` no longer reach customers and models. Adopts the 22 re-recorded conformance cases.
- c5f8d2d: The Python and Go MCP servers are stateless by default, as the TypeScript server is.
  - Python `http_app()` and Go `Handler()` issue no `mcp-session-id`, and a request needs no earlier `initialize` on the same instance. In-memory sessions broke once a load balancer spread one client over several instances, and clients that send one request per call got `400 Missing session ID` (Python) or `method "tools/list" is invalid during session initialization` (Go). For sessions, pass `http_app(stateless_http=False)` in Python or set `MCPServerOptions.Stateful` in Go, on a single instance or with sticky routing.
  - The Python and Go scaffolds from `create-solvapay` pass `hide_tools_by_audience=["ui"]` / `HideToolsByAudience: []string{"ui"}`, as the TypeScript template does, so the widget's own tools stay out of `tools/list` and `solvapay verify` passes on a fresh scaffold. The MCP guides' first example does the same.

- 79a8fab: The protected-resource document is also served at its RFC 9728 path-suffixed URL, `/.well-known/oauth-protected-resource/mcp`, following a custom MCP path, as in `@solvapay/mcp`. There the resource is the endpoint URL (`https://host/mcp`), as RFC 9728 §3.3 requires; the root document still names the public base URL. Adopts the two merchant-sign-in conformance cases.
- 8d5ba29: The generated API clients follow the platform: `SdkProductResponse` no longer has `balance` or `totalTransactions`. The platform drops both from every product response, and the 0.1.0 Python model required them, so `get_product` and the MCP bootstrap failed validation against the new API. Go read the missing fields as zero.

## 0.1.0

### Minor Changes

- 1959dc8: First release of the Go SDK, `github.com/solvapay/solvapay-sdk/go`, at v0.1.0: an API client generated from the committed spec, the paywall, webhooks, paid MCP tools and agent payments (a preview: SolvaPay turns them on per merchant, and live agent payments aren't open yet). It has its own version line, separate from the TypeScript packages, and passes the conformance suite pinned in `go/conformance.lock`.
- 37da91c: React web checkout with a Go backend: `NewWebHandler(WebOptions{Client, GetUser})` serves every route the `@solvapay/react` components call (check-purchase, payment and top-up intents, renewal, checkout and customer sessions, plans, product, merchant, balance, payment method, auto-recharge, usage, limits, history, sync-customer, track-usage) under `/api`, answering as `@solvapay/server/fetch` does: 404 for unknown paths, 405 with `Allow`, and TypeScript's error bodies. Identity comes only from the merchant's own `GetUser`; a client header is never taken as the user. The widget's `set_renewal` tool now reads the purchase first and refuses, with 403, to cancel or reactivate a purchase that belongs to another customer.

### Patch Changes

- fb4fa8a: `VerifyWebhook` refuses an empty secret with code `webhook_secret_missing` (`WebhookSecretMissing`), before it reads the signature. Before, an unset secret verified any event signed with an empty key.
