#!/usr/bin/env node
/* global console, process */
/**
 * `verify.mjs <worker-url>` — contract checks against a running worker.
 *
 * Read-only. Asserts the worker looks like a SolvaPay MCP server:
 *   - `/.well-known/oauth-protected-resource` returns the expected
 *     JSON shape.
 *   - `/.well-known/oauth-authorization-server` returns the expected
 *     JSON shape.
 *   - `tools/list` returns the four intent tools (`upgrade`, `topup`,
 *     `activate_plan`, `manage_account`) plus the generated tools, with
 *     UI-only tools hidden.
 *   - When at least one paid tool is registered: call it past the
 *     paywall and assert text-only narration in `content[0].text` (no
 *     iframe, no structured UI payload on the gate).
 *
 * Output: JSON pass/fail/skipped map on stdout. Exit code 0 if no
 * check failed (skipped + passed are fine), 1 otherwise.
 */

import { rpc, listTools, callTool, getJson, RpcError } from './lib/mcp-client.mjs'

const INTENT_TOOLS = ['upgrade', 'topup', 'activate_plan', 'manage_account']
const UI_TOOL_HINTS = ['create_payment_intent', 'create_topup_payment_intent', 'create_checkout_session']

async function main() {
  const [workerUrl] = process.argv.slice(2)
  if (!workerUrl) {
    console.error('Usage: verify.mjs <worker-url>')
    process.exit(2)
  }

  const base = workerUrl.replace(/\/$/, '')
  const checks = {}

  checks.oauthProtectedResource = await run(async () => {
    const meta = await getJson(`${base}/.well-known/oauth-protected-resource`)
    assert(typeof meta.resource === 'string', 'resource must be a string')
    assert(
      Array.isArray(meta.authorization_servers) && meta.authorization_servers.length > 0,
      'authorization_servers must be a non-empty array',
    )
    return { resource: meta.resource, authServer: meta.authorization_servers[0] }
  })

  checks.oauthAuthorizationServer = await run(async () => {
    const meta = await getJson(`${base}/.well-known/oauth-authorization-server`)
    assert(typeof meta.issuer === 'string', 'issuer must be a string')
    assert(typeof meta.authorization_endpoint === 'string', 'authorization_endpoint must be a string')
    assert(typeof meta.token_endpoint === 'string', 'token_endpoint must be a string')
    return { issuer: meta.issuer }
  })

  const toolsResult = await runToolsListCheck(base)
  checks.toolsList = toolsResult

  // `paywallGate` needs the catalog to pick a candidate tool. When the
  // worker is gated (`requireAuth: true` default) we don't have it, so
  // the gate check has to be skipped — that's a known limitation of an
  // anonymous probe, not a worker bug.
  const candidates =
    toolsResult.status === 'passed' && Array.isArray(toolsResult.value.names)
      ? findToolCandidates(toolsResult.value.names)
      : []
  checks.paywallGate =
    toolsResult.status === 'passed' && toolsResult.value.authRequired
      ? {
          status: 'skipped',
          reason: 'worker requires bearer auth; anonymous probe cannot enumerate paid tools',
        }
      : await runPaywallGateCheck(base, candidates)

  const summary = {
    workerUrl: base,
    checks,
    overall: Object.values(checks).every(c => c.status !== 'failed') ? 'passed' : 'failed',
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  process.exit(summary.overall === 'passed' ? 0 : 1)
}

async function run(fn) {
  try {
    const value = await fn()
    return { status: 'passed', value }
  } catch (err) {
    return {
      status: 'failed',
      error: err.message ?? String(err),
      info: err instanceof RpcError ? err.info : undefined,
    }
  }
}

/**
 * Two valid contract shapes for `tools/list`:
 *
 * 1. Anonymous list succeeds → assert intent tools present + no UI leak.
 * 2. Anonymous list returns `401` with a well-formed
 *    `WWW-Authenticate: Bearer resource_metadata="…"` challenge →
 *    server is correctly gated, treat as passed and surface
 *    `authRequired: true` so the downstream paywall check knows to
 *    skip itself.
 *
 * A 401 without a challenge, or any other error, is a real failure.
 */
async function runToolsListCheck(base) {
  try {
    const tools = await listTools(base)
    const names = tools.map(t => t.name)
    for (const intent of INTENT_TOOLS) {
      assert(names.includes(intent), `intent tool \`${intent}\` missing from tools/list`)
    }
    const leakedUi = names.filter(n => UI_TOOL_HINTS.includes(n))
    assert(
      leakedUi.length === 0,
      `UI-only tools leaked to text catalog: ${leakedUi.join(', ')}. Set \`hideToolsByAudience: ['ui']\`.`,
    )
    return { status: 'passed', value: { toolCount: names.length, names, authRequired: false } }
  } catch (err) {
    if (err instanceof RpcError && err.info?.httpStatus === 401) {
      const challenge = err.info.wwwAuthenticate ?? ''
      if (/^Bearer\b/i.test(challenge) && /resource_metadata="/.test(challenge)) {
        return {
          status: 'passed',
          value: { authRequired: true, wwwAuthenticate: challenge },
        }
      }
      return {
        status: 'failed',
        error: 'worker returned 401 without a well-formed `WWW-Authenticate: Bearer …` challenge',
        info: { wwwAuthenticate: challenge || null },
      }
    }
    return {
      status: 'failed',
      error: err.message ?? String(err),
      info: err instanceof RpcError ? err.info : undefined,
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function findToolCandidates(names) {
  return names.filter(n => !INTENT_TOOLS.includes(n) && !UI_TOOL_HINTS.includes(n))
}

/**
 * Try each non-intent / non-UI tool with empty arguments and look for
 * the SolvaPay paywall gate shape: text-only narration in
 * `content[0].text` plus a `structuredContent.gate` payload. Returns
 * `passed` on the first match, `skipped` when no candidate gates (free
 * tools or no tools at all), or `failed` only when a candidate gates
 * but the shape is wrong (text missing, iframe leaked, intent tool not
 * named).
 *
 * Empty-arg invocation deliberately accepts that the upstream may
 * reject the call — we're looking at the SolvaPay envelope, not the
 * upstream response.
 */
async function runPaywallGateCheck(base, candidates) {
  if (candidates.length === 0) {
    return { status: 'skipped', reason: 'no paid tools registered' }
  }
  for (const name of candidates) {
    let response
    try {
      response = await callTool(base, name, {})
    } catch {
      continue
    }
    const gate = response?.structuredContent?.gate
    if (!gate) continue
    try {
      assert(
        Array.isArray(response.content) && response.content[0]?.type === 'text',
        `gate response on \`${name}\` must put narration in content[0].text`,
      )
      const text = response.content[0].text
      assert(
        INTENT_TOOLS.some(intent => text.includes(intent)),
        `gate narration on \`${name}\` must name a recovery intent tool (${INTENT_TOOLS.join(' / ')})`,
      )
      assert(
        !response._meta?.['ui'],
        `gate response on \`${name}\` must not advertise a UI resource (_meta.ui must be absent on a gate)`,
      )
      return { status: 'passed', value: { tool: name, narrationLength: text.length } }
    } catch (err) {
      return { status: 'failed', error: err.message ?? String(err) }
    }
  }
  return {
    status: 'skipped',
    reason: 'no candidate tool returned a paywall gate (selections may all be `tier: "free"` or the customer has unused balance)',
  }
}

main().catch(err => {
  console.error(err.stack ?? err.message ?? String(err))
  process.exit(1)
})
