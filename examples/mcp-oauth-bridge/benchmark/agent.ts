import { parseArgs } from 'node:util'
import { performance } from 'node:perf_hooks'
import { McpClient, type ToolCallResult } from './mcp-client'
import { computeAggregate, computeStats, type ToolLatencyRecord } from './stats'

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    token: { type: 'string' },
    runs: { type: 'string', default: '3' },
    model: { type: 'string', default: 'claude-sonnet-4-20250514' },
    label: { type: 'string' },
  },
  strict: true,
})

if (!values.url || !values.token) {
  console.error('Usage: tsx benchmark/agent.ts --url <server-url> --token <bearer-token> [options]')
  console.error('')
  console.error('Options:')
  console.error('  --url     MCP server URL (required)')
  console.error('  --token   Bearer token (required)')
  console.error('  --runs    Number of agent runs (default: 3)')
  console.error('  --model   Anthropic model (default: claude-sonnet-4-20250514)')
  console.error('  --label   Label for the report')
  console.error('')
  console.error('Requires ANTHROPIC_API_KEY environment variable.')
  process.exit(1)
}

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required')
  process.exit(1)
}

const serverUrl = values.url
const token = values.token
const runs = parseInt(values.runs!, 10)
const model = values.model!
const label = values.label

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

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
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

interface RunResult {
  toolCalls: number
  toolTimeMs: number
  llmTimeMs: number
  wallTimeMs: number
  records: ToolLatencyRecord[]
}

function extractToolResult(callResult: ToolCallResult): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = callResult.result as any
    const content = r?.result?.content?.[0]?.text
    return content ?? JSON.stringify(r?.result ?? r)
  } catch {
    return JSON.stringify(callResult.result)
  }
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

async function runAgentTask(client: McpClient, tools: ToolDef[]): Promise<RunResult> {
  const records: ToolLatencyRecord[] = []
  let toolTimeMs = 0
  let llmTimeMs = 0

  const messages: AnthropicMessage[] = [{ role: 'user', content: TASK_PROMPT }]
  const wallStart = performance.now()

  // Agent loop: keep going until no more tool_use blocks
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { content, latencyMs: llmLatency } = await anthropicRequest(messages, tools)
    llmTimeMs += llmLatency

    const toolUseBlocks = content.filter(b => b.type === 'tool_use')
    if (toolUseBlocks.length === 0) break

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

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: extractToolResult(callResult),
      })
    }

    messages.push({ role: 'user', content: toolResults })
  }

  return {
    toolCalls: records.length,
    toolTimeMs,
    llmTimeMs,
    wallTimeMs: performance.now() - wallStart,
    records,
  }
}

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals)
}

function formatAgentReport(results: RunResult[]): string {
  const allRecords = results.flatMap(r => r.records)
  const perToolStats = computeStats(allRecords)
  const aggregate = computeAggregate(allRecords)

  const lines: string[] = [
    `## Agent Benchmark Results${label ? ` (${label})` : ''}`,
    '',
    `- **Server:** \`${serverUrl}\``,
    `- **Date:** ${new Date().toISOString()}`,
    `- **Model:** ${model}`,
    `- **Task:** Create 3 tasks, list, get first, delete second`,
    `- **Runs:** ${runs}`,
    '',
    '### Per-Run Summary',
    '',
    '| Run | Tool Calls | Tool Time | LLM Time | Wall Time |',
    '|-----|------------|-----------|----------|-----------|',
  ]

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    lines.push(
      `| ${i + 1} | ${r.toolCalls} | ${fmt(r.toolTimeMs)}ms | ${fmt(r.llmTimeMs / 1000, 2)}s | ${fmt(r.wallTimeMs / 1000, 2)}s |`,
    )
  }

  lines.push('', '### Per-Tool Latency (ms)', '')
  lines.push('| Tool | Mean | p50 | p95 | p99 | Min | Max |')
  lines.push('|------|------|-----|-----|-----|-----|-----|')
  for (const s of perToolStats) {
    lines.push(
      `| ${s.tool} | ${fmt(s.mean)} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${fmt(s.min)} | ${fmt(s.max)} |`,
    )
  }

  lines.push('', '### Aggregate Tool Call Latency', '')
  lines.push('| Metric | Value |')
  lines.push('|--------|-------|')
  lines.push(`| Total calls | ${aggregate.count} |`)
  lines.push(`| Mean | ${fmt(aggregate.mean)}ms |`)
  lines.push(`| p50 | ${fmt(aggregate.p50)}ms |`)
  lines.push(`| p95 | ${fmt(aggregate.p95)}ms |`)
  lines.push(`| p99 | ${fmt(aggregate.p99)}ms |`)

  lines.push('')
  return lines.join('\n')
}

async function main() {
  const client = new McpClient(serverUrl, token)

  console.error(`Connecting to ${serverUrl}...`)
  await client.initSession()

  // Discover tools and convert to Anthropic format
  const { tools: mcpTools } = await client.listTools()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: ToolDef[] = (mcpTools as any[])
    .filter(t => !['get_user_info', 'upgrade', 'manage_account'].includes(t.name))
    .map(t => ({
      name: t.name,
      description: t.description ?? '',
      input_schema: t.inputSchema ?? { type: 'object', properties: {} },
    }))

  console.error(`Discovered ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`)
  console.error(`Running ${runs} agent runs with ${model}...`)

  const results: RunResult[] = []
  for (let i = 0; i < runs; i++) {
    console.error(`  Run ${i + 1}/${runs}...`)
    const result = await runAgentTask(client, tools)
    results.push(result)
    console.error(
      `    ${result.toolCalls} tool calls, ${fmt(result.toolTimeMs)}ms tool time, ${fmt(result.wallTimeMs / 1000, 2)}s wall time`,
    )
  }

  await client.closeSession()

  process.stdout.write(formatAgentReport(results))
}

main().catch(err => {
  console.error('Agent benchmark failed:', err)
  process.exit(1)
})
