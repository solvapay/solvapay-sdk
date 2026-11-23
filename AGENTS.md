# AGENTS.md — solvapay-sdk

One repo for every SolvaPay SDK. TypeScript is the reference: it owns the shared
contract, and every other language must behave the same. Each folder has its own
AGENTS.md with the rules for working there.

```
openapi/sdk-v1.json   the API spec, synced from the platform; CI checks for drift
conformance/          cases, schema and cases.lock; owned by the TypeScript SDK
packages/             the TypeScript SDK
python/               the Python SDK, with its conformance runner and pin
go/                   the Go SDK, with its conformance runner and pin
mcp-app/              the MCP App (checkout, account, top-up), built once and copied into each package
examples/  docs/  scripts/
```

## Rules

- **Work in one area per PR.** A PR that changes the contract (`conformance/cases`,
  `conformance/cases.lock`, `conformance/case.schema.json`, `openapi/`) and a
  language folder (`python/`, later `go/`, `ruby/`) together fails the
  "Contract boundary" check, unless it is labelled `contract-change`.
- **Behaviour changes start in TypeScript.** Change `packages/`, add or update a
  case, record it, and merge. Each language then adopts the new cases in its own
  PR by making them pass and updating its pin.
- **A language publishes only when its pin matches `conformance/cases.lock`.**
- Never hand-edit generated files: `openapi/sdk-v1.json`, `conformance/cases.lock`,
  a language's pin, generated clients, the widget copy in a package.
- **Payload types come from the spec.** Request, response and webhook payload
  types are generated from `openapi/sdk-v1.json` wherever feasible, in every
  language. Don't hand-write one. If a payload is missing from the spec, add its
  schema in the platform first, then sync and regenerate. Hand-write a type only
  where a schema is not feasible, and say why in the PR. The webhook payload types
  in `packages/server/src/types/webhook.ts` are hand-written for now, because the
  spec does not describe webhook payloads yet.
