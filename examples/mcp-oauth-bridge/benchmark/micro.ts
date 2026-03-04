import { parseArgs } from 'node:util'
import { performance } from 'node:perf_hooks'
import { McpClient } from './mcp-client'
import {
  computeAggregate,
  computeProxyBreakdown,
  computeStats,
  formatMicroReport,
  type ToolLatencyRecord,
} from './stats'

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    token: { type: 'string' },
    iterations: { type: 'string', default: '50' },
    warmup: { type: 'string', default: '5' },
    label: { type: 'string' },
  },
  strict: true,
})

if (!values.url || !values.token) {
  console.error('Usage: tsx benchmark/micro.ts --url <server-url> --token <bearer-token> [options]')
  console.error('')
  console.error('Options:')
  console.error('  --url         MCP server URL (required)')
  console.error('  --token       Bearer token (required)')
  console.error('  --iterations  Number of iterations (default: 50)')
  console.error('  --warmup      Warmup iterations (default: 5)')
  console.error('  --label       Label for the report (e.g., "SDK Paywall", "Hosted Proxy")')
  process.exit(1)
}

const serverUrl = values.url
const token = values.token
const iterations = parseInt(values.iterations!, 10)
const warmup = parseInt(values.warmup!, 10)
const label = values.label

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
    description: `Created by benchmark iteration ${iterationNum}`,
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

async function main() {
  const client = new McpClient(serverUrl, token)

  console.error(`Connecting to ${serverUrl}...`)
  const { latencyMs: initLatency } = await client.initSession()
  console.error(`Session initialized in ${initLatency.toFixed(0)}ms`)

  // Warmup phase
  if (warmup > 0) {
    console.error(`Running ${warmup} warmup iterations...`)
    const warmupRecords: ToolLatencyRecord[] = []
    for (let i = 0; i < warmup; i++) {
      await runIteration(client, warmupRecords, i)
    }
    console.error(`Warmup complete`)
  }

  // Benchmark phase
  console.error(`Running ${iterations} benchmark iterations...`)
  const records: ToolLatencyRecord[] = []
  const benchStart = performance.now()

  for (let i = 0; i < iterations; i++) {
    await runIteration(client, records, i + warmup)
    if ((i + 1) % 10 === 0) {
      console.error(`  ${i + 1}/${iterations} iterations complete`)
    }
  }

  const totalTimeMs = performance.now() - benchStart
  console.error(`Benchmark complete in ${(totalTimeMs / 1000).toFixed(2)}s`)

  await client.closeSession()

  // Compute and output results
  const stats = computeStats(records)
  const aggregate = computeAggregate(records)
  const proxyBreakdown = computeProxyBreakdown(records)

  const report = formatMicroReport(
    { serverUrl, iterations, warmup, label },
    stats,
    aggregate,
    totalTimeMs,
    proxyBreakdown,
  )

  // Markdown output to stdout (progress went to stderr)
  process.stdout.write(report)
}

main().catch(err => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
