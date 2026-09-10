---
'@solvapay/server': minor
---

Declare `creditsPerMinorUnit` and `displayExchangeRate` on `PaywallStructuredContentSchema`. `buildPaywallGate` has been emitting both since the credit-peg work, but the Zod schema did not list them. `registerPayableTool` registers `z.union([outputSchema, PaywallStructuredContentSchema])` as a payable tool's `outputSchema`, and the MCP server publishes it with `io: 'output'`, which emits `additionalProperties: false`. Server-side validation uses Zod, which strips undeclared keys and passed; clients that validate `structuredContent` against the published JSON Schema rejected every gated call with "structured content does not match its output schema". Any paywalled tool whose customer hit a credit shortfall failed on those clients.
