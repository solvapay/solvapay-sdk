---
'@solvapay/react': patch
---

Move `<MandateText>` below the submit button in the drop-in `<PaymentForm>`, checkout primitives, and MCP payment views (Stripe pattern). Integrators with snapshot tests over the default tree will see a DOM-order diff.
