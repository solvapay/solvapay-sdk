---
'@solvapay/python': minor
---

`solvapay.web.routes()` serves every route the `@solvapay/react` components call, so they work with a Python backend: check-purchase, payment and top-up intents and their processing, business details, balance, renewal cancel and reactivate, plan activation, hosted checkout and account sessions, merchant, product and plans, payment method, auto-recharge (GET, PUT, DELETE), usage, limits, history, sync-customer and track-usage. It is an ASGI app (install `solvapay[web]`) that answers as TypeScript's `solvapayRoutes()` does, pinned by the `web-routes` conformance cases: unknown paths 404, the wrong method 405 with `Allow`. Identity comes only from the required `get_user(request)` hook, where the merchant verifies their own auth; a request without a user is refused with 401, and no client header is identity.

The widget's `set_renewal` tool now acts only on the signed-in customer's own purchase: it reads the purchase first (`GET /v1/sdk/purchases/{purchaseRef}`) and answers 403 "This purchase belongs to another customer" otherwise. It used to cancel or reactivate any purchase reference it was given.
