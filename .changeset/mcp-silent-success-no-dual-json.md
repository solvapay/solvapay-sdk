---
'@solvapay/mcp-core': patch
'@solvapay/server': patch
---

Silent payable MCP successes no longer dump the same JSON into both `content[0].text` and `structuredContent`. Default `ctx.respond(data)` and `payable().mcp()` object results now narrate `"Success"` in text and keep merchant data on `structuredContent`. Pass `dataInText: true` (or `options.text` / `nudge`) to still append a trailing JSON text block.
