# @solvapay/python

## 0.1.0

### Minor Changes

- bb5f05d: First release of `solvapay`, the Python SDK, at 0.1.0: an API client generated from the committed spec, the paywall, webhooks, paid MCP tools (`solvapay[mcp]`) and agent payments (`solvapay[agents]`, a preview: SolvaPay turns them on per merchant, and live agent payments aren't open yet). It has its own version line, separate from the TypeScript packages, and passes the conformance suite pinned in `python/conformance.lock`.
- 67dbc7f: `solvapay.web.routes()` serves every route the `@solvapay/react` components call, so they work with a Python backend: check-purchase, payment and top-up intents and their processing, business details, balance, renewal cancel and reactivate, plan activation, hosted checkout and account sessions, merchant, product and plans, payment method, auto-recharge (GET, PUT, DELETE), usage, limits, history, sync-customer and track-usage. It is an ASGI app (install `solvapay[web]`) that answers as TypeScript's `solvapayRoutes()` does, pinned by the `web-routes` conformance cases: unknown paths 404, the wrong method 405 with `Allow`. Identity comes only from the required `get_user(request)` hook, where the merchant verifies their own auth; a request without a user is refused with 401, and no client header is identity.

  The widget's `set_renewal` tool now acts only on the signed-in customer's own purchase: it reads the purchase first (`GET /v1/sdk/purchases/{purchaseRef}`) and answers 403 "This purchase belongs to another customer" otherwise. It used to cancel or reactivate any purchase reference it was given.

### Patch Changes

- 50fb13e: `verify_webhook` refuses an empty secret with code `webhook_secret_missing`, before it reads the signature. Before, an unset secret verified any event signed with an empty key.
