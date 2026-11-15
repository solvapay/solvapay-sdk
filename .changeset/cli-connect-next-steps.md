---
'solvapay': patch
---

`solvapay connect` prints next steps an agent can run as they are: the command to run again names the preview CLI (`npx solvapay@preview`) when that is what is running, and quotes values such as a `--name` with spaces. Once connected with `--client claude`, it offers `launch` only when the merchant has a model API; for an MCP-only merchant it says to run the same command with `--add-mcp`.
