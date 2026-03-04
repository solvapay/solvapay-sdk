export interface ToolLatencyRecord {
  tool: string
  latencyMs: number
  proxySubrequestMs?: number
  proxyUpstreamMs?: number
}

export interface ToolStats {
  tool: string
  count: number
  mean: number
  p50: number
  p95: number
  p99: number
  min: number
  max: number
  stdDev: number
}

export interface ProxyBreakdownStats {
  subrequest: { mean: number; p50: number; p95: number }
  upstream: { mean: number; p50: number; p95: number }
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export function computeStats(records: ToolLatencyRecord[]): ToolStats[] {
  const byTool = new Map<string, number[]>()
  for (const r of records) {
    const arr = byTool.get(r.tool) ?? []
    arr.push(r.latencyMs)
    byTool.set(r.tool, arr)
  }

  const stats: ToolStats[] = []
  for (const [tool, latencies] of byTool) {
    const sorted = [...latencies].sort((a, b) => a - b)
    const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length
    const variance = latencies.reduce((sum, v) => sum + (v - mean) ** 2, 0) / latencies.length

    stats.push({
      tool,
      count: latencies.length,
      mean,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      stdDev: Math.sqrt(variance),
    })
  }

  return stats
}

export function computeAggregate(records: ToolLatencyRecord[]): ToolStats {
  const latencies = records.map(r => r.latencyMs)
  const sorted = [...latencies].sort((a, b) => a - b)
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length
  const variance = latencies.reduce((sum, v) => sum + (v - mean) ** 2, 0) / latencies.length

  return {
    tool: 'all',
    count: latencies.length,
    mean,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    stdDev: Math.sqrt(variance),
  }
}

export function computeProxyBreakdown(
  records: ToolLatencyRecord[],
): ProxyBreakdownStats | null {
  const subrequests = records.filter(r => r.proxySubrequestMs != null).map(r => r.proxySubrequestMs!)
  const upstreams = records.filter(r => r.proxyUpstreamMs != null).map(r => r.proxyUpstreamMs!)

  if (subrequests.length === 0 && upstreams.length === 0) return null

  const calcStats = (arr: number[]) => {
    if (arr.length === 0) return { mean: 0, p50: 0, p95: 0 }
    const sorted = [...arr].sort((a, b) => a - b)
    return {
      mean: arr.reduce((a, b) => a + b, 0) / arr.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
    }
  }

  return {
    subrequest: calcStats(subrequests),
    upstream: calcStats(upstreams),
  }
}

// ── Markdown formatting ───────────────────────────────────────────────

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals)
}

export function formatToolStatsTable(stats: ToolStats[]): string {
  const lines = [
    '| Tool | Mean | p50 | p95 | p99 | Min | Max |',
    '|------|------|-----|-----|-----|-----|-----|',
  ]
  for (const s of stats) {
    lines.push(
      `| ${s.tool} | ${fmt(s.mean)} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${fmt(s.min)} | ${fmt(s.max)} |`,
    )
  }
  return lines.join('\n')
}

export function formatAggregateTable(agg: ToolStats, totalTimeMs: number): string {
  return [
    '| Metric | Value |',
    '|--------|-------|',
    `| Total calls | ${agg.count} |`,
    `| Mean latency | ${fmt(agg.mean)}ms |`,
    `| p50 latency | ${fmt(agg.p50)}ms |`,
    `| p95 latency | ${fmt(agg.p95)}ms |`,
    `| p99 latency | ${fmt(agg.p99)}ms |`,
    `| Std dev | ${fmt(agg.stdDev)}ms |`,
    `| Total time | ${fmt(totalTimeMs / 1000, 2)}s |`,
  ].join('\n')
}

export function formatProxyBreakdownTable(breakdown: ProxyBreakdownStats): string {
  return [
    '| Metric | Mean | p50 | p95 |',
    '|--------|------|-----|-----|',
    `| Backend subrequest | ${fmt(breakdown.subrequest.mean)}ms | ${fmt(breakdown.subrequest.p50)}ms | ${fmt(breakdown.subrequest.p95)}ms |`,
    `| Origin upstream | ${fmt(breakdown.upstream.mean)}ms | ${fmt(breakdown.upstream.p50)}ms | ${fmt(breakdown.upstream.p95)}ms |`,
  ].join('\n')
}

export interface MicroBenchmarkConfig {
  serverUrl: string
  iterations: number
  warmup: number
  label?: string
}

export function formatMicroReport(
  config: MicroBenchmarkConfig,
  stats: ToolStats[],
  aggregate: ToolStats,
  totalTimeMs: number,
  proxyBreakdown: ProxyBreakdownStats | null,
): string {
  const lines: string[] = [
    `## Micro-Benchmark Results${config.label ? ` (${config.label})` : ''}`,
    '',
    `- **Server:** \`${config.serverUrl}\``,
    `- **Date:** ${new Date().toISOString()}`,
    `- **Iterations:** ${config.iterations} (warmup: ${config.warmup})`,
    '',
    '### Per-Tool Latency (ms)',
    '',
    formatToolStatsTable(stats),
    '',
    '### Aggregate',
    '',
    formatAggregateTable(aggregate, totalTimeMs),
  ]

  if (proxyBreakdown) {
    lines.push('', '### Proxy Breakdown', '', formatProxyBreakdownTable(proxyBreakdown))
  }

  lines.push('')
  return lines.join('\n')
}
