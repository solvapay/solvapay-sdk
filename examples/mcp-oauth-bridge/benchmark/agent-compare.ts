import { parseArgs } from 'node:util'
import { performance } from 'node:perf_hooks'
import { McpClient, type ToolCallResult } from './mcp-client'
import { acquireOAuthToken } from './oauth'
import { computeAggregate, computeStats, type ToolLatencyRecord, type ToolStats } from './stats'

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    sdk: { type: 'string' },
    proxy: { type: 'string' },
    runs: { type: 'string', default: '3' },
    model: { type: 'string', default: 'claude-sonnet-4-20250514' },
    region: { type: 'string' },
  },
  strict: true,
})

interface EndpointConfig {
  key: string
  url: string
  mcpUrl: string
  label: string
  token: string | null
}

function toBaseUrl(url: string): string {
  return url.replace(/\/$/, '').replace(/\/mcp$/, '')
}

function toMcpUrl(url: string): string {
  return `${toBaseUrl(url)}/mcp`
}

async function buildEndpoints(): Promise<EndpointConfig[]> {
  const endpoints: EndpointConfig[] = []

  const paywallEndpoints = [
    { key: 'proxy', url: values.proxy, label: 'Hosted Proxy' },
    { key: 'sdk', url: values.sdk, label: 'SDK Paywall' },
  ]

  for (const ep of paywallEndpoints) {
    if (!ep.url) continue
    const baseUrl = toBaseUrl(ep.url)
    console.error(`[OAuth] Acquiring token for ${ep.label}...`)
    const token = await acquireOAuthToken(baseUrl)
    console.error(`[OAuth] Token acquired for ${ep.label}`)
    endpoints.push({ key: ep.key, url: baseUrl, mcpUrl: toMcpUrl(ep.url), label: ep.label, token })
  }

  if (values.baseline) {
    endpoints.push({
      key: 'baseline',
      url: toBaseUrl(values.baseline),
      mcpUrl: toMcpUrl(values.baseline),
      label: 'Baseline (no paywall)',
      token: null,
    })
  }

  return endpoints
}

const endpointCount = [values.baseline, values.sdk, values.proxy].filter(Boolean).length
if (endpointCount < 2) {
  console.error('Usage: tsx benchmark/agent-compare.ts [options]')
  console.error('')
  console.error('Provide at least 2 of the 3 server endpoints:')
  console.error('  --baseline  Baseline MCP server URL (no paywall)')
  console.error('  --sdk       SDK paywall MCP server URL')
  console.error('  --proxy     Hosted proxy MCP server URL')
  console.error('')
  console.error('Options:')
  console.error('  --runs      Number of agent runs per endpoint (default: 3)')
  console.error('  --model     Anthropic model (default: claude-sonnet-4-20250514)')
  console.error('  --region    Region label for report')
  console.error('')
  console.error('OAuth tokens are acquired interactively for SDK and proxy endpoints.')
  console.error('Requires ANTHROPIC_API_KEY environment variable.')
  console.error('')
  console.error('Examples:')
  console.error('  ANTHROPIC_API_KEY=... tsx benchmark/agent-compare.ts \\')
  console.error('    --baseline https://baseline.run.app \\')
  console.error('    --sdk https://sdk.run.app')
  console.error('')
  console.error('  ANTHROPIC_API_KEY=... tsx benchmark/agent-compare.ts \\')
  console.error('    --baseline https://baseline.run.app \\')
  console.error('    --proxy https://proxy.solvapay.com')
  console.error('')
  console.error('  ANTHROPIC_API_KEY=... tsx benchmark/agent-compare.ts \\')
  console.error('    --baseline https://baseline.run.app \\')
  console.error('    --sdk https://sdk.run.app \\')
  console.error('    --proxy https://proxy.solvapay.com')
  process.exit(1)
}

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required')
  process.exit(1)
}

const runs = parseInt(values.runs!, 10)
const model = values.model!
const region = values.region

const TASK_PROMPT = `You are testing an MCP server's task management tools. Complete these steps in order:
1. Create 3 tasks with titles: "Plan sprint", "Review PRs", "Update docs"
2. List all tasks
3. Get details on the first task from the list
4. Delete the second task from the list

Use the available tools (create_task, list_tasks, get_task, delete_task) to complete each step. Do not skip any step.`

interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

interface AnthropicContentBlock {
  type: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  text?: string
  tool_use_id?: string
  content?: string
}

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface RunResult {
  toolCalls: number
  toolTimeMs: number
  llmTimeMs: number
  wallTimeMs: number
  records: ToolLatencyRecord[]
}

interface EndpointResult {
  key: string
  label: string
  url: string
  runs: RunResult[]
  allRecords: ToolLatencyRecord[]
  perToolStats: ToolStats[]
  aggregate: ToolStats
}

function extractToolResult(callResult: ToolCallResult): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = callResult.result as any
    const content = r?.result?.content?.[0]?.text
    return sanitizeForBenchmark(content ?? JSON.stringify(r?.result ?? r))
  } catch {
    return sanitizeForBenchmark(JSON.stringify(callResult.result))
  }
}

/**
 * Strip "MUST stop" / "do NOT attempt" directives from paywall responses so
 * the agent treats every endpoint's paywall identically and completes all
 * tool calls. Without this, the hosted proxy's aggressive instruction causes
 * Claude to halt after the first batch while the SDK's plain JSON error lets
 * it continue — making the comparison invalid.
 */
function sanitizeForBenchmark(text: string): string {
  return text.replace(/\*\*IMPORTANT INSTRUCTION FOR AI AGENT:\*\*[^]*$/, '').trim()
}

async function anthropicRequest(
  messages: AnthropicMessage[],
  tools: ToolDef[],
): Promise<{ content: AnthropicContentBlock[]; latencyMs: number }> {
  const start = performance.now()
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      tools,
      messages,
    }),
  })
  const latencyMs = performance.now() - start

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${text}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await response.json()) as any
  return { content: data.content as AnthropicContentBlock[], latencyMs }
}

async function runAgentTask(
  client: McpClient,
  tools: ToolDef[],
  label: string,
): Promise<RunResult> {
  const records: ToolLatencyRecord[] = []
  let toolTimeMs = 0
  let llmTimeMs = 0

  const messages: AnthropicMessage[] = [{ role: 'user', content: TASK_PROMPT }]
  const wallStart = performance.now()
  let turn = 0

  while (true) {
    turn++
    const { content, latencyMs: llmLatency } = await anthropicRequest(messages, tools)
    llmTimeMs += llmLatency

    const toolUseBlocks = content.filter(b => b.type === 'tool_use')

    if (toolUseBlocks.length === 0) {
      const textBlocks = content.filter(b => b.type === 'text')
      const stopText = textBlocks.map(b => b.text ?? '').join(' ').slice(0, 200)
      console.error(
        `[${label}]     turn=${turn} STOP (no tool_use). text: ${stopText || '(empty)'}`,
      )
      break
    }

    console.error(
      `[${label}]     turn=${turn} tools: ${toolUseBlocks.map(b => b.name).join(', ')}`,
    )

    messages.push({ role: 'assistant', content })

    const toolResults: AnthropicContentBlock[] = []
    for (const block of toolUseBlocks) {
      const toolName = block.name!
      const toolArgs = (block.input ?? {}) as Record<string, unknown>

      const callResult = await client.callTool(toolName, toolArgs)
      toolTimeMs += callResult.latencyMs

      records.push({
        tool: toolName,
        latencyMs: callResult.latencyMs,
        proxySubrequestMs: callResult.proxyHeaders?.subrequestMs,
        proxyUpstreamMs: callResult.proxyHeaders?.upstreamResponseTime,
      })

      const resultText = extractToolResult(callResult)
      console.error(
        `[${label}]       ${toolName} ${fmt(callResult.latencyMs)}ms → ${resultText.slice(0, 120)}`,
      )

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: resultText,
      })
    }

    messages.push({ role: 'user', content: toolResults })
  }

  return { toolCalls: records.length, toolTimeMs, llmTimeMs, wallTimeMs: performance.now() - wallStart, records }
}

async function benchmarkEndpoint(endpoint: EndpointConfig): Promise<EndpointResult> {
  const client = new McpClient(endpoint.mcpUrl, endpoint.token)

  console.error(`\n[${endpoint.label}] Connecting to ${endpoint.mcpUrl}...`)
  await client.initSession()

  const { tools: mcpTools } = await client.listTools()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: ToolDef[] = (mcpTools as any[])
    .filter(t => !['get_user_info', 'upgrade', 'manage_account'].includes(t.name))
    .map(t => ({
      name: t.name,
      description: t.description ?? '',
      input_schema: t.inputSchema ?? t.input_schema ?? { type: 'object', properties: {} },
    }))

  for (const t of tools) {
    const schemaKeys = Object.keys(t.input_schema)
    const hasType = 'type' in t.input_schema
    console.error(
      `[${endpoint.label}]   tool=${t.name} desc=${t.description.length}ch schema={keys:[${schemaKeys}], hasType:${hasType}}`,
    )
  }
  console.error(`[${endpoint.label}] Discovered ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`)

  const runResults: RunResult[] = []
  for (let i = 0; i < runs; i++) {
    console.error(`[${endpoint.label}]   Run ${i + 1}/${runs}...`)
    const result = await runAgentTask(client, tools, endpoint.label)
    runResults.push(result)
    console.error(
      `[${endpoint.label}]     ${result.toolCalls} calls, tool=${fmt(result.toolTimeMs)}ms, wall=${fmt(result.wallTimeMs / 1000, 2)}s`,
    )
  }

  await client.closeSession()

  const allRecords = runResults.flatMap(r => r.records)
  return {
    key: endpoint.key,
    label: endpoint.label,
    url: endpoint.url,
    runs: runResults,
    allRecords,
    perToolStats: computeStats(allRecords),
    aggregate: computeAggregate(allRecords),
  }
}

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals)
}

function formatReport(results: EndpointResult[]): string {
  const baseline = results.find(r => r.key === 'baseline')
  const nonBaseline = results.filter(r => r.key !== 'baseline')
  const toolNameSet = new Set<string>()
  for (const r of results) {
    for (const s of r.perToolStats) toolNameSet.add(s.tool)
  }
  const toolNames = [...toolNameSet]

  const lines: string[] = [
    '## Agent Benchmark: Paywall Overhead Comparison',
    '',
    `- **Date:** ${new Date().toISOString()}`,
    `- **Model:** ${model}`,
    `- **Runs per endpoint:** ${runs}`,
    `- **Task:** Create 3 tasks, list all, get first, delete second`,
  ]

  if (region) lines.push(`- **Region:** ${region}`)
  for (const r of results) lines.push(`- **${r.label}:** \`${r.url}\``)

  lines.push('', '### Per-Run Summary', '')
  lines.push('| Endpoint | Run | Tool Calls | Tool Time | LLM Time | Wall Time |')
  lines.push('|----------|-----|------------|-----------|----------|-----------|')

  for (const r of results) {
    for (let i = 0; i < r.runs.length; i++) {
      const run = r.runs[i]
      lines.push(
        `| ${r.label} | ${i + 1} | ${run.toolCalls} | ${fmt(run.toolTimeMs)}ms | ${fmt(run.llmTimeMs / 1000, 2)}s | ${fmt(run.wallTimeMs / 1000, 2)}s |`,
      )
    }
  }

  // Per-tool latency with per-endpoint overhead columns when baseline exists
  lines.push('', '### Per-Tool Mean Latency (ms)', '')
  const headers = ['Tool', ...results.map(r => r.label)]
  if (baseline) for (const r of nonBaseline) headers.push(`${r.label} Δ`)
  lines.push(`| ${headers.join(' | ')} |`)
  lines.push(`| ${headers.map(() => '------').join(' | ')} |`)

  for (const toolName of toolNames) {
    const cells = [toolName]
    for (const r of results) {
      const stat = r.perToolStats.find(s => s.tool === toolName)
      cells.push(stat ? fmt(stat.mean) : '-')
    }
    if (baseline) {
      const baselineStat = baseline.perToolStats.find(s => s.tool === toolName)
      for (const r of nonBaseline) {
        const stat = r.perToolStats.find(s => s.tool === toolName)
        if (stat && baselineStat) cells.push(`+${fmt(stat.mean - baselineStat.mean)}`)
        else cells.push('-')
      }
    }
    lines.push(`| ${cells.join(' | ')} |`)
  }

  // Aggregate latency with per-endpoint overhead columns
  lines.push('', '### Aggregate Tool Call Latency (ms)', '')
  const aggHeaders = ['Metric', ...results.map(r => r.label)]
  if (baseline) for (const r of nonBaseline) aggHeaders.push(`${r.label} Δ`)
  lines.push(`| ${aggHeaders.join(' | ')} |`)
  lines.push(`| ${aggHeaders.map(() => '------').join(' | ')} |`)

  const metrics: [string, (s: ToolStats) => number][] = [
    ['Mean', s => s.mean],
    ['p50', s => s.p50],
    ['p95', s => s.p95],
    ['p99', s => s.p99],
    ['Min', s => s.min],
    ['Max', s => s.max],
  ]

  for (const [metricName, getter] of metrics) {
    const cells = [metricName]
    for (const r of results) cells.push(fmt(getter(r.aggregate)))
    if (baseline) {
      for (const r of nonBaseline) cells.push(`+${fmt(getter(r.aggregate) - getter(baseline.aggregate))}`)
    }
    lines.push(`| ${cells.join(' | ')} |`)
  }

  // End-to-end impact per non-baseline endpoint
  if (baseline && nonBaseline.length > 0) {
    const baselineAvgToolTime = baseline.runs.reduce((s, r) => s + r.toolTimeMs, 0) / baseline.runs.length
    const baselineAvgCalls = baseline.runs.reduce((s, r) => s + r.toolCalls, 0) / runs

    lines.push('', '### End-to-End Impact', '')
    const impactHeaders = ['Metric', 'Baseline', ...nonBaseline.map(r => r.label)]
    lines.push(`| ${impactHeaders.join(' | ')} |`)
    lines.push(`| ${impactHeaders.map(() => '--------').join(' | ')} |`)

    const avgToolTimeCells = ['Avg tool time/run', `${fmt(baselineAvgToolTime)}ms`]
    const avgCallsCells = ['Avg tool calls/run', fmt(baselineAvgCalls)]
    const overheadCells = ['Avg overhead/call', '-']

    for (const r of nonBaseline) {
      const avgToolTime = r.runs.reduce((s, run) => s + run.toolTimeMs, 0) / r.runs.length
      const avgCalls = r.runs.reduce((s, run) => s + run.toolCalls, 0) / runs
      const overhead = avgToolTime - baselineAvgToolTime
      avgToolTimeCells.push(`${fmt(avgToolTime)}ms (+${fmt(overhead)}ms)`)
      avgCallsCells.push(fmt(avgCalls))
      overheadCells.push(`+${fmt(overhead / avgCalls)}ms`)
    }

    lines.push(`| ${avgToolTimeCells.join(' | ')} |`)
    lines.push(`| ${avgCallsCells.join(' | ')} |`)
    lines.push(`| ${overheadCells.join(' | ')} |`)
  }

  lines.push('')
  return lines.join('\n')
}

async function main() {
  const endpoints = await buildEndpoints()

  console.error('=== Agent Benchmark: Paywall Overhead Comparison ===')
  console.error(`Model: ${model} | Runs: ${runs}`)

  const results: EndpointResult[] = []
  for (const endpoint of endpoints) {
    const result = await benchmarkEndpoint(endpoint)
    results.push(result)
    console.error(
      `[${endpoint.label}] Done: mean=${fmt(result.aggregate.mean)}ms, p95=${fmt(result.aggregate.p95)}ms`,
    )
  }

  process.stdout.write(formatReport(results))
}

main().catch(err => {
  console.error('Agent comparison failed:', err)
  process.exit(1)
})
