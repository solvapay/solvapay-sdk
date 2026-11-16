---
'create-solvapay': patch
---

A failed `npm install` now stops the scaffold with an error and a non-zero exit, as `uv sync` and `go mod tidy` already did for Python and Go. TypeScript MCP and next-auth0 projects used to print a warning, skip nothing, and finish with exit 0, leaving a project with no `node_modules` that looked complete.
