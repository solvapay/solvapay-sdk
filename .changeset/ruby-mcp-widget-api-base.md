---
'@solvapay/release-train': patch
---

The Ruby MCP engine now forwards `api_base_url`, `csp`, and `branding` into widget HTML and `mcpDispatch`, so widget CSP `connectDomains` includes the configured SolvaPay API origin.
