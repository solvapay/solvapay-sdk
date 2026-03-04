# MCP Paywall Benchmark

Measures the latency overhead that SolvaPay's paywall adds to MCP tool calls. Tests both the **SDK-integrated paywall** (`@solvapay/server` + `payable.mcp()`) and the **hosted MCP proxy** (nginx reverse proxy with backend policy gate).

All scripts output markdown to stdout, ready to paste into documentation.

## Prerequisites

- Node.js 20+
- `tsx` (already a dev dependency)
- A deployed MCP server (with and/or without paywall enabled)
- A valid bearer token for the server
- `ANTHROPIC_API_KEY` env var (only for `agent.ts`)

## Quick Start

```bash
# Run from the mcp-oauth-bridge directory
cd examples/mcp-oauth-bridge

# Micro-benchmark against a single server
tsx benchmark/micro.ts \
  --url https://mcp.example.com \
  --token $TOKEN \
  --iterations 50

# Save results to a file
tsx benchmark/micro.ts \
  --url https://mcp.example.com \
  --token $TOKEN \
  --label "SDK Paywall" \
  > results-sdk.md

# Agent benchmark (requires ANTHROPIC_API_KEY)
ANTHROPIC_API_KEY=sk-... tsx benchmark/agent.ts \
  --url https://mcp.example.com \
  --token $TOKEN \
  --runs 3

# Compare two or three endpoints
tsx benchmark/compare.ts \
  --baseline https://mcp-direct.example.com \
  --sdk https://mcp-sdk-paywall.example.com \
  --proxy https://myapp.solvapay.com \
  --token $TOKEN \
  --iterations 50 \
  --region "europe-west2" \
  > comparison.md
```

## Scripts

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `micro.ts` | Deterministic per-tool latency measurement | `--url`, `--token`, `--iterations`, `--warmup`, `--label` |
| `agent.ts` | Real LLM agent end-to-end measurement | `--url`, `--token`, `--runs`, `--model`, `--label` |
| `compare.ts` | Side-by-side comparison (2-way or 3-way) | `--baseline`, `--sdk`, `--proxy`, `--token`, `--iterations`, `--region` |

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

### compare.ts

Runs `micro.ts`-style benchmarks against multiple endpoints sequentially and produces a comparison table. Accepts any 2 or 3 of:

- `--baseline` — direct origin server (no paywall, no proxy)
- `--sdk` — origin server with SDK-integrated paywall
- `--proxy` — origin behind SolvaPay's hosted proxy

When `--baseline` is provided, overhead is shown as deltas from baseline.

## Output Format

All scripts output markdown suitable for documentation. Example comparison output:

```markdown
## Paywall Overhead Comparison

- **Date:** 2026-03-04T14:40:00Z
- **Region:** europe-west2
- **Iterations:** 50

### Per-Tool Mean Latency (ms)

| Tool | Baseline | SDK Paywall | Hosted Proxy |
|------|----------|-------------|--------------|
| create_task | 12.1 | 45.2 (+33.1) | 52.8 (+40.7) |
| list_tasks | 10.3 | 38.7 (+28.4) | 46.1 (+35.8) |
```

## Deployment Setup

To run a meaningful comparison, deploy three endpoints in the same region:

1. **Baseline** — `mcp-oauth-bridge` with `PAYWALL_ENABLED=false`
2. **SDK Paywall** — `mcp-oauth-bridge` with `PAYWALL_ENABLED=true` (needs `SOLVAPAY_SECRET_KEY`, `SOLVAPAY_PRODUCT_REF`, `SOLVAPAY_API_BASE_URL`)
3. **Hosted Proxy** — register the baseline server in the SolvaPay dashboard; the proxy URL is `https://<subdomain>.solvapay.com/mcp`

All three should use the same underlying task CRUD logic and share the same auth setup.

## Proxy Breakdown Headers

When benchmarking the hosted proxy, the nginx config can expose timing headers:

- `X-Subrequest-Ms` — time spent on the backend policy check (auth, purchase verification, usage recording)
- `X-Upstream-Response-Time` — time spent waiting for the origin MCP server

The benchmark scripts automatically capture these when present and include a "Proxy Breakdown" section in the output.

## Interpreting Results

- **Mean overhead per call** is the primary metric — it tells you how much latency the paywall adds on average.
- **p95/p99** show tail latency, useful for understanding worst-case user experience.
- **Proxy breakdown** helps identify whether overhead comes from the policy check or the extra network hop.
- For the SDK paywall, the first call in a session is slower (customer lookup not yet cached). Subsequent calls benefit from the 60-second customer cache.
- A well-configured same-region setup should show ~20-40ms overhead for the SDK paywall and ~30-50ms for the hosted proxy.
