---
'@solvapay/mcp-core': patch
'@solvapay/server': patch
---

Move duplicated MCP/descriptor/topup policy into the Rust core. Payable-path `trackUsage` now posts the driver-rendered body, so TypeScript `metadata.action` is the configured meter name instead of the literal `requests`. `processTopupPaymentIntentCore` is a host loop over `topupProcessNext` (behavior-preserving).
