---
'@solvapay/python': patch
'@solvapay/go': patch
---

The generated API clients follow the platform: `SdkProductResponse` no longer has `balance` or `totalTransactions`. The platform drops both from every product response, and the 0.1.0 Python model required them, so `get_product` and the MCP bootstrap failed validation against the new API. Go read the missing fields as zero.
