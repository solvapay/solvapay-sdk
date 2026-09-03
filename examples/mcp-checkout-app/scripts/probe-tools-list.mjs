#!/usr/bin/env node
/**
 * Dump tools/list from the local checkout app for visibility enforcement probes.
 *
 * Usage:
 *   node scripts/probe-tools-list.mjs [url] [--claude-ua]
 *
 * With --claude-ua, sends a Claude-like User-Agent (still subject to
 * hideToolsByAudience unless MCP_VISIBILITY_TEST=1 on the server).
 */
import { rpc } from '../../../packages/create-solvapay/templates/mcp/_base/scripts/lib/mcp-client.mjs'

const baseUrl = process.argv.find(a => a.startsWith('http')) ?? 'http://localhost:3030'
const claudeUa = process.argv.includes('--claude-ua')

async function main() {
  const headers = claudeUa
    ? { 'user-agent': 'claude-ai/1.0 (Claude Desktop)' }
    : {}

  // initialize is optional for this server's stateless JSON mode but matches real hosts.
  await rpc(baseUrl, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: claudeUa ? 'claude-ai' : 'probe', version: '1.0.0' },
  }, { headers })

  let tools
  try {
    const result = await rpc(baseUrl, 'tools/list', {})
    tools = result.tools ?? []
  } catch (err) {
    if (err.httpStatus === 401) {
      console.error(
        'tools/list returned 401 — OAuth required. Connect Claude with the ngrok URL and ask it to list tools, or pass a bearer token.',
      )
      process.exit(1)
    }
    throw err
  }

  const rows = tools.map(t => ({
    name: t.name,
    visibility: t._meta?.ui?.visibility ?? t._meta?.['ui']?.visibility ?? null,
    audience: t._meta?.audience ?? null,
  }))

  console.log(JSON.stringify({ url: baseUrl, claudeUa, count: rows.length, tools: rows }, null, 2))
}

main().catch(err => {
  console.error(err.message ?? err)
  process.exit(1)
})
