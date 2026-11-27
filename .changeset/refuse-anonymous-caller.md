---
'@solvapay/server': patch
'@solvapay/mcp': patch
---

A paid call with no customer is now refused before SolvaPay is called. Before, the SDK sent `customerRef: "anonymous"` to the API, which has no such customer and answered 404 `Customer not found: anonymous`, so the call failed late with a 500 or an error result.

- `decide()`, `payable.http`, `payable.next`, `payable.gate` and `payable.mcp` throw or answer 401 `identity_required` when the customer is empty or `"anonymous"`. Free allowances already did.
- `payable.http` and `payable.next` now answer `identity_required` with 401, not 500. This also changes the status free allowances got.
- `registerPayable` refuses a call with no signed-in customer the way `registerFree` does: `Unauthorized`, 401, `customer_ref missing from MCP auth context`.
- The `get_user_info`, upgrade and manage-account virtual tools return `identity required` instead of calling the API for `"anonymous"`.

A test or stub client that relied on calls with no customer reaching the handler now gets the 401.
