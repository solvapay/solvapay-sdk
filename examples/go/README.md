# Go SDK examples

| Example                         | Description                                                  |
| ------------------------------- | ------------------------------------------------------------ |
| [`weather-mcp`](./weather-mcp/) | Paywalled Open-Meteo weather tools over stdio and HTTP OAuth |

Published consumers use `go get github.com/solvapay/solvapay-go`. The example modules under this tree keep a local `replace` so they build against the monorepo binding in CI.

## Test (CI-safe, offline)

```bash
cd examples/go/weather-mcp && go test ./...
```
