# `mcp-checkout-app` walkthrough

This example is intentionally tiny — four source files that together
wire a full SolvaPay MCP App. Read this alongside the code to see
what `createSolvaPayMcpServer` and `<McpApp>` hide.

## `src/config.ts`

Loads env, constructs the `SolvaPay` server-SDK instance used by every
tool, and exposes the Stripe-permissive connect origin to the CSP
builder in `server.ts`.

```ts
export const solvaPay = createSolvaPay({
  apiClient: createSolvaPayClient({
    apiKey: process.env.SOLVAPAY_SECRET_KEY,
    apiBaseUrl: solvapayApiBaseUrl,
  }),
})
```

The `SolvaPay` instance is passed into `createSolvaPayMcpServer` so
every intent tool can call `solvaPay.*` server helpers
(`checkPurchase`, `createCheckoutSession`, `createPaymentIntent`, …)
with one shared OAuth-bridge-scoped customer ref.

## `src/server.ts`

One call:

```ts
return createSolvaPayMcpServer({
  solvaPay,
  productRef: solvapayProductRef,
  resourceUri: RESOURCE_URI,
  htmlPath: path.join(DIST_DIR, 'mcp-app.html'),
  publicBaseUrl: mcpPublicBaseUrl,
  csp: { connectDomains: [solvapayApiOrigin] },
  additionalTools: demoToolsEnabled() ? registerDemoTools : undefined,
})
```

What that line hides (from `@solvapay/mcp`):

- **12 tools registered** — 5 intent tools (`upgrade`, `manage_account`,
  `topup`, `check_usage`, `activate_plan`), 7 UI-only state-change
  tools (`create_checkout_session`, `create_customer_session`,
  `create_payment_intent`, `process_payment`,
  `create_topup_payment_intent`, `cancel_renewal`,
  `reactivate_renewal`).
- **5 slash-command prompts registered** (`/upgrade`,
  `/manage_account`, `/topup`, `/check_usage`, `/activate_plan`) —
  additive for hosts that support prompts, silently ignored by hosts
  that don't. Opt out with `registerPrompts: false`.
- **`docs://solvapay/overview.md` resource registered** — narrated
  "start here" text the agent can `resources/read` before trying a
  tool. Opt out with `registerDocsResources: false`.
- **1 UI resource registered** (`ui://mcp-checkout-app/mcp-app.html`)
  with the merged Stripe + consumer CSP on its `_meta.ui.csp`.
- **Bootstrap payload builder wired** — every intent tool reuses the
  same parallelised merchant/product/plans/customer snapshot so the
  iframe never has to fetch again on mount.
- **Payable handler helper** — `registerPayable` is bound for this
  `solvaPay` + `productRef` so the demo tools are one-liners.

## `src/mcp-app.tsx`

The client bundle entrypoint. Creates the `@modelcontextprotocol/ext-apps`
`App`, mounts `<McpApp app={app} applyContext={...} />`. Everything
else (provider setup, view routing, the tabbed shell, the responsive
sidebar) lives inside `<McpApp>`.

```tsx
const app = new App({ name: 'SolvaPay checkout', version: '1.0.0' })
createRoot(rootEl).render(<McpApp app={app} applyContext={applyContext} />)
```

What that line hides (from `@solvapay/react/mcp`):

- `app.connect()` and host-context (theme, fonts, safe-area insets)
  wiring.
- `fetchMcpBootstrap(app)` — calls the `open_*` tool matching the
  host's invocation, reads `BootstrapPayload` off
  `structuredContent`, throws loud errors on bad shapes.
- `<SolvaPayProvider>` mounted with a seeded `initial` snapshot so
  `useMerchant` / `useProduct` / `usePlans` / `usePaymentMethod` never
  fire a first-mount fetch.
- `<McpAppShell>` — tab nav (Credits / Plan / Top up / Account /
  Activate) driven by visibility rules, keyboard a11y, persistent
  Customer + Seller detail sidebar on wide iframes, "My account"
  header, `Terms · Privacy · Provided by SolvaPay` footer.
- Paywall narration — merchant paywalled data tools no longer open
  the widget iframe on a gate. Instead the gate's
  `content[0].text` narrates the recovery intent tool (`upgrade` /
  `topup` / `activate_plan`) and inlines `checkoutUrl`. The iframe
  mounts only when the user or LLM deliberately calls one of the
  three intent tools.

## `src/demo-tools.ts`

Two example-local paywalled data tools (`search_knowledge`,
`get_market_quote`) plus matching slash-command prompts. Registered
via `additionalTools({ registerPayable, server })` — consumes the
public `@solvapay/mcp` API the way a third-party integrator would.
Gated behind `DEMO_TOOLS` env var.

## `probe.mjs`

A tiny Node script that fetches `resources/read ui://.../mcp-app.html`
to inspect the CSP the host would see. Useful for debugging
host-specific sandbox policies without booting the whole iframe.

## Mental model

- **Tools are the vocabulary** the agent sees in `tools/list`. One tool
  per user intent.
- **The UI resource is a single shell** — `bootstrap.view` selects the
  initial tab; every subsequent navigation is in-app.
- **Prompts + docs resource** are the narration layer. They tell the
  agent and the user what this server is for before they try a tool.
