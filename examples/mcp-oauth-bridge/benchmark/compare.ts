import { parseArgs } from 'node:util'
import { performance } from 'node:perf_hooks'
import { McpClient } from './mcp-client'
import {
  computeAggregate,
  computeProxyBreakdown,
  computeStats,
  type ToolLatencyRecord,
  type ToolStats,
  type ProxyBreakdownStats,
} from './stats'

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    sdk: { type: 'string' },
    proxy: { type: 'string' },
    token: { type: 'string' },
    iterations: { type: 'string', default: '50' },
    warmup: { type: 'string', default: '5' },
    region: { type: 'string' },
  },
  strict: true,
})

const endpoints = [
  { key: 'baseline', url: values.baseline, label: 'Baseline (no paywall)' },
  { key: 'sdk', url: values.sdk, label: 'SDK Paywall' },
  { key: 'proxy', url: values.proxy, label: 'Hosted Proxy' },
].filter(e => e.url) as { key: string; url: string; label: string }[]

if (endpoints.length < 2 || !values.token) {
  console.error('Usage: tsx benchmark/compare.ts [options]')
  console.error('')
  console.error('Provide at least 2 of the 3 server endpoints:')
  console.error('  --baseline  Direct origin URL (no paywall)')
  console.error('  --sdk       SDK paywall URL')
  console.error('  --proxy     Hosted proxy URL')
  console.error('')
  console.error('Required:')
  console.error('  --token     Bearer token')
  console.error('')
  console.error('Options:')
  console.error('  --iterations  Number of iterations (default: 50)')
  console.error('  --warmup      Warmup iterations (default: 5)')
  console.error('  --region      Region label for the report')
  process.exit(1)
}

const tokenValue = values.token
const iterations = parseInt(values.iterations!, 10)
const warmup = parseInt(values.warmup!, 10)
const region = values.region

function extractTaskId(result: unknown): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any
    const content = r?.result?.content?.[0]?.text
    if (!content) return null
    const parsed = JSON.parse(content)
    return parsed?.task?.id ?? parsed?.tasks?.[0]?.id ?? null
  } catch {
    return null
  }
}

async function runIteration(
  client: McpClient,
  records: ToolLatencyRecord[],
  iterationNum: number,
) {
  const createResult = await client.callTool('create_task', {
    title: `Benchmark task ${iterationNum}`,
  })
  records.push({
    tool: 'create_task',
    latencyMs: createResult.latencyMs,
    proxySubrequestMs: createResult.proxyHeaders?.subrequestMs,
    proxyUpstreamMs: createResult.proxyHeaders?.upstreamResponseTime,
  })

  const taskId = extractTaskId(createResult)

  const listResult = await client.callTool('list_tasks', {})
  records.push({
    tool: 'list_tasks',
    latencyMs: listResult.latencyMs,
    proxySubrequestMs: listResult.proxyHeaders?.subrequestMs,
    proxyUpstreamMs: listResult.proxyHeaders?.upstreamResponseTime,
  })

  if (taskId) {
    const getResult = await client.callTool('get_task', { id: taskId })
    records.push({
      tool: 'get_task',
      latencyMs: getResult.latencyMs,
      proxySubrequestMs: getResult.proxyHeaders?.subrequestMs,
      proxyUpstreamMs: getResult.proxyHeaders?.upstreamResponseTime,
    })

    const deleteResult = await client.callTool('delete_task', { id: taskId })
    records.push({
      tool: 'delete_task',
      latencyMs: deleteResult.latencyMs,
      proxySubrequestMs: deleteResult.proxyHeaders?.subrequestMs,
      proxyUpstreamMs: deleteResult.proxyHeaders?.upstreamResponseTime,
    })
  }
}

interface EndpointResult {
  key: string
  label: string
  url: string
  stats: ToolStats[]
  aggregate: ToolStats
  proxyBreakdown: ProxyBreakdownStats | null
  totalTimeMs: number
}

async function benchmarkEndpoint(
  endpoint: { key: string; url: string; label: string },
): Promise<EndpointResult> {
  const client = new McpClient(endpoint.url, tokenValue)

  console.error(`\n[${endpoint.label}] Connecting to ${endpoint.url}...`)
  await client.initSession()

  if (warmup > 0) {
    console.error(`[${endpoint.label}] Warmup: ${warmup} iterations...`)
    const warmupRecords: ToolLatencyRecord[] = []
    for (let i = 0; i < warmup; i++) {
      await runIteration(client, warmupRecords, i)
    }
  }

  console.error(`[${endpoint.label}] Benchmark: ${iterations} iterations...`)
  const records: ToolLatencyRecord[] = []
  const start = performance.now()

  for (let i = 0; i < iterations; i++) {
    await runIteration(client, records, i + warmup)
    if ((i + 1) % 10 === 0) {
      console.error(`[${endpoint.label}]   ${i + 1}/${iterations}`)
    }
  }

  const totalTimeMs = performance.now() - start
  await client.closeSession()

  return {
    key: endpoint.key,
    label: endpoint.label,
    url: endpoint.url,
    stats: computeStats(records),
    aggregate: computeAggregate(records),
    proxyBreakdown: computeProxyBreakdown(records),
    totalTimeMs,
  }
}

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals)
}

function formatOverhead(value: number, baseline: number): string {
  const diff = value - baseline
  return `${fmt(value)} (+${fmt(diff)})`
}

function formatComparisonReport(results: EndpointResult[]): string {
  const baselineResult = results.find(r => r.key === 'baseline')
  const toolNames = results[0].stats.map(s => s.tool)

  const lines: string[] = [
    '## Paywall Overhead Comparison',
    '',
    `- **Date:** ${new Date().toISOString()}`,
  ]

  if (region) {
    lines.push(`- **Region:** ${region}`)
  }

  lines.push(`- **Iterations:** ${iterations} (warmup: ${warmup})`)

  for (const r of results) {
    lines.push(`- **${r.label}:** \`${r.url}\``)
  }

  // Per-tool mean latency comparison
  lines.push('', '### Per-Tool Mean Latency (ms)', '')

  const headers = ['Tool', ...results.map(r => r.label)]
  lines.push(`| ${headers.join(' | ')} |`)
  lines.push(`| ${headers.map(() => '------').join(' | ')} |`)

  for (const toolName of toolNames) {
    const cells = [toolName]
    const baselineStat = baselineResult?.stats.find(s => s.tool === toolName)

    for (const r of results) {
      const stat = r.stats.find(s => s.tool === toolName)
      if (!stat) {
        cells.push('-')
        continue
      }
      if (baselineStat && r.key !== 'baseline') {
        cells.push(formatOverhead(stat.mean, baselineStat.mean))
      } else {
        cells.push(fmt(stat.mean))
      }
    }

    lines.push(`| ${cells.join(' | ')} |`)
  }

  // Aggregate overhead
  lines.push('', '### Aggregate Overhead' + (baselineResult ? ' vs Baseline' : ''), '')

  if (baselineResult) {
    const overheadEndpoints = results.filter(r => r.key !== 'baseline')
    const aggHeaders = ['Metric', ...overheadEndpoints.map(r => r.label)]
    lines.push(`| ${aggHeaders.join(' | ')} |`)
    lines.push(`| ${aggHeaders.map(() => '------').join(' | ')} |`)

    const metrics: [string, (s: ToolStats) => number][] = [
      ['Mean overhead/call', s => s.mean],
      ['p50 overhead/call', s => s.p50],
      ['p95 overhead/call', s => s.p95],
      ['p99 overhead/call', s => s.p99],
    ]

    for (const [metricName, getter] of metrics) {
      const cells = [metricName]
      for (const r of overheadEndpoints) {
        const diff = getter(r.aggregate) - getter(baselineResult.aggregate)
        cells.push(`+${fmt(diff)}ms`)
      }
      lines.push(`| ${cells.join(' | ')} |`)
    }
  } else {
    const aggHeaders = ['Metric', ...results.map(r => r.label)]
    lines.push(`| ${aggHeaders.join(' | ')} |`)
    lines.push(`| ${aggHeaders.map(() => '------').join(' | ')} |`)

    for (const metric of ['mean', 'p50', 'p95', 'p99'] as const) {
      const cells = [metric.toUpperCase()]
      for (const r of results) {
        cells.push(`${fmt(r.aggregate[metric])}ms`)
      }
      lines.push(`| ${cells.join(' | ')} |`)
    }
  }

  // Proxy breakdown (if any endpoint has it)
  const proxyResult = results.find(r => r.proxyBreakdown)
  if (proxyResult?.proxyBreakdown) {
    const bd = proxyResult.proxyBreakdown
    lines.push(
      '',
      `### Proxy Breakdown (${proxyResult.label})`,
      '',
      '| Metric | Mean | p50 | p95 |',
      '|--------|------|-----|-----|',
      `| Backend subrequest | ${fmt(bd.subrequest.mean)}ms | ${fmt(bd.subrequest.p50)}ms | ${fmt(bd.subrequest.p95)}ms |`,
      `| Origin upstream | ${fmt(bd.upstream.mean)}ms | ${fmt(bd.upstream.p50)}ms | ${fmt(bd.upstream.p95)}ms |`,
    )
  }

  lines.push('')
  return lines.join('\n')
}

async function main() {
  console.error('=== SolvaPay Paywall Overhead Comparison ===')
  console.error(`Endpoints: ${endpoints.map(e => e.label).join(', ')}`)
  console.error(`Iterations: ${iterations} (warmup: ${warmup})`)

  const results: EndpointResult[] = []
  for (const endpoint of endpoints) {
    const result = await benchmarkEndpoint(endpoint)
    results.push(result)
    console.error(
      `[${endpoint.label}] Done: mean=${fmt(result.aggregate.mean)}ms, p95=${fmt(result.aggregate.p95)}ms`,
    )
  }

  process.stdout.write(formatComparisonReport(results))
}

main().catch(err => {
  console.error('Comparison failed:', err)
  process.exit(1)
})
