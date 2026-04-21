---
name: Lift mcp-checkout-app views into @solvapay/react/mcp
overview: After dogfooding the prototype views in examples/mcp-checkout-app (checkout, account, topup, activate), extract the stable surface into @solvapay/react/mcp so integrators building their own MCP apps can reuse them without copy-pasting the example.
todos:
  - id: dogfood-notes
    content: Collect dogfooding notes from basic-host + Claude runs — which views actually render end-to-end, which transports still throw, which CSS/primitive APIs felt wrong
    status: pending
  - id: api-shape
    content: Decide the SDK shape — one compound McpApp with a view prop, four independent primitives (McpCheckout / McpAccount / McpTopup / McpActivate), or a router-plus-slot pattern. Write a short ADR in packages/react/docs/ before coding
    status: pending
  - id: activation-inline-topup-fix
    content: Fix the ActivationFlow.AmountPicker seam (currently creates its own useTopupAmountSelector instance, so AmountPicker state does not feed back into the flow's retry). This blocks shipping a real inline topup-for-activation path
    status: pending
  - id: extract-views
    content: Move AccountView, TopupView, ActivateView (and the checkout body) from examples/mcp-checkout-app/src/views/ into packages/react/src/mcp/, preserving the prop shape chosen in api-shape
    status: pending
  - id: host-shell-stays
    content: Keep Bootstrap, useStripeProbe, createMcpFetch, createMcpAppAdapter, and the open_* tool registrations in the example — these are MCP-App host integration concerns, not SDK surface
    status: pending
  - id: example-thins-out
    content: Rewrite examples/mcp-checkout-app/src/mcp-app.tsx to be the thinnest possible bootstrap around the new SDK exports, so the example becomes a reference integration rather than a view library
    status: pending
  - id: docs-and-changeset
    content: Add a changeset, update packages/react/README.md with the new @solvapay/react/mcp entry point, document the view discriminator contract, and publish
    status: pending
isProject: false
---

## Why this follow-up exists

The parent plan ([mcp-app_virtual-tools_ui_gap_plan_49e0440e](./mcp-app_virtual-tools_ui_gap_plan_49e0440e.plan.md)) prototyped four MCP views in the example app rather than in the SDK, because:

- The SDK surface was unknown — compound vs. per-view primitives vs. router-plus-slot.
- The host shell (Stripe probe, MCP adapter, open_* tool registrations) is never going to live in the SDK.
- "Move fast, break nothing" applies to exported types; every @solvapay/react/mcp export becomes a compat contract.

Now that the views exist end-to-end, this plan closes the loop.

## Known seams to resolve before the lift

- **ActivationFlow.AmountPicker state duplication**: the primitive creates its own useTopupAmountSelector instance, so the AmountPicker in an inline activation-topup cannot share state with the ActivationFlow retry logic. The example works around this by punting usage-based activation to the open_topup view. The SDK lift should not ship with this workaround baked in.
- **AmountPicker / TopupForm unit mismatch**: `AmountPicker` works in major units (dollars), `TopupForm.Root` and `useTopup` expect minor units (cents). Every example — including our MCP app — has to do `Math.round(amount * 100)` in the onConfirm handler. Either normalize on one unit across the SDK, or ship an `AmountPicker.Confirm` variant that emits minor units. Shipping the lifted `McpTopup` primitive without resolving this means every integrator hits the same 400 on their first top-up.
- **TopupForm PaymentIntent churn**: resolved in the example by a two-step "pick amount" → "confirm" gate. If the lifted McpTopup primitive inlines this gate, document it clearly; if it exposes the commit step as a prop, pick a single default.
- **LaunchCustomerPortalButton rendering**: it renders as an &lt;a&gt; tag, so consumers cannot nest a &lt;button&gt; inside it. The AccountView fix (style the anchor directly via className) should be the documented pattern.

## Out of scope

- Any new backend endpoints — transport tools stay on the example server.
- Virtual-tools (packages/server/src/virtual-tools.ts) — still hosted-MCP-Pay only.
- Host-integration helpers (createMcpAppAdapter, useStripeProbe) — these remain in example code.
