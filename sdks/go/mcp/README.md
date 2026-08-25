# solvapay-mcp (Go)

Payable MCP adapter over the official [`mcp`](https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk/mcp) package.
Layer 3 is hand-written Go. Paywall copy and compact `respond` text come from the
SolvaPay layer-2 WASM guest — never from adapter-authored strings.

Import this package as `github.com/solvapay/solvapay-go/mcp`. Import the host SDK as:

```go
mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
```

The pinned host SDK is v1.3.1 (Go 1.23). v1.7.0+ requires Go 1.25.

## Host-model caveats

- `CallToolResult.IsError` uses `json:"isError,omitempty"`, so `false` is omitted on
  the wire. Treat absent-or-false as the allow/gate-success path; `isError: true`
  must still be present on handler failures.
- Go `map` keys marshal in sorted order. `ResponseContext.Respond` accepts
  `json.RawMessage` so fixture data (and Rust compact JSON) keep insertion order.
  Struct fields keep declaration order; `map[string]any` is sorted.

Register with the low-level `Server.AddTool` path (not generic `mcp.AddTool`) so
the adapter controls `Content` / `StructuredContent` / `IsError` byte-for-byte.

Normative contract: [`mcp-authoring-adapter-contract.md`](../../../docs/contributing/mcp-authoring-adapter-contract.md).

## Tests

```bash
cd sdks/go && go test -race ./mcp/...
```
