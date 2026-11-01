// The helper behind `npx @solvapay/agents connect` and `launch`. Plain ESM,
// no build step, so it runs from a linked or installed package as it is.
import { spawn } from 'node:child_process'
import { claudeCode } from './agents/claude-code.mjs'
import { hermes } from './agents/hermes.mjs'
import { dropPending, keyPath, readKey, readPending, saveKey, savePending } from './key-store.mjs'

export { keyEnvName, saveForHermes, serverName } from './agents/hermes.mjs'

export const DEFAULT_API = 'https://api.solvapay.com/v1'
/** The agents `connect` can set up, by the client name a connect request carries. */
const CLIENTS = { hermes, 'claude-code': claudeCode }
/** The agents `launch` can start, by the name on the command line. */
const LAUNCHERS = { claude: claudeCode }

/** `--name value` pairs and positional arguments; everything after `--` is the agent's own. */
export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') return { positional, flags, rest: argv.slice(i + 1) }
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
  return { positional, flags, rest: [] }
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
    body: JSON.stringify({ providerRef, name: flags.name ?? CLIENTS[client].displayName, client }),
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

  const answer = await waitForApproval(state, deadline, sleep)
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
  if (answer.status === 'pending') {
    out(`Your user has not approved yet. Ask them to open ${state.verificationUrl}, then run connect finish again.`)
    return 2
  }
  out(notApproved(answer.status))
  return 1
}

function notApproved(status) {
  return (
    {
      denied: 'Your user turned this connection down.',
      expired: 'The request expired before your user answered. Run connect start again.',
      claimed: 'This request was already finished; its key was saved then.',
    }[status] ?? `Unexpected answer: ${status}`
  )
}

/** Polls the request until it is answered or the deadline passes; a `pending` answer means the deadline passed. */
async function waitForApproval(state, deadline, sleep) {
  for (;;) {
    const answer = await api(state.api, '/agent/connect-requests/claims', {
      method: 'POST',
      body: JSON.stringify({ pollSecret: state.pollSecret }),
    })
    if (answer.status !== 'pending' || Date.now() >= deadline) return answer
    await sleep(answer.retryAfterSeconds * 1000)
  }
}

/**
 * `launch <agent> <providerRef>`: connects first when no key is saved for the
 * merchant, checks the key still works, then starts the agent paying with it.
 * Status goes to stderr, so the agent's own output stays clean on stdout.
 */
async function launch({ positional, flags, rest }, env, say, sleep, run) {
  const [name, providerRef] = positional
  const agent = LAUNCHERS[name]
  if (!agent) throw new Error(`launch needs the agent, one of: ${Object.keys(LAUNCHERS).join(', ')} (got ${name ?? 'nothing'})`)
  if (!providerRef) throw new Error(`launch needs the merchant: launch ${name} <providerRef>`)
  let saved = await readKey(env, providerRef)
  const base = flags.api ?? saved?.api ?? DEFAULT_API

  const modelUrl = flags['model-url']
  const model = flags.model
  if (!modelUrl || !model) {
    throw new Error(
      `No model URL for ${providerRef}: pass --model-url <the merchant's Anthropic-compatible API> --model <id>`,
    )
  }

  if (!saved) {
    const opened = await api(base, '/agent/connect-requests', {
      method: 'POST',
      body: JSON.stringify({ providerRef, name: flags.name ?? agent.displayName, client: agent.client }),
    })
    say(
      [
        `No agent key for ${providerRef} on this machine yet. Approve this connection on your phone:`,
        `  ${opened.verificationUrl}`,
        `  (code ${opened.userCode}, valid until ${opened.expiresAt})`,
        `Waiting for your approval…`,
      ].join('\n'),
    )
    const deadline = Date.parse(opened.expiresAt)
    const answer = await waitForApproval({ api: base, ...opened }, Number.isFinite(deadline) ? deadline : Date.now() + 600_000, sleep)
    if (answer.status !== 'approved') {
      throw new Error(answer.status === 'pending' ? 'The connection was not approved in time.' : notApproved(answer.status))
    }
    const file = await saveKey(env, { ...answer, api: base })
    say(`Connected to ${answer.merchantName} as agent ${answer.agentRef}. The key is saved in ${file}.`)
    saved = await readKey(env, providerRef)
  }

  // Fails here, not inside the agent, when the owner revoked it.
  await checkKey(modelUrl, saved.agentKey, keyPath(env, providerRef))

  const started = agent.launch({ env, providerRef, agentKey: saved.agentKey, modelUrl, model, args: rest })
  say(`Starting ${agent.displayName} on ${modelUrl} with ${model}, paid by agent ${saved.agentRef} through SolvaPay…`)
  return run(started)
}

/** Lists the models with the key: free, and refused when the key is unknown or revoked. */
async function checkKey(modelUrl, agentKey, file) {
  const response = await fetch(`${modelUrl.replace(/\/+$/, '')}/v1/models`, {
    headers: { authorization: `Bearer ${agentKey}`, 'anthropic-version': '2023-06-01' },
  })
  if (response.status === 401 || response.status === 403) {
    const text = (await response.text()).slice(0, 300)
    throw new Error(
      `${modelUrl} refused this machine's agent key (${response.status}: ${text}). ` +
        `Its owner may have revoked it in their SolvaPay account. To connect a new one, remove ${file} and launch again.`,
    )
  }
  if (!response.ok) throw new Error(`${modelUrl}/v1/models answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
}

/** Starts the agent attached to this terminal and resolves with its exit code. */
function runAttached({ command, args, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' })
    child.on('error', error =>
      reject(error.code === 'ENOENT' ? new Error(`${command} is not installed or not on PATH`) : error),
    )
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

const USAGE = [
  'Usage:',
  '  solvapay-agents launch <claude> <providerRef> --model-url <anthropic-compatible url> --model <id> [--api <url>] [--name <name>] [-- <agent args>]',
  '  solvapay-agents connect start <providerRef> --client <hermes|claude-code> [--name <name>] [--api <url>] [--mcp-url <url>] [--model-url <anthropic-compatible url> --model <id>]',
  '  solvapay-agents connect finish <providerRef> [--timeout <seconds>]',
].join('\n')

export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env
  const out = deps.out ?? (text => console.log(text))
  const say = deps.say ?? (text => console.error(text))
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const run = deps.run ?? runAttached
  const [command, ...rest] = argv
  if (command === 'launch') return launch(parseArgs(rest), env, say, sleep, run)
  const [sub, ...after] = rest
  if (command !== 'connect' || (sub !== 'start' && sub !== 'finish')) {
    out(USAGE)
    return 64
  }
  const args = parseArgs(after)
  return sub === 'start' ? start(args, env, out) : finish(args, env, out, sleep)
}
