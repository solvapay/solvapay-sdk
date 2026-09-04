# Go SDK — weather MCP

Paywalled MCP server that fetches weather from [Open-Meteo](https://open-meteo.com/)
and gates each tool call through SolvaPay. Educational example only. Every tool
geocodes the `city` string first, then calls the forecast, air-quality, or archive
API. Open-Meteo needs no API key. Weather data is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
— attribute Open-Meteo if you reuse this example in a public product.

Pricing is not expressed in code. It lives on the SolvaPay product referenced by
`SOLVAPAY_PRODUCT`. Each tool call debits **1 unit** of the `requests` meter.

## Tools

| Tool                     | Input                                           | What it returns                                                                                  |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `get_current_weather`    | `city`                                          | Temperature, apparent temperature, humidity, wind, precipitation, cloud cover, is-day, condition |
| `get_weather_forecast`   | `city`, `days?` (1–16, default 3)               | Daily min/max/apparent, precipitation, sunrise/sunset, UV index, max wind, condition             |
| `get_hourly_forecast`    | `city`, `hours?` (1–48, default 12)             | Hourly temperature, precipitation probability, wind, condition                                   |
| `get_air_quality`        | `city`                                          | European and US AQI, PM10, PM2.5, ozone, NO2, category label                                     |
| `compare_cities`         | `cities` (2–5 names)                            | Current conditions side by side; one unresolvable city is reported per-row                       |
| `get_historical_weather` | `city`, `start_date`, `end_date` (`yyyy-mm-dd`) | Daily archive aggregates                                                                         |

`--mode serve` and `--mode http` both build through `solvapaymcp.NewServer`, so
they expose the SolvaPay intent tools (`upgrade`, `manage_account`, `topup`,
`activate_plan`) plus prompts and the paywall widget next to the weather tools.

## Modes

| Mode                | Command                                            | Backend                                                                  |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| Demo (allow)        | `go run . --mode demo --city London`               | Mock SolvaPay + Open-Meteo fixtures                                      |
| Demo (paywall)      | `go run . --mode demo --city London --gate`        | Mock SolvaPay paywall result                                             |
| Demo (live weather) | `go run . --mode demo --source live --city Berlin` | Mock SolvaPay + live Open-Meteo                                          |
| Stdio               | `go run . --mode serve`                            | Real SolvaPay; customer from `customer_ref`; needs `MCP_PUBLIC_BASE_URL` |
| HTTP                | `./scripts/http.sh` or `./scripts/tunnel.sh`       | Real SolvaPay; customer from the OAuth bearer (no `GetCustomerRef` hook) |

## Env

Copy `.env.example` to `.env`.

| Variable                | Required for    | Notes                                                                                                              |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SOLVAPAY_SECRET_KEY`   | `serve`, `http` | Sandbox secret. Never ship to a client.                                                                            |
| `SOLVAPAY_PRODUCT`      | `serve`, `http` | Product ref that owns pricing                                                                                      |
| `SOLVAPAY_API_BASE_URL` | optional        | Defaults to the local platform proxy (`http://localhost:3010`)                                                     |
| `MCP_HOST` / `MCP_PORT` | `http`          | Defaults `127.0.0.1` / `3030` (same reserved `appmcp` origin as Python stock-research; only one process at a time) |
| `MCP_PUBLIC_BASE_URL`   | `serve`, `http` | HTTPS origin, no trailing slash, no path. Checkout and widget URLs are built from it.                              |
| `WEATHER_MCP_NGROK_URL` | `tunnel.sh`     | Reserved HTTPS origin for ngrok                                                                                    |
| `WEATHER_MCP_SOURCE`    | optional        | `live` (Open-Meteo) or `fixture` (offline London snapshots)                                                        |

## Offline test

```bash
cd examples/go/weather-mcp
go test ./...
```

## Connect from MCPJam

1. `cp .env.example .env` and set `SOLVAPAY_SECRET_KEY`, `SOLVAPAY_PRODUCT`, and
   `MCP_PUBLIC_BASE_URL` to your reserved HTTPS origin.
2. Start the tunnel: `./scripts/tunnel.sh`.
3. In MCPJam, add server URL `https://appmcp.<your-subdomain>.ngrok.app/mcp`.
4. `tools/list` works without a bearer (`authMode` is `tools-call`).
5. The first `get_current_weather` call triggers OAuth (DCR + authorize + token).
6. A customer without entitlement gets a `payment_required` result (`isError` is
   false) with a checkout link.
7. After checkout, the same call returns live Open-Meteo data and debits 1 unit.

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
| Unknown city              | Open-Meteo geocoding returned no results. The example fails loudly — it does not fall back to the fixture.                                                                                                                               |
