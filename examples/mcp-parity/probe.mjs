#!/usr/bin/env node
// Asks each running parity server the same questions a new MCP client asks
// before sign-in, and prints where their answers differ.
//
//   node probe.mjs            # the public URLs from .env (through ngrok)
//   node probe.mjs --local    # http://127.0.0.1:<port>
//
// Exits 1 when a server is down, answers with an unexpected status, or the
// servers disagree.
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
const servers = ['TS', 'PY', 'GO'].map(key => ({
  name: { TS: 'typescript', PY: 'python', GO: 'go' }[key],
  base: local ? `http://127.0.0.1:${env[`${key}_PORT`]}` : env[`${key}_PUBLIC_BASE_URL`],
}))

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
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
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
]

// Answers with each server's own URL replaced, and per-call values blanked,
// so equal behaviour compares equal.
function normalise(value, base) {
  if (typeof value === 'string') {
    return value
      .split(base)
      .join('<base>')
      .replace(/^[a-z]+_[A-Za-z0-9]{6,}$/, '<id>')
  }
  if (Array.isArray(value)) return value.map(v => normalise(v, base))
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = /(_at|_issued_at|^client_id$|^client_secret)/.test(key)
        ? '<varies>'
        : normalise(value[key], base)
    }
    return out
  }
  return value
}

let failed = false
for (const check of checks) {
  const answers = []
  for (const server of servers) {
    let line
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
      line = {
        status: response.status,
        body: normalise(body, server.base),
        ...(auth ? { auth: normalise(auth, server.base) } : {}),
      }
      if (response.status !== check.status) failed = true
    } catch (error) {
      line = { error: String(error.cause?.code ?? error.message) }
      failed = true
    }
    answers.push({ server: server.name, ...line })
  }
  const same = new Set(answers.map(({ server, ...rest }) => JSON.stringify(rest))).size === 1
  if (!same) failed = true
  const statuses = answers.map(a => `${a.server} ${a.status ?? a.error}`).join(', ')
  console.log(
    `${same && answers.every(a => a.status === check.status) ? '✓' : '✗'} ${check.name}: ${statuses}${same ? '' : ' (answers differ)'}`,
  )
  if (!same) for (const a of answers) console.log(`    ${JSON.stringify(a)}`)
}
process.exit(failed ? 1 : 0)
