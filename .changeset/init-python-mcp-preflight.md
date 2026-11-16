---
'@solvapay/init': patch
'solvapay': patch
'create-solvapay': patch
---

`solvapay init` no longer breaks a Python MCP server that runs on `mcp` 1.x.

- With `--features mcp`, init reads `uv.lock`, `poetry.lock`, `pyproject.toml`, `requirements.txt` and the project's `.py` files before the browser opens. It stops, with nothing written, when `mcp` is locked below 2, a requirement rules out `mcp` 2.3, the project uses `fastapi-mcp`, or code imports `mcp.server.fastmcp` or `fastapi_mcp`. Installing `solvapay[mcp]` there used to upgrade `mcp` to 2.x and leave a server that couldn't start. The message names each cause and links the `mcp` 2.x migration guide and the SolvaPay MCP guide. A project on fastmcp gets a warning that SolvaPay has no fastmcp adapter.
- init saves the product to `.env` before installing the SDK, so a failed install leaves a complete `.env`.
- With `--features mcp` in Python and Go, init adds `PORT` and `PUBLIC_BASE_URL` to `.env` when they're missing (`8080`, as the scaffolds do), links the language's MCP guide in its next steps and prints `npx -y solvapay@latest` (or `@preview`) commands.
- `solvapay doctor` scans a Python project's `.py` files. An import of `mcp.server.fastmcp` or `fastapi_mcp` fails the run once the project is on `mcp` 2.x and only warns while it is still on 1.x. The `SOLVAPAY_DEBUG` warning now shows only for TypeScript projects.
