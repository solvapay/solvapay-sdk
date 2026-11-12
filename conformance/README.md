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
  this instead, so a case gives the same outcome every day.
- `expect.result` is compared as JSON: a key that is missing and a key whose
  value is undefined are the same, `null` is not.
- `expect.error.code` is the error's stable code. Messages are for people and
  are not compared.

## Suites

| Suite                  | Operation          | What it pins down                                                         |
| ---------------------- | ------------------ | ------------------------------------------------------------------------- |
| `webhook-verification` | `verifyWebhook`    | Header parsing, the ±300 s window, HMAC over the exact bytes, error codes |
| `paywall-gate`         | `buildPaywallGate` | Gate kind, recovery fields, links and the exact message a customer sees   |

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

None yet. A deliberate difference between SDKs is listed here with its reason,
never left as a failing or skipped case.
