---
'@solvapay/server': patch
'@solvapay/mcp-core': patch
---

Fixes found by the conformance coverage work:

- A customer create that fails with anything but 409 no longer leaves the user marked as attempted. The next call creates the customer instead of sending your own user id to the API as a customer ref.
- A plan priced only in tier bands is narrated as paid, not as "requires no payment".
- One unit of a plural meter reads in the singular: "per search", "per query", not "per searche".
- A recurring plan with a price but no currency says how often it bills ("is billed every year") instead of "is a year".
- `ctx.customer.plan` is read from the limits response's `planRef`, which the API sends. It was always null.
- The ChatGPT `tools/list` bypass finds the user-agent on MCP SDK v2's `ctx.http.req`, not only on `requestInfo`.
- An invalid `publicBaseUrl` throws a `SolvaPayError` with code `invalid_argument`.
