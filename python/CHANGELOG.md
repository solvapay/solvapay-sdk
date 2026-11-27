# @solvapay/python

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

- bb5f05d: First release of `solvapay`, the Python SDK, at 0.1.0: an API client generated from the committed spec, the paywall, webhooks, paid MCP tools (`solvapay[mcp]`) and agent payments (`solvapay[agents]`, a preview: SolvaPay turns them on per merchant, and live agent payments aren't open yet). It has its own version line, separate from the TypeScript packages, and passes the conformance suite pinned in `python/conformance.lock`.
- 67dbc7f: `solvapay.web.routes()` serves every route the `@solvapay/react` components call, so they work with a Python backend: check-purchase, payment and top-up intents and their processing, business details, balance, renewal cancel and reactivate, plan activation, hosted checkout and account sessions, merchant, product and plans, payment method, auto-recharge (GET, PUT, DELETE), usage, limits, history, sync-customer and track-usage. It is an ASGI app (install `solvapay[web]`) that answers as TypeScript's `solvapayRoutes()` does, pinned by the `web-routes` conformance cases: unknown paths 404, the wrong method 405 with `Allow`. Identity comes only from the required `get_user(request)` hook, where the merchant verifies their own auth; a request without a user is refused with 401, and no client header is identity.

  The widget's `set_renewal` tool now acts only on the signed-in customer's own purchase: it reads the purchase first (`GET /v1/sdk/purchases/{purchaseRef}`) and answers 403 "This purchase belongs to another customer" otherwise. It used to cancel or reactivate any purchase reference it was given.

### Patch Changes

- 50fb13e: `verify_webhook` refuses an empty secret with code `webhook_secret_missing`, before it reads the signature. Before, an unset secret verified any event signed with an empty key.
