# Go SDK examples

| Example                           | Description                                                              |
| --------------------------------- | ------------------------------------------------------------------------ |
| [`get-merchant`](./get-merchant/) | `Client.GetMerchant` with local `.env` (offline `httptest` test covered) |
| [`paid-mcp`](./paid-mcp/)         | Paywalled MCP tool (`solvapay-go/mcp`) against a mock backend            |
| [`weather-mcp`](./weather-mcp/)   | Paywalled Open-Meteo weather tools over stdio and HTTP OAuth             |

Published consumers use `go get github.com/solvapay/solvapay-go`. The example modules under this tree keep a local `replace` so they build against the monorepo binding in CI.

## Test (CI-safe, offline)

```bash
cd examples/go/get-merchant && go test ./...
cd examples/go/paid-mcp && go test ./...
cd examples/go/weather-mcp && go test ./...
```

## Live run (optional credentials)

```bash
cp examples/go/get-merchant/.env.example examples/go/get-merchant/.env
# Edit .env with your sandbox secret.
cd examples/go/get-merchant && go run .
```
