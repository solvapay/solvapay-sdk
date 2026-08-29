# Go SDK — weather MCP

Paywalled MCP server that fetches live weather from [wttr.in](https://wttr.in/:help)
and gates each tool call through SolvaPay. Educational example only. Weather data
comes from wttr.in (no API key; rate-limited — send a descriptive User-Agent, which
this example does).

Pricing is not expressed in code. It lives on the SolvaPay product referenced by
`SOLVAPAY_PRODUCT`. Each tool call debits **1 unit** of the `requests` meter.

## Tools

| Tool                   | Input                    | What it returns                                                   |
| ---------------------- | ------------------------ | ----------------------------------------------------------------- |
| `get_current_weather`  | `city` (required string) | Current temperature C, condition, humidity, wind                  |
| `get_weather_forecast` | `city` (required string) | Three forecast days with min/max/avg C, sunrise/sunset, condition |

wttr.in j1 numerics arrive as JSON strings; the example decodes them into numbers
before returning structured content.

## Modes

| Mode                | Command                                            | Backend                                                                  |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| Demo (allow)        | `go run . --mode demo --city London`               | Mock SolvaPay + fixture wttr.in                                          |
| Demo (paywall)      | `go run . --mode demo --city London --gate`        | Mock SolvaPay paywall result                                             |
| Demo (live weather) | `go run . --mode demo --source live --city Berlin` | Mock SolvaPay + real wttr.in                                             |
| Stdio               | `go run . --mode serve`                            | Real SolvaPay; customer from `customer_ref`                              |
| HTTP                | `./scripts/http.sh` or `./scripts/tunnel.sh`       | Real SolvaPay; customer from the OAuth bearer (no `GetCustomerRef` hook) |

## Env

Copy `.env.example` to `.env`.

| Variable                | Required for    | Notes                                                                                                              |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SOLVAPAY_SECRET_KEY`   | `serve`, `http` | Sandbox secret. Never ship to a client.                                                                            |
| `SOLVAPAY_PRODUCT`      | `serve`, `http` | Product ref that owns pricing                                                                                      |
| `SOLVAPAY_API_BASE_URL` | optional        | Defaults to the SDK production API                                                                                 |
| `MCP_HOST` / `MCP_PORT` | `http`          | Defaults `127.0.0.1` / `3030` (same reserved `appmcp` origin as Python stock-research; only one process at a time) |
| `MCP_PUBLIC_BASE_URL`   | `http`          | HTTPS origin, no trailing slash, no path. Must match the tunnel.                                                   |
| `WEATHER_MCP_NGROK_URL` | `tunnel.sh`     | Reserved HTTPS origin for ngrok                                                                                    |
| `WEATHER_MCP_SOURCE`    | optional        | `live` or `fixture`                                                                                                |

## Offline test

```bash
cd examples/go/weather-mcp
go test ./...
```

## Connect from MCPJam

1. `cp .env.example .env` and set `SOLVAPAY_SECRET_KEY`, `SOLVAPAY_PRODUCT`, and
   `MCP_PUBLIC_BASE_URL` to your reserved HTTPS origin.
2. Start the tunnel: `./scripts/tunnel.sh`.
3. In MCPJam, add server URL `https://appmcp.jack-local.ngrok.app/mcp`.
4. `tools/list` works without a bearer (`authMode` is `tools-call`).
5. The first `get_current_weather` call triggers OAuth (DCR + authorize + token).
6. A customer without entitlement gets a `payment_required` result (`isError` is
   false) with a checkout link.
7. After checkout, the same call returns live wttr.in data and debits 1 unit.

Local-only (no tunnel): `./scripts/http.sh`, then point a client at
`http://127.0.0.1:3030/mcp`. Discovery documents still use `MCP_PUBLIC_BASE_URL`,
so OAuth against a real host will fail until that origin matches.

## Troubleshooting

| Symptom                   | Likely cause                                                                                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tools list but calls hang | Browser CORS / missing `OPTIONS` preflight. This example wraps `NewStreamableHandler` with `withCORS`. Confirm `curl -i -X OPTIONS localhost:3030/mcp -H 'Origin: http://localhost:6274'` returns 204 and `Access-Control-Allow-Origin`. |
| OAuth handshake loops     | `MCP_PUBLIC_BASE_URL` does not match the tunnel origin (trailing slash, `http://`, or a path). The process logs the resolved origin on startup.                                                                                          |
| DCR 4xx                   | Wrong or unpublished `SOLVAPAY_PRODUCT`.                                                                                                                                                                                                 |
| `GET /mcp` is 405         | Intended. Streamable-HTTP clients probe GET; a 400 would drop them.                                                                                                                                                                      |
| wttr.in 404               | Unknown city. The example fails loudly — it does not fall back to the fixture.                                                                                                                                                           |
