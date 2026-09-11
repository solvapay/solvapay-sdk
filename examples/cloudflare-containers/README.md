# Cloudflare Containers — Go weather + Ruby bitcoin MCP

Go and Ruby have no Workers path: `sdks/go` embeds a wasip1 core under wazero
(unrunnable nested on workerd), and Ruby has no Workers runtime. This example
fronts the **unmodified** servers:

- [`examples/go/weather-mcp`](../go/weather-mcp) (`-mode http`, port 3030)
- [`examples/ruby/bitcoin_analytics_mcp`](../ruby/bitcoin_analytics_mcp) (`--mode http`)

**Workers Paid is required.** Images are `linux/amd64`.

## Local vs deploy

| Command             | Worker                           | Public URL                               | Image                                      |
| ------------------- | -------------------------------- | ---------------------------------------- | ------------------------------------------ |
| `pnpm dev:go`       | local                            | `http://localhost:8787`                  | local Docker, no push                      |
| `pnpm dev:ruby`     | local                            | `http://localhost:8787`                  | local Docker, no push                      |
| `pnpm deploy:go`    | `solvapay-mcp-goldberg-go-dev`   | `https://mcp-go-dev.solvapay.app`   | built then **pushed** (example image only) |
| `pnpm deploy:ruby`  | `solvapay-mcp-goldberg-ruby-dev` | `https://mcp-ruby-dev.solvapay.app` | built then **pushed** (example image only) |

Named wrangler envs do **not** inherit top-level `vars`. Each `[env.go]` /
`[env.ruby]` block redeclares `vars`, `observability`, and a custom-domain
route. Real values come from `.env.go.dev` / `.env.ruby.dev` via the shared
`example-deploy` harness.

## Deploy (dev)

Images are `--platform=linux/amd64`. On an arm64 Mac they build under
emulation. The first Ruby image compiles the Magnus native extension plus
the Rust workspace — budget tens of minutes. Run a local
`docker buildx build --platform linux/amd64` to completion *before*
`wrangler deploy` if you want to catch failures early.

```bash
cd examples/cloudflare-containers
cp .env.go.dev.example .env.go.dev
cp .env.ruby.dev.example .env.ruby.dev
# fill sk_test_/sk_sandbox_ and a prd_… that exposes a `requests` meter

# One-time secrets (scoped per Worker)
pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY --env go
pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY --env ruby

pnpm preflight:go && pnpm deploy:go
pnpm preflight:ruby && pnpm deploy:ruby
```

Workers Paid is required. `wrangler deploy` pushes the image to Cloudflare's
registry — that is a deploy of this example image, not an SDK publish.

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
- `WEATHER_MCP_SOURCE=live` (Go container; Open-Meteo)
- `MCP_SOURCE=live` (Ruby container; mempool.space / btcnode)

```bash
cd examples/cloudflare-containers
npx wrangler secret put SOLVAPAY_SECRET_KEY --env go
npx wrangler dev --env go
```

Do not add a "Cloudflare Workers" (isolate wasm) example for these languages.
