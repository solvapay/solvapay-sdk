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
  cases.lock                 # one fingerprint per case; only `record` writes it
  runners/typescript/        # runs every case against @solvapay/server
python/conformance_runner/   # runs the adopted cases against the Python package
python/conformance.lock      # the pin: the cases Python has adopted
```

Each language has a thin runner that reads `cases/`, maps each case's `fn` to
its own library, and compares the outcome. An adopted case whose `fn` has no
mapping is a failure, never a skip.

## Ownership, the lock and the pins

The cases belong to the TypeScript SDK. Languages adopt them; they never edit
them.

- **`cases.lock`** fingerprints every case (canonical JSON, so formatting doesn't
  count). Only `record` writes it, and the TypeScript tests fail when it is stale,
  so no case changes without going through the reference.
- **Each language pins the lock it passes** (`python/conformance.lock`). Its runner
  runs the cases whose fingerprint matches the pin; a newer or changed case is
  skipped as "not adopted" and named in the test output. Adopting means making it
  pass and running `scripts/pin_conformance.py`.
- **A language publishes only when its pin matches `cases.lock`.** The Python
  publish workflow runs `pin_conformance.py --check`, so a release passes every case
  of the commit it is built from.
- **A PR changes the contract or a language, not both.** The "Contract boundary"
  check fails a PR that touches `conformance/cases`, `cases.lock`, the schema or
  `openapi/` together with `python/` (later `go/`, `ruby/`). Label it
  `contract-change` when both must land together.

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
| `paywall-gate`         | `buildPaywallGate`, `buildNudgeMessage` | Gate kind, recovery fields, links and the exact message a customer sees; the nudge appended to a successful call near a limit                                                                             |
| `narration`            | `narrateAccount`, `narrateActivatePlan` | The text and links the built-in `account` tool answers with, per view, mode and account state, and `activate_plan`'s text per status                                                                      |
| `transport-tools`      | `callTool`                              | What the widget's tools (`create_payment_intent`, `process_payment`, `create_hosted_session`, `set_renewal`, `attach_business_details`, `get_history`, `activate_plan`) answer, given the API's responses |
| `paywall-sequences`    | scenarios (see below)                   | The limits cache (count-down, TTL boundary, unlimited, invalidation), parallel calls sharing one check, customer lookup and creation, free allowances, and every usage event a paid call records          |

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

## Scenarios: several calls in a row

Some behaviour only shows across calls: the paywall caches limits, counts units
down, maps your user id to a customer once, and records usage after the handler
runs. A scenario runs several steps against **one** SDK instance:

```json
{
  "suite": "paywall-sequences",
  "case": "cache-counts-down-then-rechecks",
  "description": "Three units from one limits check: …",
  "setup": { "productRef": "prd_sequences" },
  "steps": [
    { "fn": "decide", "clock": "2026-11-12T12:00:00.000Z", "args": { "customerRef": "cus_SEQ01" },
      "api": [{ "method": "POST", "path": "/v1/sdk/limits", "body": { "withinLimits": true, "remaining": 3, … } }],
      "expect": { "result": { "outcome": "allow", "customerRef": "cus_SEQ01" },
                  "apiCalls": [{ "method": "POST", "path": "/v1/sdk/limits", "body": { … } }] } },
    { "fn": "decide", "clock": "2026-11-12T12:00:01.000Z", "args": { "customerRef": "cus_SEQ01" },
      "expect": { "result": { "outcome": "allow", "customerRef": "cus_SEQ01" }, "apiCalls": [] } }
  ]
}
```

- **The clock is fixed per step.** Cache ages, usage timestamps, request ids and
  durations come out the same in every language. Only the 9 random characters of
  a request id are replaced, with `<random>`.
- **The API answers from the step's `api` list.** Each answer must be used during
  its step; any other request fails the step.
- **Every request is compared**, in order, with its query and body, as
  `apiCalls`. A step's outcome is `result`, `error` (its code), or `gate` (the
  paywall a paid call returned instead of running).
- Customer ids must be unique across cases: the TypeScript SDK shares its
  customer lookup cache across instances in one process.

Steps: `decide` (the paywall's verdict), `paidCall` (a function made paid with
`payable`, whose handler succeeds, fails, or gates the call itself), `decideConcurrently`
(`count` calls started together), `invalidateLimits` and `ensureCustomer` (with an
optional `externalRef`, `email` and `name`).

## Names: why cases use camelCase

Cases are written in the JSON the SDKs exchange with the API and with MCP hosts,
which is camelCase. That is not TypeScript's style leaking in: results are wire
payloads (a gate, a tool result, a usage event), and they must be identical in
every language, so they are compared exactly as they travel.

Arguments are translated by each runner, explicitly, one operation at a time
(`productRef` becomes `product=`, `freeLimit` becomes a `FreeLimit`). The
alternatives were considered and rejected:

| Approach                                             | Why not                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A neutral naming of its own, translated per language | A second vocabulary to maintain, and results would still have to be compared as wire JSON    |
| Automatic camelCase to snake_case conversion         | Hides how each SDK names things; nested objects (`freeLimit`) become typed values, not dicts |
| One case file per language                           | Copies drift, which is what the suite exists to stop                                         |

The explicit adapter also shows where SDKs differ in shape: Python's `payable`
takes the tool name from the function's name, TypeScript's from a `toolName`
option. The runner maps both, and the usage event they record must still match.

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

`record` only fills in a missing `expect`; it never changes an existing one. It
then rewrites `cases.lock`. Commit both; each language adopts the case in its own
PR.
Read the recorded result before committing it: once committed, it is what every
SDK must produce. To change an expectation on purpose, edit it by hand, so the
change shows in review.

## Known divergences

A deliberate difference between SDKs is listed here with its reason, never left
as a failing or skipped case. None of these changes a committed case's
outcome; they are on paths no case exercises (a customer lookup that fails with a
500, a conflict that can't be resolved, other API errors, a TypeScript bug). A
case for one of those paths fails, which is how a new divergence gets noticed.

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
