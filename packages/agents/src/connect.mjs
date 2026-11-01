// The helper behind `npx @solvapay/agents connect` and `launch`. Plain ESM,
// no build step, so it runs from a linked or installed package as it is.
import { spawn } from 'node:child_process'
import { claudeCode } from './agents/claude-code.mjs'
import { hermes, serverName } from './agents/hermes.mjs'
import { dropPending, keyPath, readKey, readPending, saveKey, savePending } from './key-store.mjs'

export { keyEnvName, saveForHermes, serverName } from './agents/hermes.mjs'

export const DEFAULT_API = 'https://api.solvapay.com/v1'
/** How long launch waits on exit for the session's last calls to settle before it shows the spend. */
const SETTLE_MS = 15_000
/** The agents `connect` can set up, by the client name a connect request carries. */
const CLIENTS = { hermes, 'claude-code': claudeCode }
/** The agents `launch` can start, by the name on the command line. */
const LAUNCHERS = { claude: claudeCode, hermes }

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
      `Ask your user to approve this connection on their phone or in a browser:`,
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
  const [name, merchant] = positional
  const agent = LAUNCHERS[name]
  if (!agent) throw new Error(`launch needs the agent, one of: ${Object.keys(LAUNCHERS).join(', ')} (got ${name ?? 'nothing'})`)
  if (!merchant) throw new Error(`launch needs the merchant: launch ${name} <merchant name or providerRef>`)
  const providerRef = PROVIDER_REF.test(merchant) ? merchant : await merchantByName(flags.api ?? DEFAULT_API, merchant)
  let saved = await readKey(env, providerRef)
  const base = flags.api ?? saved?.api ?? DEFAULT_API

  // The merchant's listing says where its model API is and which model to start on; flags override it.
  let modelUrl = flags['model-url']
  let model = flags.model
  if (!modelUrl || !model) {
    const listing = await api(base, `/catalog/listings/${encodeURIComponent(providerRef)}`)
    modelUrl ??= listing.anthropicBaseUrl
    model ??= listing.defaultModel
  }
  if (!modelUrl || !model) {
    throw new Error(
      `${providerRef}'s catalog listing names no ${modelUrl ? 'default model' : 'model API'}: pass --model-url <the merchant's Anthropic-compatible API> --model <id>`,
    )
  }

  if (!saved) {
    const opened = await api(base, '/agent/connect-requests', {
      method: 'POST',
      body: JSON.stringify({ providerRef, name: flags.name ?? agent.displayName, client: agent.client }),
    })
    say(
      [
        `No agent key for ${providerRef} on this machine yet. Approve this connection on your phone or in a browser:`,
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
  const startedAt = new Date().toISOString()
  await spendSince(base, saved.agentKey, startedAt, keyPath(env, providerRef))

  const started = await agent.launch({
    env,
    providerRef,
    agentKey: saved.agentKey,
    merchantName: saved.merchantName,
    modelUrl,
    model,
    args: rest,
  })
  // Another way to run the same agent, e.g. a sandbox wrapper; its arguments are the agent's.
  if (env.SOLVAPAY_AGENT_BIN) started.command = env.SOLVAPAY_AGENT_BIN
  say(`Starting ${agent.displayName} on ${modelUrl} with ${model}, paid by agent ${saved.agentRef} through SolvaPay…`)
  const exitCode = await run(started)
  // The merchant completes a call after its answer ends, which can be after the agent exits.
  const deadline = Date.now() + SETTLE_MS
  let spent = await spendSince(base, saved.agentKey, startedAt, keyPath(env, providerRef))
  while (spent.inFlight > 0 && Date.now() < deadline) {
    await sleep(500)
    spent = await spendSince(base, saved.agentKey, startedAt, keyPath(env, providerRef))
  }
  say(
    `This session: ${spent.calls} paid ${spent.calls === 1 ? 'call' : 'calls'}, ${spent.spent.amount} ${spent.spent.currency}, paid by agent ${spent.agentRef} through SolvaPay.` +
      (spent.inFlight > 0 ? ` ${spent.inFlight} more not settled yet, so not in this total.` : ''),
  )
  return exitCode
}

const PROVIDER_REF = /^prov_[A-Za-z0-9]+$/

/**
 * The one listed merchant a name means, from the SolvaPay catalog. The name
 * must match the merchant's name or its first words, word for word: `opper`
 * matches "Opper MCP", `opp` does not. None or several is an error naming
 * what was found, so a launch never pays a merchant the user did not mean.
 */
async function merchantByName(base, name) {
  const wanted = serverName(name)
  const found = await api(base, `/catalog/search?q=${encodeURIComponent(name)}&limit=10`)
  const byRef = new Map(found.results.map(result => [result.providerRef, result]))
  const matches = [...byRef.values()].filter(result => {
    const slug = serverName(result.merchantName)
    return slug === wanted || slug.startsWith(`${wanted}-`)
  })
  const listed = results => results.map(result => `  ${result.merchantName} (${result.providerRef})`).join('\n')
  if (matches.length === 1) return matches[0].providerRef
  if (matches.length === 0) {
    throw new Error(
      byRef.size
        ? `No merchant in the SolvaPay catalog is called "${name}". The search found:\n${listed([...byRef.values()])}\nLaunch with one of their names or references.`
        : `No merchant in the SolvaPay catalog is called "${name}".`,
    )
  }
  throw new Error(`"${name}" matches more than one merchant in the SolvaPay catalog:\n${listed(matches)}\nLaunch with the reference of the one you mean.`)
}

/** What the agent has spent since `since`, read with its key; refused when the key is unknown or revoked. */
async function spendSince(base, agentKey, since, file) {
  const response = await fetch(`${base.replace(/\/+$/, '')}/agent/spend?since=${encodeURIComponent(since)}`, {
    headers: { authorization: `Bearer ${agentKey}` },
  })
  const text = await response.text()
  if (response.status === 401) {
    throw new Error(
      `SolvaPay refused this machine's agent key (401: ${text.slice(0, 300)}). ` +
        `Its owner may have revoked it in their SolvaPay account. To connect a new one, remove ${file} and launch again.`,
    )
  }
  if (!response.ok) throw new Error(`GET /agent/spend answered ${response.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
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
  '  solvapay-agents launch <claude|hermes> <merchant name or providerRef> [--model-url <anthropic-compatible url>] [--model <id>] [--api <url>] [--name <name>] [-- <agent args>]',
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
