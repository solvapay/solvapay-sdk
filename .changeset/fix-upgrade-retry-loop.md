---
"@solvapay/mcp-core": patch
"@solvapay/mcp": patch
"@solvapay/react": patch
---

Stop upgrade/topup intent tools from inviting model retries in default `ui` mode by including assistant-audience plan narration alongside the UI placeholder, rewriting the placeholder to confirm the panel is shown, and marking checkout/topup as idempotent for dedupe-aware hosts. Replace `<McpApp>`'s timer-based `waitForInitialToolResult` mount race with an event-driven flow keyed on `classifyHostEntry`: intent entries consume the host's one-shot opening `toolresult` via the live handler (no duplicate intent-tool call), while `other` entries fetch bootstrap once.

Add an idempotent `solvapay://bootstrap.json` MCP resource so widget remounts on hosts that scrub `structuredContent` (e.g. MCPJam) recover via `readServerResource` instead of replaying intent tools. Explicit refresh paths still use `fetchMcpBootstrap`.
