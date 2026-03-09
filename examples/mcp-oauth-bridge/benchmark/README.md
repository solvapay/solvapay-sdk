# MCP Paywall Benchmark

Measures the latency overhead that SolvaPay's paywall adds to MCP tool calls. Tests the **SDK-integrated paywall** (`@solvapay/server` + `payable.mcp()`) and the **hosted MCP proxy** (SolvaPay-managed reverse proxy with policy gate).

All scripts output markdown to stdout, ready to paste into documentation.

## Prerequisites

- Node.js 20+
- `tsx` (already a dev dependency)
- A deployed MCP server (with and/or without paywall enabled)
- `ANTHROPIC_API_KEY` env var (for `agent.ts` and `agent-compare.ts`)

## Quick Start

```bash
cd examples/mcp-oauth-bridge

# Micro-benchmark a single server
tsx benchmark/micro.ts \
  --url https://mcp.example.com \
  --token $TOKEN \
  --iterations 50

# Single-server agent benchmark
ANTHROPIC_API_KEY=sk-... tsx benchmark/agent.ts \
  --url https://mcp.example.com \
  --token $TOKEN \
  --runs 3

# Compare baseline vs SDK:
ANTHROPIC_API_KEY=sk-... tsx benchmark/agent-compare.ts \
  --baseline https://baseline.run.app \
  --sdk https://sdk.run.app \
  --runs 3 --region us-central1

# Compare baseline vs hosted proxy:
ANTHROPIC_API_KEY=sk-... tsx benchmark/agent-compare.ts \
  --baseline https://baseline.run.app \
  --proxy https://proxy.solvapay.com \
  --runs 3 --region us-central1

# 3-way comparison:
ANTHROPIC_API_KEY=sk-... tsx benchmark/agent-compare.ts \
  --baseline https://baseline.run.app \
  --sdk https://sdk.run.app \
  --proxy https://proxy.solvapay.com \
  --runs 3 --region us-central1 \
  > results.md
```

## Scripts

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `micro.ts` | Deterministic per-tool latency measurement | `--url`, `--token`, `--iterations`, `--warmup`, `--label` |
| `agent.ts` | Real LLM agent end-to-end measurement | `--url`, `--token`, `--runs`, `--model`, `--label` |
| `agent-compare.ts` | Side-by-side agent comparison (2 or 3-way) | `--baseline`, `--sdk`, `--proxy`, `--runs`, `--region` |

### micro.ts

Runs a deterministic CRUD sequence per iteration: `create_task` → `list_tasks` → `get_task` → `delete_task`. Measures each call individually.

- Progress goes to stderr, markdown results to stdout
- Includes a warmup phase (default 5 iterations) to prime caches
- Reports per-tool stats (mean, p50, p95, p99, min, max) and aggregate stats

### agent.ts

Uses Claude to execute a realistic task management scenario. Measures tool call latency separately from LLM inference time.

- Discovers tools from the server automatically
- Runs multiple independent agent runs for statistical significance
- Reports per-run breakdown (tool time vs LLM time vs wall time) and aggregate tool latency

### agent-compare.ts

Runs agent benchmarks against 2 or 3 endpoints and produces a comparison report with overhead deltas. Accepts any combination of:

- `--baseline` — direct origin server (no paywall, no proxy)
- `--sdk` — origin server with SDK-integrated paywall
- `--proxy` — origin behind SolvaPay's hosted proxy

OAuth tokens are acquired interactively for SDK and proxy endpoints (no flags needed).

When `--baseline` is provided, overhead is shown as deltas from baseline for each non-baseline endpoint.

## Deployment Setup

To run a meaningful comparison, deploy three endpoints in the same region:

1. **Baseline** — `mcp-oauth-bridge` with `PAYWALL_ENABLED=false`
2. **SDK Paywall** — `mcp-oauth-bridge` with `PAYWALL_ENABLED=true` (needs `SOLVAPAY_SECRET_KEY`, `SOLVAPAY_PRODUCT_REF`, `SOLVAPAY_API_BASE_URL`)
3. **Hosted Proxy** — register the baseline server in the SolvaPay Console; the proxy URL is `https://<subdomain>.solvapay.com`

All three should use the same underlying task CRUD logic and share the same auth setup.

## Proxy Breakdown Headers

When benchmarking the hosted proxy, the nginx config can expose timing headers:

- `X-Subrequest-Ms` — time spent on the backend policy check (auth, purchase verification, usage recording)
- `X-Upstream-Response-Time` — time spent waiting for the origin MCP server

The benchmark scripts automatically capture these when present.

## Interpreting Results

- **Mean overhead per call** is the primary metric — it tells you how much latency the paywall adds on average.
- **p95/p99** show tail latency, useful for understanding worst-case user experience.
- **Proxy breakdown** helps identify whether overhead comes from the policy check or the extra network hop.
- For the SDK paywall, the first call in a session is slower (customer lookup not yet cached). Subsequent calls benefit from caching.
- A well-configured same-region setup should show ~20-40ms overhead for the SDK paywall and ~30-50ms for the hosted proxy.
