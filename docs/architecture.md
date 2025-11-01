# Architecture

**Goal:** Clean runtime boundaries, great DX, and focused packages. Core types are universal, server SDK works everywhere (Node + Edge), and React provides payment flow components.

## Monorepo Layout

```
solvapay-sdk/
├─ examples/
│  ├─ checkout-demo/       # Full checkout with plan selection
│  ├─ express-basic/       # Paywall protection for CRUD APIs
│  ├─ nextjs-openai-custom-gpt-actions/  # Payment flow with React and OpenAI integration
│  └─ mcp-basic/           # MCP server integration
├─ packages/
│  ├─ core/                # @solvapay/core (types & schemas)
│  ├─ server/              # @solvapay/server (Node + Edge)
│  ├─ react/               # @solvapay/react (payment components)
│  ├─ demo-services/       # Demo services for examples (private)
│  ├─ test-utils/          # Testing utilities (private)
│  └─ tsconfig/            # Shared TypeScript config (private)
├─ docs/                   # Documentation
├─ pnpm-workspace.yaml
├─ turbo.json
├─ package.json
└─ README.md
```

## Package Summary

The SDK has been streamlined to **3 published packages** focused on clear use cases:

| Package | Version | Purpose | Published |
|---------|---------|---------|-----------|
| `@solvapay/core` | 0.1.0 | Types, schemas, shared utilities | ✅ Yes |
| `@solvapay/server` | 0.1.0 | Node + Edge runtime SDK with unified API | ✅ Yes |
| `@solvapay/react` | 0.1.0 | Payment flow components (Stripe integration) | ✅ Yes |
| `@solvapay/demo-services` | 0.0.0 | Demo services for examples | 🔒 Private |
| `@solvapay/test-utils` | 0.0.0 | Testing utilities | 🔒 Private |
| `@solvapay/tsconfig` | 0.0.0 | Shared TypeScript config | 🔒 Private |


## Packages

### `@solvapay/core` (pure/agnostic)

* Types and schemas (zod), shared errors, version, tiny utilities.
* No Node/browser globals; `"sideEffects": false`.

### `@solvapay/server` (Node + Edge runtime)

* Secret API client (works everywhere - uses `fetch` API), webhook verification, paywall protection.
* Automatic runtime detection via export conditions:
  - **Node.js**: Uses Node `crypto` for webhook verification
  - **Edge runtimes**: Uses `crypto.subtle` for webhook verification
* Works in: Express, Fastify, Next.js API routes, Vercel Edge, Cloudflare Workers, Deno, Supabase Edge Functions
* Export conditions (`edge-light`, `worker`, `deno`) ensure correct module is loaded
* Includes unified API: `createSolvaPay()`, `payable.http()`, `payable.next()`, `payable.mcp()`

### `@solvapay/react` (payment components)

* Payment flow components: `SolvaPayProvider` and `PaymentForm`.
* Handles Stripe integration for payment processing.
* Includes default styling for payment forms.
* Peer deps: `react`, `react-dom`.

## Build & Release

* `tsup` builds ESM+CJS+types for every package.
* `turbo` orchestrates `build/test/lint/dev`.
* Version independently with Changesets (add later), or keep in lockstep early on.
* Node engines: `>=18.17`; Edge builds avoid Node APIs.

## Security & Env Hygiene

* Secrets only in **server** package.
* API keys never exposed to the browser - payment flows initiated by backend API routes.
* Provide `Env` schemas in `core` for validation, parse on the server.

## Testing

* **Unit tests**: Vitest with mock backend (fast, deterministic)
* **Integration tests**: Optional real backend testing via `USE_REAL_BACKEND=true`
* **Test utilities**: Shared helpers in `@solvapay/test-utils` (private package)
* **Demo services**: Example service implementations in `@solvapay/demo-services` (private package)

See [`packages/server/__tests__/`](../packages/server/__tests__/) for comprehensive test examples.

## Example Imports

```ts
// Server code (Node.js, Edge, Deno, etc.):
import { createSolvaPayClient, verifyWebhook, createSolvaPay } from '@solvapay/server';
// Auto-selects correct implementation based on runtime!

// Unified API for paywall protection:
const solvaPay = createSolvaPay({ apiKey: 'sk_...' });
const payable = solvaPay.payable({ agent: 'my-api' });

// Use with different adapters:
app.post('/endpoint', payable.http(handler));           // Express/Fastify
export const POST = payable.next(handler);              // Next.js
const mcpHandler = payable.mcp(handler);                // MCP servers

// React payment components:
import { SolvaPayProvider, PaymentForm } from '@solvapay/react';
```

## Runtime Detection

The `@solvapay/server` package uses export conditions to automatically select the correct implementation:

```json
{
  "exports": {
    ".": {
      "edge-light": "./dist/edge.js",  // Vercel Edge Functions
      "worker": "./dist/edge.js",       // Cloudflare Workers
      "deno": "./dist/edge.js",         // Deno
      "import": "./dist/index.js",      // Node.js ESM
      "require": "./dist/index.cjs"     // Node.js CommonJS
    }
  }
}
```

This means developers use the same import everywhere:
- ✅ **Vercel Edge Functions** → Gets `edge.js` (uses `crypto.subtle`)
- ✅ **Cloudflare Workers** → Gets `edge.js` (uses `crypto.subtle`)
- ✅ **Supabase Edge Functions** → Gets `edge.js` (uses `crypto.subtle`)
- ✅ **Deno** → Gets `edge.js` (uses `crypto.subtle`)
- ✅ **Next.js API Routes** → Gets `index.js` (uses Node `crypto`)
- ✅ **Express** → Gets `index.js` (uses Node `crypto`)
