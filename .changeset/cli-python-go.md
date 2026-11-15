---
'@solvapay/init': minor
'solvapay': minor
'create-solvapay': minor
---

The CLI handles Python and Go projects.

- `solvapay init` detects the project's language (`go.mod`, `uv.lock`, `poetry.lock`, `pyproject.toml`, `requirements.txt`, `package.json`) before it touches anything, and installs the SDK exactly pinned with uv, Poetry or `go get`; for pip it prints the command. It no longer creates a `package.json` in a folder without one unless `--language ts` is passed: with no terminal, or `--yes`, a folder with no project files or files for two languages fails and names `--language`. New flags: `--language ts|python|go`, `--features mcp,agents,web`, `--preview`.
- `solvapay doctor` checks the SDK version in every language the project uses (npm, PyPI, the Go module proxy) and prints the exact upgrade command. A project with no SolvaPay SDK in any language now fails instead of passing with "nothing to check".
- New `solvapay verify <server url>`: the TypeScript template's contract checks, for a running MCP server in any language.
- `create-solvapay --type mcp --language python|go` scaffolds a from-scratch paid MCP server with one paid and one free tool, tests, `.env.example`, a Dockerfile and Dependabot. `--preview` pins the newest SDK previews (also for TypeScript, from npm's `preview` tag).
