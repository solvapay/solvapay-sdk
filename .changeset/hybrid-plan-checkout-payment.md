---
'@solvapay/react': patch
---

A hybrid plan (a recurring fee plus metered usage, such as Basic at $19/month) now goes through card payment in the MCP checkout instead of the pay-as-you-go activation path. Pay-as-you-go activation also honours the backend status, so `payment_required` surfaces an error instead of a "Plan activated" receipt.
