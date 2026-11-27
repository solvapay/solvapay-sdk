---
'@solvapay/server': patch
---

`createSolvaPay` no longer logs paywall debug output by default. Debug logging is on only when `SOLVAPAY_DEBUG` is `"true"`, the same rule the API client and `SolvaPayPaywall` already followed. Before, an unset `SOLVAPAY_DEBUG` turned it on for the paywall that `createSolvaPay` builds. Set `SOLVAPAY_DEBUG=true` to keep the logs.

Customer lookups and retries that fail and are worked around (a failed lookup by `externalRef`, a failed lookup or retry after a create conflict, a failed `externalRef` backfill) now always print a `console.warn`, so turning debug off can't hide them.
