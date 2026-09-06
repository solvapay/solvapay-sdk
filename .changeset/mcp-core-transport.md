---
'@solvapay/mcp-core': patch
'@solvapay/mcp': patch
---

MCP core transport and narration for the account widget release.

Account text-mode narration branches on the nine v3 states (A–F, H–J) and reads `usage.total` / `remaining` / `periodEnd`. Add UI-only `get_history` tool descriptor; auto-recharge view narration. Single-source intent-tool names from `MCP_TOOL_NAMES`; trim duplicated description prose.

Stamp `_meta["openai/visibility"] = "private"` on UI-only transport tools so ChatGPT does not list them for the model. Make every tool result independently complete on `content[].text` (`dataInText` default on, embedded low-balance nudge, inline manage URL, named recovery calls). `registerPayable` accepts an opt-in `outputSchema`.

Pass billing-country fields through MCP attach/confirm helpers.
