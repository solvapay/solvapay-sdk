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

- **7 tools registered** — 2 intent tools (`account`, `activate_plan`), 5
  UI-only state-change tools (`create_hosted_session`, `create_payment_intent`,
  `process_payment`, `set_renewal`, `attach_business_details`).
- **4 slash-command prompts registered** (`/upgrade`,
  `/manage_account`, `/topup`, `/activate_plan`) —
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
else (provider setup, view routing, the shell) lives inside `<McpApp>`.

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
- `<McpAppShell>` — surface-routed (account / checkout / topup), no tab
  strip. One provenance line (`{merchant} · Paying as {email}`) instead
  of a Seller / Your account sidebar.
  `Terms · Privacy · Provided by SolvaPay` footer.
- Paywall narration — merchant paywalled data tools no longer open
  the widget iframe on a gate. Instead the gate's
  `content[0].text` states the current limit, names the recovery
  intent tool (`` `account` `` with the appropriate `view`, or
  `` `activate_plan` `` when a `planRef` is known), and inlines
  `checkoutUrl`. Official MCP Apps guidance: the model reads that
  text, not `structuredContent`. The iframe mounts only when the
  user or LLM deliberately calls the `account` viewer.

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
- **`content[0].text` is the model and text-only-host lane.** Official
  MCP Apps / 2026-07-28 tools guidance: `structuredContent` is for the
  widget and is often hidden from the model when `content` is present.
  Gate, nudge, and intent results must be self-sufficient in that first
  text block (limits, recovery tool, https URL) — never
  `"shown in the panel."` See
  [`docs/contributing/mcp-apps-host-contract.md`](../../docs/contributing/mcp-apps-host-contract.md).
- **The UI resource is a single shell** — `bootstrap.view` selects the
  surface; every subsequent navigation is in-app. Text-only hosts never
  open it.
- **Prompts + docs resource** are the narration layer. They tell the
  agent and the user what this server is for before they try a tool.
  `docs://solvapay/overview.md` is how a text host discovers app
  capabilities; `manage_account` is how it discovers user info.
