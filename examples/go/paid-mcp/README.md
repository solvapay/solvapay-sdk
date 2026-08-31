# Go SDK — paid MCP

Runnable paywalled MCP tool against a mock backend.

```bash
cd examples/go/paid-mcp
go test ./...
go run .
go run . --gate
```

This module uses a local `replace` of `github.com/solvapay/solvapay-go`.

This is an offline single-tool round-trip demo: a bare MCP server with
no SolvaPay intent tools. Do not copy it as a production server shape;
use `weather-mcp` or a TypeScript checkout example for the full
catalog.
