#!/usr/bin/env node
// Asks the running parity servers the questions a new MCP client asks before
// sign-in, and prints where servers of the same kind answer differently. The
// agents servers are also sent an agent key SolvaPay never issued.
//
//   node probe.mjs                  # all six, at their public URLs (ngrok)
//   node probe.mjs --local          # http://127.0.0.1:<port>
//   node probe.mjs --local paywall  # one kind
//
// Exits 1 when a server is down, answers with an unexpected status, or
// servers of the same kind disagree.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('.env', import.meta.url), 'utf8')
    .split('\n')
    .filter(line => line.trim() && !line.trim().startsWith('#'))
    .map(line =>
      line
        .split(/=(.*)/s)
        .slice(0, 2)
        .map(s => s.trim()),
    ),
)
const local = process.argv.includes('--local')
const PORTS = {
  paywall: { ts: 3060, py: 3061, go: 3062 },
  agents: { ts: 3070, py: 3071, go: 3072 },
}
const LANGUAGES = { ts: 'typescript', py: 'python', go: 'go' }
const named = ['paywall', 'agents'].filter(kind => process.argv.includes(kind))
const kinds = named.length > 0 ? named : ['paywall', 'agents']

const mcpHeaders = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
}
const checks = [
  {
    name: 'protected resource metadata',
    path: '/.well-known/oauth-protected-resource',
    status: 200,
  },
  {
    name: 'authorization server metadata',
    path: '/.well-known/oauth-authorization-server',
    status: 200,
  },
  {
    name: 'MCP without a token',
    path: '/mcp',
    status: 401,
    init: {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    },
  },
  {
    name: 'client registration',
    path: '/oauth/register',
    status: 201,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'mcp-parity probe',
        redirect_uris: ['http://127.0.0.1:9/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    },
  },
  {
    name: 'agent key SolvaPay never issued',
    kinds: ['agents'],
    path: '/mcp',
    status: 401,
    // Every server answering 500 is the merchant's setup, not the SDKs: the
    // servers' logs say which (agent payments off, a secret key for the other
    // environment).
    allFail:
      'every server answered 500: SolvaPay refused this merchant (is agent payments on for it?). See the agents servers’ logs.',
    init: {
      method: 'POST',
      headers: { ...mcpHeaders, authorization: 'Bearer agk_sandbox_mcpparityprobe' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_quote', arguments: { symbol: 'ACME' } },
      }),
    },
  },
]

// Answers with each server's own URL and name replaced, and per-call values
// blanked, so equal behaviour compares equal.
function normalise(value, server) {
  if (typeof value === 'string') {
    return value
      .split(server.base)
      .join('<base>')
      .split(server.serverName)
      .join('<name>')
      .replace(/^[a-z]+_[A-Za-z0-9]{6,}$/, '<id>')
  }
  if (Array.isArray(value)) return value.map(v => normalise(v, server))
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = /(_at|_issued_at|^client_id$|^client_secret)/.test(key)
        ? '<varies>'
        : normalise(value[key], server)
    }
    return out
  }
  return value
}

async function ask(server, check) {
  try {
    const response = await fetch(server.base + check.path, check.init)
    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = text.slice(0, 200)
    }
    const auth = response.headers.get('www-authenticate')
    return {
      status: response.status,
      body: normalise(body, server),
      ...(auth ? { auth: normalise(auth, server) } : {}),
    }
  } catch (error) {
    return { error: String(error.cause?.code ?? error.message) }
  }
}

let failed = false
for (const kind of kinds) {
  console.log(kind)
  const servers = Object.entries(PORTS[kind]).map(([lang, port]) => {
    const key = `${kind.toUpperCase()}_${lang.toUpperCase()}_URL`
    if (!local && !env[key]) throw new Error(`${key} is not set in .env`)
    return {
      name: LANGUAGES[lang],
      serverName: `${kind}-${LANGUAGES[lang]}`,
      base: local ? `http://127.0.0.1:${port}` : env[key],
    }
  })
  for (const check of checks.filter(c => !c.kinds || c.kinds.includes(kind))) {
    const answers = []
    for (const server of servers)
      answers.push({ server: server.name, ...(await ask(server, check)) })
    const same = new Set(answers.map(({ server, ...rest }) => JSON.stringify(rest))).size === 1
    const ok = same && answers.every(a => a.status === check.status)
    if (!ok) failed = true
    const statuses = answers.map(a => `${a.server} ${a.status ?? a.error}`).join(', ')
    console.log(`  ${ok ? '✓' : '✗'} ${check.name}: ${statuses}${same ? '' : ' (answers differ)'}`)
    if (check.allFail && answers.every(a => a.status === 500)) {
      console.log(`      ${check.allFail}`)
    } else if (!same) {
      for (const a of answers) console.log(`      ${JSON.stringify(a)}`)
    }
  }
}
process.exit(failed ? 1 : 0)
