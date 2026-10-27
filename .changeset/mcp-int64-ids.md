---
'create-solvapay': patch
---

Generated MCP servers keep 64-bit integer IDs exact. `upstreamFetchJson` returns integers beyond `Number.MAX_SAFE_INTEGER` as exact decimal strings instead of rounding them, `int64` params get a schema that accepts a safe number or a digit string, and request bodies with integer properties are sent with the new `stringifyLossless` helper so those strings go back upstream as exact numbers.
