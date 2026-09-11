---
'@solvapay/react': patch
---

MCP checkout and top-up now always show plans and amounts. The Stripe CSP probe still starts at mount so Stripe.js can warm in the background, but a blocked or slow host only falls back to hosted checkout at the payment step — a cold Stripe.js load can no longer hide the plan picker. Passing `publishableKey={null}` keeps the same plan/amount steps and forces the hosted handoff only when the customer continues to pay.

A blocked host now costs one extra click (pick a plan or amount, then get the hosted handoff). The cancelled-purchase notice that lives inside the hosted fallback also appears at the payment step rather than immediately on the checkout surface.
