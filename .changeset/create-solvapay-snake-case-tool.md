---
'create-solvapay': minor
---

`--tool-name` takes snake_case for TypeScript MCP servers, the MCP naming convention, and defaults to `hello_tool`. The name is used as-is for the file and the registered tool, and the generated function is `register<PascalCase>` (`generate_haiku` → `registerGenerateHaiku`), so no rename is needed after scaffolding. camelCase is still accepted.
