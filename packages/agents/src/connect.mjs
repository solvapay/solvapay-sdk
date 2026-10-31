// The `connect` helper behind `npx @solvapay/agents connect`. Plain ESM, no
// build step, so it runs from a linked or installed package as it is.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseDocument } from 'yaml'

export const DEFAULT_API = 'https://api.solvapay.com/v1'
const CLIENTS = ['hermes']

/** `--name value` and `--flag` pairs after the positional arguments. */
export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const name = arg.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${name} needs a value`)
    }
    flags[name] = value
    i++
  }
  return { positional, flags }
}

/** The env var an agent key for this merchant is saved under, e.g. `SOLVAPAY_KEY_PROV_E4YWS8H8`. */
export function keyEnvName(providerRef) {
  return `SOLVAPAY_KEY_${providerRef.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/** A name Hermes can use for the merchant's MCP server and model provider, e.g. `opper`. */
export function serverName(merchantName) {
  const slug = merchantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) throw new Error(`Cannot make a server name from "${merchantName}"`)
  return slug
}

function hermesHome(env) {
  return env.HERMES_HOME || join(homedir(), '.hermes')
}

function statePath(env, providerRef) {
  return join(hermesHome(env), 'solvapay', `${providerRef}.json`)
}

async function api(base, path, init) {
  const response = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`${init?.method ?? 'GET'} ${path} answered ${response.status} with no JSON: ${text.slice(0, 200)}`)
  }
  if (!response.ok) {
    const message = body?.message ?? body?.error?.message ?? text
    throw new Error(`${init?.method ?? 'GET'} ${path} failed (${response.status}): ${typeof message === 'string' ? message : JSON.stringify(message)}`)
  }
  return body
}

async function start({ positional, flags }, env, out) {
  const [providerRef] = positional
  if (!providerRef) throw new Error('connect start needs the merchant: connect start <providerRef> --client hermes')
  const client = flags.client
  if (!CLIENTS.includes(client)) {
    throw new Error(`--client must be one of: ${CLIENTS.join(', ')} (got ${client ?? 'nothing'})`)
  }
  const base = flags.api ?? DEFAULT_API
  const modelUrl = flags['model-url']
  const model = flags.model
  if (Boolean(modelUrl) !== Boolean(model)) {
    throw new Error('--model-url and --model go together: the merchant\'s Anthropic-compatible API and the model to use on it')
  }
  // With neither an MCP nor a model URL, the merchant's MCP server comes from its catalog listing.
  let mcpUrl = flags['mcp-url']
  if (!mcpUrl && !modelUrl) {
    const listing = await api(base, `/catalog/listings/${encodeURIComponent(providerRef)}`)
    mcpUrl = listing.mcpUrl
  }
  const opened = await api(base, '/agent/connect-requests', {
    method: 'POST',
    body: JSON.stringify({ providerRef, name: flags.name ?? 'Hermes', client }),
  })
  const path = statePath(env, providerRef)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    `${JSON.stringify({ api: base, mcpUrl, modelUrl, model, client, ...opened }, null, 2)}\n`,
    { mode: 0o600 },
  )
  out(
    [
      `Ask your user to approve this connection on their phone:`,
      `  ${opened.verificationUrl}`,
      `  (code ${opened.userCode}, valid until ${opened.expiresAt})`,
      `They sign in to SolvaPay (an account is made if they have none), review the budget and approve with Face ID or Touch ID. Nothing is charged before they approve.`,
      `When they have approved, run:`,
      `  npx @solvapay/agents connect finish ${providerRef}`,
    ].join('\n'),
  )
  return 0
}

async function finish({ positional, flags }, env, out, sleep) {
  const [providerRef] = positional
  if (!providerRef) throw new Error('connect finish needs the merchant: connect finish <providerRef>')
  const path = statePath(env, providerRef)
  if (!existsSync(path)) {
    throw new Error(`No connect request for ${providerRef} here: run connect start ${providerRef} first`)
  }
  const state = JSON.parse(await readFile(path, 'utf8'))
  const timeoutSeconds = Number(flags.timeout ?? 120)
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) throw new Error('--timeout must be seconds')
  const deadline = Date.now() + timeoutSeconds * 1000

  for (;;) {
    const answer = await api(state.api, '/agent/connect-requests/claims', {
      method: 'POST',
      body: JSON.stringify({ pollSecret: state.pollSecret }),
    })
    if (answer.status === 'approved') {
      const saved = await saveForHermes(env, state, answer)
      out(
        [
          `Connected to ${answer.merchantName} as agent ${answer.agentRef}.`,
          `The agent key is saved in ${saved.envFile} as ${saved.envName} (not shown here).`,
          ...(state.mcpUrl
            ? [
                `Hermes has a new MCP server "${saved.server}" at ${state.mcpUrl}.`,
                `Run /reload-mcp to load its tools (Hermes also picks it up by itself within about 30 seconds).`,
              ]
            : []),
          ...(state.modelUrl
            ? [
                `Hermes has a new model provider "${saved.server}" at ${state.modelUrl}, paid with the key.`,
                `A session keeps the providers it started with, so start a new one on it:`,
                `  hermes chat --model custom:${saved.server}:${state.model}`,
              ]
            : []),
        ].join('\n'),
      )
      return 0
    }
    if (answer.status !== 'pending') {
      out(
        {
          denied: 'Your user turned this connection down.',
          expired: 'The request expired before your user answered. Run connect start again.',
          claimed: 'This request was already finished; its key was saved then.',
        }[answer.status] ?? `Unexpected answer: ${answer.status}`,
      )
      return 1
    }
    if (Date.now() >= deadline) {
      out(`Your user has not approved yet. Ask them to open ${state.verificationUrl}, then run connect finish again.`)
      return 2
    }
    await sleep(answer.retryAfterSeconds * 1000)
  }
}

/** The key into Hermes's `.env`; the merchant's MCP server and model provider into its `config.yaml`. */
export async function saveForHermes(env, state, answer) {
  const home = hermesHome(env)
  await mkdir(home, { recursive: true })
  const envName = keyEnvName(answer.providerRef)
  const envFile = join(home, '.env')
  const current = existsSync(envFile) ? await readFile(envFile, 'utf8') : ''
  const line = `${envName}=${answer.agentKey}`
  const kept = current.split('\n').filter(l => l && !l.startsWith(`${envName}=`))
  await writeFile(envFile, `${[...kept, line].join('\n')}\n`, { mode: 0o600 })

  const configFile = join(home, 'config.yaml')
  const doc = parseDocument(existsSync(configFile) ? await readFile(configFile, 'utf8') : '')
  if (doc.errors.length) throw new Error(`${configFile} is not valid YAML: ${doc.errors[0].message}`)
  const server = serverName(answer.merchantName)
  if (state.mcpUrl) {
    doc.setIn(['mcp_servers', server], doc.createNode({
      url: state.mcpUrl,
      headers: { Authorization: `Bearer \${${envName}}` },
      timeout: 120,
    }))
  }
  if (state.modelUrl) {
    doc.setIn(['providers', server], doc.createNode({
      api: state.modelUrl,
      transport: 'anthropic_messages',
      key_env: envName,
      default_model: state.model,
    }))
  }
  await writeFile(configFile, doc.toString())
  return { envFile, envName, configFile, server }
}

export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env
  const out = deps.out ?? (text => console.log(text))
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const [command, sub, ...rest] = argv
  if (command !== 'connect' || (sub !== 'start' && sub !== 'finish')) {
    out('Usage:\n  solvapay-agents connect start <providerRef> --client hermes [--name <name>] [--api <url>] [--mcp-url <url>] [--model-url <anthropic-compatible url> --model <id>]\n  solvapay-agents connect finish <providerRef> [--timeout <seconds>]')
    return 64
  }
  const args = parseArgs(rest)
  return sub === 'start' ? start(args, env, out) : finish(args, env, out, sleep)
}
