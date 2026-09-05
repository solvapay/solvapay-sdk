---
'@solvapay/react': minor
---

Drop the MCP shell sidebar. Identity is a single provenance line (`{merchant} · Paying as {email}`). `McpSellerDetailsCard`, `McpCustomerDetailsCard`, and `hideDetailCards` are gone — use `McpProvenanceLine` if you were composing those cards yourself.
