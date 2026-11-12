# SDK conformance suite

Language-neutral test cases that every SolvaPay SDK must pass. They are how the
SDKs share behaviour without generating one language's logic from another's.

Most of what an SDK does is calling the API, and that part is generated from the
committed OpenAPI spec. What is left runs in the developer's process: verifying
webhooks, deciding whether a paid call may go ahead, building the paywall a
customer sees. These cases pin that part down. The TypeScript SDK is the
reference: a case states what TypeScript does, and every other SDK must do the
same.

## Layout

```
conformance/
  case.schema.json           # the format of a case
  cases/<suite>/<case>.json  # one input and its expected outcome
  runners/typescript/        # runs every case against @solvapay/server
python/conformance_runner/   # runs every case against the Python package
```

Each language has a thin runner that reads `cases/`, maps each case's `fn` to
its own library, and compares the outcome. A runner never skips a case: an `fn`
it has not mapped is a failure.

## A case

```json
{
  "$schema": "../../case.schema.json",
  "suite": "webhook-verification",
  "case": "valid-signature",
  "description": "A correctly signed delivery verifies and returns the parsed event.",
  "input": {
    "fn": "verifyWebhook",
    "args": { "body": "…", "signature": "t=…,v1=…", "secret": "whsec_…" },
    "clock": "2026-11-12T12:00:00Z"
  },
  "expect": { "result": { "id": "evt_…" } }
}
```

- `fn` is a language-neutral name. `args` is one JSON object with camelCase
  keys; a runner converts them (Python: `verify_webhook(body=…, …)`).
- `clock` is the time the operation runs at. Anything that reads the clock reads
  this instead, so a case gives the same outcome every day. (The TypeScript
  runner fixes `new Date()` for operations that take no clock argument.)
- `expect.result` is compared as JSON: a key that is missing and a key whose
  value is undefined are the same, `null` is not.
- `expect.error.code` is the error's stable code. Messages are for people and
  are not compared.

## Suites

| Suite                  | Operation                               | What it pins down                                                                                                                                                                                         |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook-verification` | `verifyWebhook`                         | Header parsing, the ±300 s window, HMAC over the exact bytes, error codes                                                                                                                                 |
| `paywall-gate`         | `buildPaywallGate`                      | Gate kind, recovery fields, links and the exact message a customer sees                                                                                                                                   |
| `narration`            | `narrateAccount`, `narrateActivatePlan` | The text and links the built-in `account` tool answers with, per view, mode and account state, and `activate_plan`'s text per status                                                                      |
| `transport-tools`      | `callTool`                              | What the widget's tools (`create_payment_intent`, `process_payment`, `create_hosted_session`, `set_renewal`, `attach_business_details`, `get_history`, `activate_plan`) answer, given the API's responses |

### `callTool`

A `callTool` case calls one of the MCP server's built-in tools as the signed-in
`customerRef` (`null` for none), with the API answering from `api`:

```json
"args": {
  "tool": "create_hosted_session",
  "productRef": "prd_conform1",
  "customerRef": "cus_conform1",
  "arguments": { "kind": "portal" },
  "api": [
    { "method": "POST", "path": "/v1/sdk/customers/customer-sessions", "body": { "sessionId": "ss_1", "customerUrl": "…" } }
  ]
}
```

Each runner stubs its HTTP client at `https://api.conformance.test` and fails if
the tool makes a call that is not listed, or leaves one unused. Request bodies
are not compared. The result is the tool result's `content`, `structuredContent`
and `isError`; a text block holding JSON (what `toolResult` writes) is compared
parsed, under `json`, since key order is not part of what the widget reads.
Arguments must pass the tool's input schema: the Python server validates them
before the tool runs, the TypeScript runner calls the handler directly.

## Running

```bash
pnpm --filter @solvapay/conformance-typescript test
```

## Adding a case

Add a case whenever a bug is fixed or the behaviour of the in-process code
changes. Write the input and the description, leave `expect` out, and record what
TypeScript does:

```bash
pnpm --filter @solvapay/conformance-typescript record
```

`record` only fills in a missing `expect`; it never changes an existing one.
Read the recorded result before committing it: once committed, it is what every
SDK must produce. To change an expectation on purpose, edit it by hand, so the
change shows in review.

## Known divergences

A deliberate difference between SDKs is listed here with its reason, never left
as a failing or skipped case. None of these changes a conformance case's
outcome; they are in code the cases do not reach (customer resolution, API
errors, request bodies, a TypeScript bug).

| Python does                                                                                                                             | TypeScript does                                                                                                      | Why                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tells errors apart by `status` and `code`                                                                                               | Matches on message text (`includes('404')`, `'already exists'`, `'email'`)                                           | Messages are for people and change.                                                                                                                                                                              |
| Fails on a customer lookup error other than 404                                                                                         | Logs it and goes on to create a customer                                                                             | A failed lookup followed by a create can duplicate the customer.                                                                                                                                                 |
| Resolves a 409 on customer creation with one lookup by `externalRef`, else fails with `customer_conflict`                               | Also looks up by email, backfills `externalRef`, then retries with a generated email                                 | The platform now links an email-matched customer itself when `externalRef` is sent, so a 409 means the email belongs to another account. A retry with a new email creates a second customer for the same person. |
| Keeps the customer cache on the client instance                                                                                         | Shares one process-wide cache keyed by `externalRef` alone                                                           | Two clients with different keys in one process must never share a customer.                                                                                                                                      |
| Retries a usage event only on 404                                                                                                       | Retries only when the message says "Customer not found"                                                              | Same intent, read from the status.                                                                                                                                                                               |
| `account`: a failed customer read leaves `customer.purchase` null, and is logged                                                        | `checkPurchaseCore` swallows the error and reports `{ customerRef, purchases: [] }`                                  | An outage must not read as "this customer has no plan". The narration is the same either way: no active purchase.                                                                                                |
| `account` and the widget's tools: use the signed-in `customer_ref` directly                                                             | Call `ensureCustomer` first, which returns a `cus_` ref unchanged                                                    | The MCP customer always comes from the verified token as a `cus_` ref, so the lookup step never runs.                                                                                                            |
| `set_renewal` with `enabled: false` cancels the purchase                                                                                | Answers 500 "Cancel purchase method not available on SDK client"                                                     | `cancelPurchase` went missing from `@solvapay/server`'s API client in 2.10.0 (commit `2e1b7f5e`); its body ended up in `attachBusinessDetails`. Python calls the generated `cancel_purchase`.                    |
| `set_renewal`: tells a refused cancel or reactivation apart by status (404, 400); any other error is 500                                | Matches on message text (`'not found'`, `'cannot be cancelled'`, …)                                                  | Messages are for people and change.                                                                                                                                                                              |
| `attach_business_details` sends the validated billing fields (`customerCountry`, `customerName`, `customerState`, `customerPostalCode`) | Its API client drops them, sending only `isBusiness`, `businessName`, `country`, `taxId`, `taxIdType`, `customerRef` | The API accepts them and Stripe Tax needs the postal code and state for US, Canadian and Indian buyers. Both validate the same input the same way (`_tax_ids.py` is generated from `@solvapay/core`).            |
| A widget tool's API error carries the API's own message in `error` and `details`                                                        | Carries `"<Operation> failed (<status>): <response body>"`                                                           | Same status; the message is for people. The widget shows the text either way.                                                                                                                                    |
| Agent MCP route: keeps waiting for the owner's approval after the MCP client disconnects                                                | Stops waiting when the request's `AbortSignal` fires                                                                 | A Starlette request has no synchronous disconnect signal; the wait still ends at `max_wait_seconds`.                                                                                                             |
