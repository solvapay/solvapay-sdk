---
"@solvapay/core": minor
"@solvapay/mcp-core": patch
"@solvapay/react": patch
---

Credit → fiat display helpers (`creditsToDisplayMinorUnits`, `minorUnitsPerMajor`, `isZeroDecimalCurrency`) now live in `@solvapay/core` so Next.js client components can import them without pulling the Node-only `@solvapay/mcp-core` server bundle. `@solvapay/mcp-core` re-exports the same symbols for backward compatibility.
