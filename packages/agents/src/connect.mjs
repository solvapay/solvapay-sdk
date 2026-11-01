// The `connect` helper behind `npx @solvapay/agents connect`. Plain ESM, no
// build step, so it runs from a linked or installed package as it is.
import { hermes } from './agents/hermes.mjs'
import { dropPending, readPending, saveKey, savePending } from './key-store.mjs'

export { keyEnvName, saveForHermes, serverName } from './agents/hermes.mjs'

export const DEFAULT_API = 'https://api.solvapay.com/v1'
/** The agents `connect` can set up, by the client name a connect request carries. */
const CLIENTS = { hermes }

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
  if (!Object.hasOwn(CLIENTS, client)) {
    throw new Error(`--client must be one of: ${Object.keys(CLIENTS).join(', ')} (got ${client ?? 'nothing'})`)
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
  await savePending(env, providerRef, { api: base, mcpUrl, modelUrl, model, client, ...opened })
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
  const state = await readPending(env, providerRef)
  if (!state) {
    throw new Error(`No connect request for ${providerRef} here: run connect start ${providerRef} first`)
  }
  const timeoutSeconds = Number(flags.timeout ?? 120)
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) throw new Error('--timeout must be seconds')
  const deadline = Date.now() + timeoutSeconds * 1000

  for (;;) {
    const answer = await api(state.api, '/agent/connect-requests/claims', {
      method: 'POST',
      body: JSON.stringify({ pollSecret: state.pollSecret }),
    })
    if (answer.status === 'approved') {
      const keyFile = await saveKey(env, { ...answer, api: state.api })
      await dropPending(env, providerRef)
      out(
        [
          `Connected to ${answer.merchantName} as agent ${answer.agentRef}.`,
          `The agent key is saved in ${keyFile} (not shown here).`,
          ...(await CLIENTS[state.client].connected(env, state, answer)),
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
