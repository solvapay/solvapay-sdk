---
'solvapay': minor
---

`solvapay connect <merchant> --client claude --add-mcp` adds the merchant's MCP server to Claude Code at user scope once the owner approves, paying with the agent key. Claude Code reads the key through a `headersHelper` on each connection, so it never goes into Claude's config. On a merchant already connected, `--add-mcp` adds the server without asking the owner again.
