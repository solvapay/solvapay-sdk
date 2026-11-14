---
'@solvapay/server': minor
---

`@solvapay/server/fetch` now serves every route the `@solvapay/react` components call. New handlers: `processTopupPayment`, `attachBusinessDetails`, `getAutoRecharge` / `saveAutoRecharge` / `disableAutoRecharge`, `getUsage` and `checkLimits`, so `useUsage`, `useLimits`, auto-recharge and top-up completion work on a fetch backend. `solvapayRoutes()` serves them all at React's default paths (`/api/check-purchase`, `/api/list-plans`, …; `basePath` to move them), answering 404 for other paths and 405 with `Allow` for the wrong method.

`attachBusinessDetailsCore` now requires a verified user and attaches the details to that user's customer; a `customerRef` in the request body is no longer trusted.
