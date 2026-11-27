---
'@solvapay/init': patch
'solvapay': patch
---

`solvapay init` in a TypeScript project now ends with concrete next steps: how to load `.env`, the quick-start guide (or the MCP guide and `verify` with `--features mcp`), and `doctor`. `doctor` drops its `SOLVAPAY_DEBUG defaults` line, since an unset `SOLVAPAY_DEBUG` now means off everywhere in `@solvapay/server`.
