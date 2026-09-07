---
'@solvapay/react': minor
'create-solvapay': patch
---

Unify MCP commerce surfaces and ship the v3 account widget (states A–J).

**Layout and chrome.** One layout law across checkout, top-up, and account: primary content leads, seller and your-account trails, identity rail visible at every width. `<McpApp>` reads host `displayMode` and advertises `inline` + `fullscreen`. Inline chrome is a centered `36rem` block; fullscreen is a hosted 1000px column (340 payment / 300 management rails) that falls back to the stacked widget under 1000px host width. Drop the shell sidebar — identity moves to `McpPayingAs` inside the payment form. Blend the widget into the host canvas (transparent root, hairline card, `color-scheme` meta in scaffolder and examples).

**Account widget.** StatusPill, FactBand, and UsageMeter (warning at 80%, critical at 100%) with v3 usage captions. Route each plan family through its own panel; ladder rows use per-row Activate/Switch (in-place when no payment, checkout when payment is required). Fullscreen extras: plan consequence lines, credit-activity and charges tables, merchant/buyer footer. Dedicated auto-recharge view from the account panel; shared fields in top-up. Seed bootstrap `limits` into `useLimits`/`useUsage`. `useHistory` fetches charges and credit activity on section mount.

**Checkout and payment.** Theme Stripe Payment Element from `--solvapay-*` tokens; tabs layout by default. Own billing country in the widget (not PaymentElement). Move mandate text below the pay button. Remove decorative save-card checkbox on PAYG; pass deferred auto-recharge into top-up so the card is saved for off-session reuse. `planPricingShape` so usage-based $0 plans are not labelled Free and one-time vs monthly render correctly.

**Links and polish.** Outbound links route through host `ui/open-link` when `openLinks` is declared (`useExternalLinkClick`, `useOpenExternal`, `<ExternalLinkProvider>`; `<McpApp>` mounts automatically). Drop fullscreen `CloseButton` export — host owns window chrome. Portal history links render as text; shell centres at 1144px. Seller-card email/support render as plain text (no iframe navigation).

**Breaking (MCP-only exports).** Removed `McpSellerDetailsCard`, `McpCustomerDetailsCard`, `McpAccountView.hideDetailCards`, `McpLimitReached`, and `CloseButton`. Turnkey `<McpApp>` integrators are unaffected; custom shells that imported these must migrate.

**Templates.** Example and `create-solvapay` pass `SOLVAPAY_MCP_APP_CAPABILITIES` into `new App()`.
