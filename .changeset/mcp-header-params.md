---
'create-solvapay': patch
---

Generated MCP tools send `in: header` parameters as request headers. Header params named `Accept`, `Content-Type`, `Authorization` or the upstream API key header are left out of the tool input, so the LLM can't supply or overwrite the credential. Parameters whose names aren't valid JavaScript identifiers (e.g. `page-size`, `X-Request-Id`) no longer generate invalid `input.["…"]` code.
