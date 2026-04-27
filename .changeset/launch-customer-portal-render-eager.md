---
'@solvapay/react': patch
---

`<LaunchCustomerPortalButton>` (and `<UpdatePaymentMethodButton>` which
wraps it) now render enabled and labelled from first paint, regardless
of session state. Multiple instances under the same `<SolvaPayProvider>`
share a single in-flight `transport.createCustomerSession()` fetch via
the new internal `useCustomerSessionUrl()` hook, so two buttons on the
same surface only round-trip once.

When the URL has resolved, click is a synchronous `<a target="_blank">`
navigation (which MCP host sandboxes permit). When the user clicks
before the URL has resolved, the handler awaits the shared in-flight
promise and falls back to `window.open` (works on hosts that don't
sandbox scripted opens, e.g. ChatGPT).

The disabled "Loading…" placeholder is removed. The `loadingClassName`
and `errorClassName` props are kept for back-compat but now apply only
as overlay classes during click-time pending / error states — they no
longer light up under the steady-state cache-hit path.

The MCP `manage_account` view (`<McpAccountView>`) now passes
`hideUpdatePaymentButton` to `<CurrentPlanCard>`, so the inline "Update
card" button no longer renders on that surface. Card updates flow
through the "Manage billing" customer-portal button instead. The
`<UpdatePaymentMethodButton>` component itself is unchanged and remains
exported for non-MCP surfaces.
