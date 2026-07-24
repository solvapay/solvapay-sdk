# Express provider linkage example

Demonstrates the **linkage-first** integration: your product owns the CLI and IdP; your backend holds `sk_*` and maps each authenticated user to a SolvaPay customer with `ensureCustomer(externalRef)`.

## What this proves

- Provider CLI / web login stays on **your** side (simulated with `x-provider-user-id`)
- Backend calls `ensureCustomer(externalRef)` before metering
- Protected routes use `payable.http()` with the linked `customerRef`

No SolvaPay-hosted customer login, magic link, or device handoff is involved.

## Run locally

```bash
cd examples/typescript/express-provider-linkage
pnpm install
pnpm dev
```

## Try it

```bash
# Provider user already authenticated (e.g. after `your-cli login`)
curl -X POST http://localhost:3002/tasks \
  -H "Content-Type: application/json" \
  -H "x-provider-user-id: auth0|demo-user" \
  -H "x-provider-user-email: demo@example.com" \
  -d '{"title":"My task"}'
```

## Production shape

Replace the demo headers with your real auth middleware:

1. Validate your session / JWT from your IdP.
2. Read stable `externalRef` from the token (`sub` or your internal user id).
3. `await solvaPay.ensureCustomer(externalRef, externalRef, { email, name })`.
4. Set `x-customer-ref` (or pass `customerRef` into `payable` / `trackUsage`).

## Docs

- [Customer linkage guide](../../docs/guides/customer-linkage.mdx)
- [Express integration guide](../../docs/guides/express.mdx)
