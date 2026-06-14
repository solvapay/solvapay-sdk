---
"@solvapay/mcp-core": patch
---

Stop upgrade/topup intent tools from inviting model retries in default `ui` mode by including assistant-audience plan narration alongside the UI placeholder, rewriting the placeholder to confirm the panel is shown, and marking checkout/topup as idempotent for dedupe-aware hosts.
