---
'@solvapay/react': minor
---

Add a "Back to my account" link at the top of the MCP checkout
view's plan-selector step. Wired by `<McpAppShell>` whenever the
shell owns surface routing — so customers who reached the plan
picker by clicking `Pick a plan` / `See plans` on the account
view can return without losing the iframe. Mirrors the topup
view's existing back-link pattern.

- New optional `onBack?: () => void` prop on `<McpCheckoutView>`,
  forwarded through `<EmbeddedCheckout>` and
  `<CheckoutStateMachine>` to `<PlanStep>`.
- New `checkout.backToAccount` i18n key (default: "Back to my
  account"). The topup view's hard-coded back-link label is left
  alone for now; lifting it into the same key is a follow-up
  cleanup that pulls in the rest of the topup view's strings at
  the same time.
