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
  are not compared. An API failure's code is the API's own `code` when its JSON
  body has a non-empty one, else `http_<status>`, or `non_json_response` when
  the body is not JSON; both SDKs raise `SolvaPayError` with that code and the
  status.

## Suites

| Suite                  | Operation                                                                                         | What it pins down                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook-verification` | `verifyWebhook`                                                                                   | Header parsing, the ±300 s window, HMAC over the exact bytes, error codes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `paywall-gate`         | `buildPaywallGate`, `buildNudgeMessage`                                                           | Gate kind, recovery fields, links and the exact message a customer sees; the nudge appended to a successful call near a limit                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `narration`            | `narrateAccount`, `narrateActivatePlan`, `callTool`                                               | The text and links the built-in `account` tool answers with, per view, mode and account state, and `activate_plan`'s text per status; `callTool` cases run `account` end to end (the snapshot it builds from the API, its default view)                                                                                                                                                                                                                                                                                                                                                |
| `transport-tools`      | `callTool`                                                                                        | What the widget's tools (`create_payment_intent`, `process_payment`, `create_hosted_session`, `set_renewal`, `attach_business_details`, `get_history`, `activate_plan`) answer, given the API's responses                                                                                                                                                                                                                                                                                                                                                                              |
| `pricing`              | `planPricing`                                                                                     | What every `options[]` reader of `@solvapay/core` answers for one plan: charges, headline, cycle, tiers, meters, trial, allowance, pricing shape and credits per call                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `business-details`     | `validateBusinessDetails`                                                                         | The normalised business or consumer details `validateBusinessDetails` sends, or the first problem's message (`{ "invalid": … }`)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tool-descriptors`     | `describeServer`, `getPrompts`, `readResource`                                                    | What a host sees from the whole MCP server: every tool's description, annotations, `_meta` and input schema, the prompts and resources, the widget's CSP, `hideToolsByAudience` and its ChatGPT bypass, the slash commands' messages, the overview and bootstrap resources                                                                                                                                                                                                                                                                                                             |
| `paid-tools`           | `callPaidTool`                                                                                    | A merchant's paid or free tool end to end: the `ResponseContext` its handler sees (`ctx.customer`, `fresh()`, `ctx.product`), and the result `ctx.respond` / `ctx.emit` / `ctx.gate` / a throw produce                                                                                                                                                                                                                                                                                                                                                                                 |
| `paywall-sequences`    | scenarios (see below)                                                                             | The limits cache (count-down, TTL boundary, unlimited, invalidation), parallel calls sharing one check, customer lookup and creation, free allowances, and every usage event a paid call records                                                                                                                                                                                                                                                                                                                                                                                       |
| `agent-calls`          | scenarios (`setup.agentCalls`; steps `beginCall`, `finishCall`, `releaseCall`)                    | One agent's paid call through `createAgentCalls`: the authorize body (request id, estimate, prompt hash, excerpt only when the owner opted in, the hold asked for), every refusal reason, waiting for the owner until approval, refusal, timeout or the caller leaving, API errors and unreadable answers (never let through), the complete body (cost as a decimal string, release as a 502), what finish returns, and every log line                                                                                                                                                 |
| `agent-identity`       | `verifyAgentTokens`, `promptFacts`, `oauthResources`; scenario steps `verifyAgentKey`, `identify` | `@solvapay/agents`: every agent-token check and refusal (signature, JWKS key selection, time claims with 30 s tolerance, audience and OAuth resource, issuer, claims, environment), the agent-key exchange and its 30 s cache, how `identify` tells credentials apart, the canonical resource, RFC 9728 document and 401 challenge, and prompt facts. A refusal's `detail` is compared only when it is the SDK's own sentence; one from the JWT library or the API compares as `<not compared>`                                                                                        |
| `agent-mcp`            | `agentMcpRoute`, `agentRefusalStatuses`                                                           | The agent MCP route: bearer routing, 401/403 and the OAuth challenge, the protected-resource document, the tool list, paid calls authorized, run and completed, refusals and approval waits as tool results, upstream failures; each refusal's HTTP status                                                                                                                                                                                                                                                                                                                             |
| `merchant-sign-in`     | `merchantMcpHttp`, `merchantTools`                                                                | How a merchant's MCP server signs customers in, over HTTP: the protected-resource and authorization-server documents, CORS (native client origins only, never credentials) and preflights, dynamic client registration, the authorize redirect, the token and revoke proxies with their exact forwarded bodies and RFC 6749 error mapping, 404s and 405s, and the MCP endpoint's 401 challenge for every token it refuses without asking SolvaPay; and the merchant's own paid and free tools as a host lists them, registration refusals, and a free tool's answer without a customer |
| `web-routes`           | `webRoute`                                                                                        | The HTTP routes the `@solvapay/react` components call on the merchant's backend (`/api/check-purchase`, `/api/create-payment-intent`, …), as `@solvapay/server/fetch`'s `solvapayRoutes()` serves them: status, JSON body and every request each route makes to SolvaPay; 401 without a verified user, 403 for another customer's purchase, 404 and 405 with `Allow` for paths and methods it doesn't serve                                                                                                                                                                            |

### `callTool`

A `callTool` case calls one of the MCP server's built-in tools as the signed-in
`customerRef` (`null` for none), with the API answering from `api` (and, with
`views`, a server that enables only those views):

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
the tool makes a call that is not listed, or leaves one unused. Exchanges on the
same method and path answer in the order listed. An optional `views` list sets
the views the server enables (default: all). Request bodies
are not compared. The result is the tool result's `content`, `structuredContent`
and `isError`; a text block holding JSON (what `toolResult` writes) is compared
parsed, under `json`, since key order is not part of what the widget reads.
In a tool error, a text that carries an API error answer (TypeScript's
`"<Operation> failed (<status>): <body>"`, Python's API message) compares as
`<api message>`; the status and the SDK's own sentences still compare.
Arguments must pass the tool's input schema: the Python server validates them
before the tool runs, the TypeScript runner calls the handler directly.

### `webRoute`

A `webRoute` case sends one request to the routes React calls, by `method`,
`path` (under `/api`), optional `query`, `headers` and JSON `body`, as `user`:
the person the merchant's own auth has verified (`id`, `email`, `name`), or
`null` for no credentials. TypeScript sends `user` as an HS256 bearer token the
route verifies; another SDK hands the same user to its identity hook. A header
such as `x-user-id` in `headers` comes from the client and is never identity.

`api` scripts SolvaPay as for `callTool`. The result is the route's `status`,
its JSON `body`, `allow` when it answers 405, and `apiCalls`: each request it
made to SolvaPay, in order, with its query and parsed JSON body. Each case uses
its own user id, because the SDKs remember a user's customer for a while.

### `describeServer`, `getPrompts`, `readResource`, `callPaidTool`

These reach the whole server over MCP, as a host does: the SDK's own server
factory (`createSolvaPayMcpServer` / `create_solvapay_mcp_server`) on an
in-memory transport, after an `initialize` that names the client
(`clientName`, default `conformance`). `args` may set `views`, `csp`,
`hideToolsByAudience` and `customerRef`; `api` scripts the API as for
`callTool`, each exchange used once, in order, so one path may answer twice.

- `describeServer` lists tools, prompts and resources, each sorted by name
  (resources by URI). A tool keeps `name`, `title`, `description`,
  `annotations`, `_meta` and its input schema reduced to what a host reads:
  `type`, `const`, `enum`, `description`, numeric and length bounds, and
  `properties` / `required` (sorted). An optional argument written as
  `anyOf [X, null]` compares as `X`, and `$ref`s are resolved; titles and
  defaults are not compared. `outputSchema` is not compared: Python declares
  none yet.
- `getPrompts` gets each of `calls` (`{ name, arguments }`) and returns the
  messages.
- `readResource` reads `uri`; a text that is entirely JSON compares parsed, as
  `json`.
- `callPaidTool` registers one merchant tool (`tool.kind`: `payable`, or
  `free` with `tool.freeLimit`) for `customerRef` and calls it. Its handler is
  scripted by `handler`, in this order: `emit` (blocks for `ctx.emit`),
  `fresh` (call `ctx.customer.fresh()`), `gate` (call `ctx.gate`, with the
  string as the reason, or none for `null`), `throw` (an error with that
  message), then `respond` (`data`, `text`, `nudge`, `dataInText`; `echo`
  adds `customer`, `freshCustomer` and `product` from the context to `data`).
  The outcome compares as `callTool`'s, except that a text block is parsed
  only when it is entirely JSON.

### `agentMcpRoute`, `agentRefusalStatuses`

`agentMcpRoute` builds one agent MCP route (`createAgentMcpRoute` /
`create_agent_mcp_route`) and sends it `requests` in order, as real HTTP
requests: a fetch handler in TypeScript, the route's ASGI middleware in Python.
`args` gives the agent `issuer`, the merchant's `providerRef`, the public `jwks`
the tokens are checked against (tokens in the cases are pre-signed, relative to
the case's `clock`), and:

- `route`: `mcpPath`, `serverName`, optional `serverVersion`, `maxWaitSeconds`
  (how long a call waits for its owner), `environment`, `protectedResource`
  (`resource`, `authorizationServer`, `documentation`, `metadataPath`),
  `lazyAuth`, and `agentKeys: false` for an agent layer without key
  verification.
- `tools`: paid tools, each with an `input` (`type`, `description`, `optional`
  per argument), a fixed `item` and `estimate`, the argument that is its
  `prompt`, and `run`: `{ "throw": … }` (the upstream was never reached) or the
  `status`, `cost`, `interrupted` and `text` it reports (`echo` answers the
  arguments, call reference and agent it was given). `freeTools` answer `text`.
- `requests`: `method` (default POST), `path`, `authorization` and a JSON
  `body` or a `rawBody`.
- `api`: SolvaPay's answers, each used once, in order.

The result lists, per request, `{ "merchant": true }` when the route left it to
the merchant's handler, `{ "thrown": true }` when the route failed loudly, the
route's own answer (`status`, the CORS, cache and `WWW-Authenticate` headers,
`body`), or the MCP server's answer (`status`, and each JSON-RPC message reduced
to what a host reads: a tool list as for `describeServer`, `serverInfo`, a tool
result as for `callPaidTool`, and only the `code` of an error that is not the
route's own -32001). TypeScript's MCP handler answers with an event stream and
Python's with JSON; the runners read either. Then `apiCalls`: every SolvaPay
request, with its body. Each paid call's request id is a random UUID, so it
compares as `<uuid-N>`, numbered by first appearance.

`agentRefusalStatuses` maps each of `reasons` to the HTTP status an agent API
answers that refusal with (`refusalStatus` / `refusal_status`).

### `merchantMcpHttp`, `merchantTools`

`merchantMcpHttp` builds the merchant's whole HTTP surface (`createSolvaPayMcpFetch`
/ `create_solvapay_mcp_server(...).http_app()`) for `productRef`, `publicBaseUrl` and
optional `mcpPath` and `oauthPaths`, and sends it `requests` in order (`method`,
default GET, `path` with its query, `headers`, and a JSON `body` or a `rawBody`): a
fetch handler in TypeScript, an ASGI app in Python. `api` scripts SolvaPay's answers,
each used once: a JSON `body`, or a raw `text` with `headers`, or `unreachable: true`.
The result is each answer's `status`, its media type and CORS, cache, `Location`,
`Allow` and `WWW-Authenticate` headers, and its body (JSON parsed, else text, `null`
when empty), then `apiCalls`: every SolvaPay request with its query, the
`content-type` and `authorization` it forwards, and its raw body.

`merchantTools` registers `tools` (`kind` `payable` or `free` with `freeLimit`, and
optional `title`, `description`, `annotations`, `meta`, an `input` like
`agentMcpRoute`'s, and the `customerRef` it runs for, `null` for none) on the server
for `productRef` and lists them as `describeServer` does, then calls each of
`calls` (any tool, as no customer). A registration that throws compares as
`{ "refused": true }`. `hideToolsByAudience` is `{ audiences, bypass }`, and
`clientName` names the client.

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

## Reading cases

The files are pretty-printed JSON so they review and diff well. To read them
with fewer tokens (minified is ~29% smaller), use the viewer:

```bash
node conformance/show.mjs --list paywall-gate                 # names and descriptions
node conformance/show.mjs --keys agent-calls/wait-runs-out    # shape only
node conformance/show.mjs paywall-gate/no-urls expect         # one part, minified
```

JSON stays the format on disk. YAML was measured and rejected: one of the 273
cases (`"0123456789"`) reads as a string in Python's YAML 1.1 and as an integer
in the YAML 1.2 parsers Go and TypeScript would use, and quoting every string to
avoid that leaves a 5% saving.

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
500, a conflict resolved by email, a usage event refused with another 404, a
TypeScript bug). A case for one of those paths fails, which is how a new
divergence gets noticed.

| Python does                                                                                                                                        | TypeScript does                                                                                                          | Why                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tells errors apart by `status` and `code`                                                                                                          | Raises the same codes; still reads message text for a create conflict, its email retry, usage and reactivation           | Messages are for people and change. Those branches stay while a switch would change behaviour: a custom `SolvaPayClient` may throw plain `Error`s, and the API sends no code for an email conflict.              |
| Fails on a customer lookup error other than 404                                                                                                    | Logs it and goes on to create a customer                                                                                 | A failed lookup followed by a create can duplicate the customer.                                                                                                                                                 |
| Retries a request that gets 429, 502, 503 or 504, up to twice, honouring `Retry-After`                                                             | Never retries                                                                                                            | The platform can be briefly unavailable. The runners build the Python client with `max_retries=0`, so cases pin the behaviour both share.                                                                        |
| Answers the agent MCP route's POSTs with a JSON body                                                                                               | Answers a host on the 2025 protocol with an event stream: MCP SDK v2's stateless fallback ignores `responseMode: 'json'` | The MCP spec lets a server answer a POST with either, and clients must accept both. The runners decode either and don't compare the content type.                                                                |
| Resolves a 409 on customer creation with one lookup by `externalRef`, else fails with `customer_conflict`                                          | Also looks up by email, backfills `externalRef`, then retries with a generated email                                     | The platform now links an email-matched customer itself when `externalRef` is sent, so a 409 means the email belongs to another account. A retry with a new email creates a second customer for the same person. |
| Keeps the customer cache on the client instance                                                                                                    | Shares one process-wide cache keyed by `externalRef` alone                                                               | Two clients with different keys in one process must never share a customer.                                                                                                                                      |
| Retries a usage event only on 404                                                                                                                  | Retries only when the message says "Customer not found"                                                                  | Same intent, read from the status.                                                                                                                                                                               |
| `account`: a failed customer read leaves `customer.purchase` null, and is logged                                                                   | `checkPurchaseCore` swallows the error and reports `{ customerRef, purchases: [] }`                                      | An outage must not read as "this customer has no plan". The narration is the same either way: no active purchase.                                                                                                |
| `account` and the widget's tools: use the signed-in `customer_ref` directly                                                                        | Call `ensureCustomer` first, which returns a `cus_` ref unchanged                                                        | The MCP customer always comes from the verified token as a `cus_` ref, so the lookup step never runs.                                                                                                            |
| `set_renewal`: tells a refused cancel or reactivation apart by status (404, 400); any other error is 500                                           | Matches on message text; its client names a cancel's 404 and 400 there, so only a reactivation can differ                | Messages are for people and change. An HTML 404 from a proxy, or a 400 with other text, still differs on reactivation.                                                                                           |
| `attach_business_details` sends the validated billing fields (`customerCountry`, `customerName`, `customerState`, `customerPostalCode`)            | Its API client drops them, sending only `isBusiness`, `businessName`, `country`, `taxId`, `taxIdType`, `customerRef`     | The API accepts them and Stripe Tax needs the postal code and state for US, Canadian and Indian buyers. Both validate the same input the same way (`_tax_ids.py` is generated from `@solvapay/core`).            |
| A widget tool's API error carries the API's own message in `error` and `details`                                                                   | Carries `"<Operation> failed (<status>): <response body>"`                                                               | Same status; the message is for people. The widget shows the text either way. The `callTool` cases compare it as `<api message>`.                                                                                |
| Agent MCP route: keeps waiting for the owner's approval after the MCP client disconnects                                                           | Stops waiting when the request's `AbortSignal` fires                                                                     | A Starlette request has no synchronous disconnect signal; the wait still ends at `max_wait_seconds`.                                                                                                             |
| `set_renewal` with `enabled: false` cancels the purchase                                                                                           | Answers 500 "Cancel purchase method not available on SDK client"                                                         | `cancelPurchase` went missing from `@solvapay/server`'s API client in 2.10.0 (commit `2e1b7f5e`); its body ended up in `attachBusinessDetails`. Python calls the generated `cancel_purchase`.                    |
| `webRoute`: answers a failed customer read in `check-purchase` with the error (a 404 on the cached `x-solvapay-customer-ref` hint is a cache miss) | Swallows it and answers `{ customerRef: userId, purchases: [] }`                                                         | An empty purchase list for a read that failed tells React the customer has no plan.                                                                                                                              |
| `webRoute`: fails `process-topup-payment` when a balance read fails, and on an unknown payment status                                              | Swallows the balance read and reports an unknown status as `failed`                                                      | A top-up whose outcome is unknown must not read as a known one.                                                                                                                                                  |
| `webRoute`: answers a body that isn't a JSON object with 400 `Invalid JSON body` (an empty body is `{}`)                                           | Treats it as `{}`                                                                                                        | A malformed request is the client's bug; `{}` turns it into a confusing validation error.                                                                                                                        |
| `webRoute`: no CORS handling; mount behind the framework's CORS middleware                                                                         | Answers preflights and adds CORS headers (`configureCors`)                                                               | Python apps already configure CORS once in Starlette or FastAPI.                                                                                                                                                 |

The Go routes (`webRoute`) agree with the Python rows on a failed `check-purchase` read, a failed top-up balance read and an invalid JSON body. Where Go differs from both:

| Go does                                                                                                                                                                                                | TypeScript does                    | Why                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------ |
| Reports an unknown top-up status as `failed`, as TypeScript does                                                                                                                                       | Same                               | Listed because the Python row differs.                                         |
| Serves CORS like TypeScript; `CORSOrigins` defaults to `*`                                                                                                                                             | `configureCors`, `*` by default    | Same behaviour, configured on the handler.                                     |
| Tells `reactivate-renewal` errors apart by status (404, 400, else 500), keeping TypeScript's messages                                                                                                  | Matches words in the API's message | Messages are for people and change.                                            |
| Accepts only non-empty strings for `planRef`, `productRef`, `paymentIntentId`, `purchaseRef` and `currency`, and only a number above 0 for a top-up `amount`; anything else is the same 400 as missing | Accepts any truthy value           | A wrong type is the client's bug, not a value to pass on.                      |
| Parses `history`'s `limit` as a decimal number (`0x10` is a 400)                                                                                                                                       | `Number()`, which reads hex        | Decimal is what the route documents.                                           |
| Answers a `GetUser` user with an empty id with 500 `Authentication failed`                                                                                                                             | A token without `sub` is a 401     | An empty id from the merchant's own hook is a server bug, not a missing login. |
