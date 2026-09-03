---
'@solvapay/mcp-core': patch
---

Stamp `_meta["openai/visibility"] = "private"` on UI-only transport tools so ChatGPT does not put them in the model's tool list. The iframe can still call them via `openai/widgetAccessible`.
