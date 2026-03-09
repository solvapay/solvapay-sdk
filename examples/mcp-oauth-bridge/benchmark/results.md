## Agent Benchmark: Paywall Overhead Comparison

- **Date:** 2026-03-05T20:07:04.195Z
- **Model:** claude-sonnet-4-20250514
- **Runs per endpoint:** 1
- **Task:** Create 3 tasks, list all, get first, delete second
- **Region:** europe-west2
- **Hosted Proxy:** `https://mcphostedbenchmark.dev.solvapay.com`
- **SDK Paywall:** `https://mcp-benchmark-sdk-uzgmcnwmja-nw.a.run.app`
- **Baseline (no paywall):** `https://mcp-benchmark-baseline-uzgmcnwmja-nw.a.run.app`

### Per-Run Summary

| Endpoint | Run | Tool Calls | Tool Time | LLM Time | Wall Time |
|----------|-----|------------|-----------|----------|-----------|
| Hosted Proxy | 1 | 6 | 694.2ms | 12.96s | 13.67s |
| SDK Paywall | 1 | 6 | 346.2ms | 12.74s | 13.09s |
| Baseline (no paywall) | 1 | 6 | 284.7ms | 13.85s | 14.15s |

### Per-Tool Mean Latency (ms)

| Tool | Hosted Proxy | SDK Paywall | Baseline (no paywall) | Hosted Proxy Δ | SDK Paywall Δ |
| ------ | ------ | ------ | ------ | ------ | ------ |
| create_task | 137.8 | 68.7 | 46.8 | +91.0 | +21.9 |
| list_tasks | 97.4 | 46.0 | 48.7 | +48.7 | +-2.7 |
| get_task | 91.3 | 46.6 | 50.7 | +40.6 | +-4.1 |
| delete_task | 92.1 | 47.3 | 44.8 | +47.3 | +2.5 |

### Aggregate Tool Call Latency (ms)

| Metric | Hosted Proxy | SDK Paywall | Baseline (no paywall) | Hosted Proxy Δ | SDK Paywall Δ |
| ------ | ------ | ------ | ------ | ------ | ------ |
| Mean | 115.7 | 57.7 | 47.5 | +68.2 | +10.2 |
| p50 | 97.9 | 47.8 | 47.1 | +50.9 | +0.7 |
| p95 | 161.8 | 92.1 | 50.2 | +111.5 | +41.9 |
| p99 | 165.2 | 102.6 | 50.6 | +114.5 | +52.0 |
| Min | 91.3 | 46.0 | 44.8 | +46.5 | +1.2 |
| Max | 166.0 | 105.2 | 50.7 | +115.3 | +54.5 |

### End-to-End Impact

| Metric | Baseline | Hosted Proxy | SDK Paywall |
| -------- | -------- | -------- | -------- |
| Avg tool time/run | 284.7ms | 694.2ms (+409.5ms) | 346.2ms (+61.5ms) |
| Avg tool calls/run | 6.0 | 6.0 | 6.0 |
| Avg overhead/call | - | +68.2ms | +10.2ms |
