---
'@solvapay/react': patch
'@solvapay/server': patch
'@solvapay/next': patch
'@solvapay/mcp-core': patch
---

`AutoRecharge.CardSetup` saves cards again. The form refuses a grant that is not scoped to a session instead of leaving the card form loading. The 3DS return no longer re-posts the card: the return URL carries only the customer session, and the page completes the pending setup with `{ sessionId, completePendingSetup: true }`. `saveCard` (transport, `saveCardCore`, the Next `saveCard` wrapper, `saveCustomerSessionCard` and the `save_card` MCP tool) takes either `{ sessionId, cardId, returnUrl, billingDetails? }` or `{ sessionId, completePendingSetup: true }`; `returnUrl` is required with `cardId`, as the backend requires it. `parseSaveCardBody` validates a browser body and is exported from `@solvapay/server`.
