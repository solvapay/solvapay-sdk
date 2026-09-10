# Cloudflare Containers — Go weather + Ruby bitcoin MCP

Go and Ruby have no Workers path: `sdks/go` embeds a wasip1 core under wazero
(unrunnable nested on workerd), and Ruby has no Workers runtime. This example
fronts the **unmodified** servers:

- [`examples/go/weather-mcp`](../go/weather-mcp) (`-mode http`, port 3030)
- [`examples/ruby/bitcoin_analytics_mcp`](../ruby/bitcoin_analytics_mcp) (`--mode http`)

**Workers Paid is required.** Images are `linux/amd64`.

## Local vs deploy

| Command                                          | Image                                           | Registry                                |
| ------------------------------------------------ | ----------------------------------------------- | --------------------------------------- |
| `pnpm dev:go` / `pnpm dev:ruby` (`wrangler dev`) | local Docker                                    | no push                                 |
| `pnpm deploy:go` / `pnpm deploy:ruby`            | built, then **pushed** to Cloudflare's registry | example image only — not an SDK publish |

## Build context

Must be the **repository root**. The Go module has

`replace github.com/solvapay/solvapay-sdk/sdks/go => ../../../sdks/go`

and `sdks/go/solvapay.go` `//go:embed`s `solvapay_core.wasm` (built in the
image). Ruby `require "solvapay"` is the local Magnus gem, compiled in the
image from `sdks/ruby`.

`wrangler.jsonc` sets `image_build_context` to `../..`.

## Env

Forwarded into the container (`MCP_HOST=0.0.0.0` so the proxy can reach the
process):

- `SOLVAPAY_SECRET_KEY` (secret)
- `SOLVAPAY_PRODUCT` (Go and Ruby both use this name)
- `MCP_PUBLIC_BASE_URL` (Go requires `https` origin, no path)
- optional `SOLVAPAY_API_BASE_URL`

```bash
cd examples/cloudflare-containers
npx wrangler secret put SOLVAPAY_SECRET_KEY --env go
npx wrangler dev --env go
```

Do not add a "Cloudflare Workers" (isolate wasm) example for these languages.
