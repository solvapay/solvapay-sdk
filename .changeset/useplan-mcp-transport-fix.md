---
'@solvapay/react': patch
---

Fix `usePlan` so it no longer fires a raw `fetch('/api/list-plans')` when an MCP transport is configured. The hook now routes through `defaultListPlans`, which is transport-aware and falls back to the seeded `plansCache` when the MCP adapter omits `listPlans` (the Phase 2c shape, where plans arrive in the bootstrap snapshot).

This was the second symptom on Goldberg's ChatGPT App: the iframe sandbox returned 404 for `/api/list-plans` because the MCP origin doesn't serve that route. New regression test in `usePlan.test.tsx` covers the iframe-sandbox 404 pattern, and `ActivationFlow.test.tsx` was updated to seed `plansCache` directly to match the production MCP bootstrap pattern.
