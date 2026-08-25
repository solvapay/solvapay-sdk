# Go SDK — paid MCP

Runnable paywalled MCP tool against a mock backend.

```bash
cd examples/go/paid-mcp
go test ./...
go run . 
go run . --gate
```

This module uses a local `replace` of `github.com/solvapay/solvapay-go`.
