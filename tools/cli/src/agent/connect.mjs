// The helper behind `npx solvapay connect` and `launch`. Plain ESM: tsup
// bundles it into dist/cli.js, and the tests import it as it is.
import { spawn } from 'node:child_process'
import { addToClaudeCode, claudeCode, mcpAddedLines } from './agents/claude-code.mjs'
import { hermes } from './agents/hermes.mjs'
import { dropPending, keyPath, readKey, readPending, saveKey, savePending } from './key-store.mjs'

export { keyEnvName, saveForHermes, serverName } from './agents/hermes.mjs'

export const DEFAULT_API = 'https://api.solvapay.com/v1'
/** How long launch waits on exit for the session's last calls to settle before it shows the spend. */
const SETTLE_MS = 15_000
/**
 * The agents, by the one name a person types in `launch <agent>` and
 * `--client`, which is also the client name a connect request carries.
 * `claude` is Claude Code, the Claude a terminal reaches; another Claude host
 * would get its own name.
 */
const CLIENTS = { claude: claudeCode, hermes }

/** Flags that take no value. */
const SWITCHES = new Set(['new', 'add-mcp'])

/** `--name value` pairs, switches and positional arguments; everything after `--` is the agent's own. */
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
    if (SWITCHES.has(name)) {
      flags[name] = true
      continue
    }
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
    throw new Error(
      `${init?.method ?? 'GET'} ${path} answered ${response.status} with no JSON: ${text.slice(0, 200)}`,
    )
  }
  if (!response.ok) {
    const message = body?.message ?? body?.error?.message ?? text
    const error = new Error(
      `${init?.method ?? 'GET'} ${path} failed (${response.status}): ${typeof message === 'string' ? message : JSON.stringify(message)}`,
    )
    error.status = response.status
    throw error
  }
  return body
}

/** The sub-commands `connect` had before it became one command run until it is done. */
const OLD_SUBCOMMANDS = ['start', 'complete', 'finish']
/** Flags that shape a request, by the name the waiting request keeps them under. */
const REQUEST_FLAGS = {
  client: 'client',
  name: 'name',
  api: 'api',
  'mcp-url': 'mcpUrl',
  'model-url': 'modelUrl',
  model: 'model',
  'add-mcp': 'addMcp',
}

/**
 * `connect <merchant> --client <host>`, run until it says connected. The
 * merchant is its launch name in the catalog (`opper`) or its `prov_…`
 * reference; the printed re-run keeps whichever the agent used. With
 * nothing waiting it asks the owner and prints where they approve; with a
 * request waiting it waits for their answer and, once approved, saves the key
 * and sets the host up. A dead request (declined, expired) is dropped, so the
 * same command asks again. Already connected, it says so unless `--new`.
 * Exits 0 when asked or connected, 2 while the owner has not answered, 1 when
 * they did not approve.
 */
async function connect({ positional, flags }, env, out, sleep, exec, npx) {
  const [merchant] = positional
  if (OLD_SUBCOMMANDS.includes(merchant)) {
    throw new Error(
      `connect takes the merchant now and is run again until it is done: connect <merchant launch name or providerRef> --client <${Object.keys(CLIENTS).join('|')}> (got connect ${merchant})`,
    )
  }
  if (!merchant) {
    throw new Error(
      `connect needs the merchant: connect <merchant launch name or providerRef> --client <${Object.keys(CLIENTS).join('|')}>`,
    )
  }
  const providerRef = PROVIDER_REF.test(merchant)
    ? merchant
    : await merchantByName(flags.api ?? DEFAULT_API, merchant)
  if (flags.new) await dropPending(env, providerRef)
  const waiting = await readPending(env, providerRef)
  if (waiting) {
    refuseOtherFlags(providerRef, waiting, flags)
    return collect(providerRef, waiting, flags, env, out, sleep, exec, npx)
  }
  refuseAddMcp(flags)
  const saved = await readKey(env, providerRef)
  if (saved && !flags.new) {
    const lines = [
      `Already connected to ${saved.merchantName} as agent ${saved.agentRef}; the key is in ${keyPath(env, providerRef)} (not shown here).`,
    ]
    // Connected before without --add-mcp: the saved key is enough to add the MCP server now.
    if (flags['add-mcp']) {
      const mcpUrl =
        flags['mcp-url'] ??
        (await listingMcpUrl(flags.api ?? saved.api ?? DEFAULT_API, providerRef))
      lines.push(...mcpAddedLines(await addToClaudeCode(env, { ...saved, mcpUrl }, exec), mcpUrl))
    } else {
      lines.push(`To connect again, add --new.`)
    }
    out(lines.join('\n'))
    return 0
  }
  return ask(providerRef, merchant, flags, env, out, npx)
}

/** `--add-mcp` adds a merchant's MCP server to Claude Code; it means nothing for another host or a model API. */
function refuseAddMcp(flags) {
  if (!flags['add-mcp']) return
  if (flags.client !== 'claude') {
    throw new Error(
      `--add-mcp adds the merchant's MCP server to Claude Code, so it goes with --client claude (got --client ${flags.client ?? 'nothing'})`,
    )
  }
  if (flags['model-url']) {
    throw new Error(
      `--add-mcp adds the merchant's MCP server, and --model-url connects its model API: run them as separate connects`,
    )
  }
}

async function listingMcpUrl(base, providerRef) {
  const listing = await api(base, `/catalog/listings/${encodeURIComponent(providerRef)}`)
  if (!listing.mcpUrl)
    throw new Error(`${providerRef}'s catalog listing names no MCP server: pass --mcp-url <url>`)
  return listing.mcpUrl
}

/** A re-run that names a flag differently from the waiting request would set up something else: refuse it. */
function refuseOtherFlags(providerRef, waiting, flags) {
  const differ = Object.entries(REQUEST_FLAGS)
    .filter(([flag, kept]) => flags[flag] !== undefined && flags[flag] !== waiting[kept])
    .map(([flag, kept]) => `--${flag} was ${waiting[kept] ?? 'not given'}, now ${flags[flag]}`)
  if (differ.length > 0) {
    throw new Error(
      `A connect request for ${providerRef} is already waiting, made differently (${differ.join('; ')}). Run the same command as before, or add --new to ask again.`,
    )
  }
}

/** The command that carries on this request: the one the agent ran, without `--new` or `--timeout`. */
function againCommand(npx, merchant, flags) {
  const kept = Object.keys(REQUEST_FLAGS)
    .filter(flag => flags[flag] !== undefined)
    .map(flag => (SWITCHES.has(flag) ? ` --${flag}` : ` --${flag} ${shellQuote(flags[flag])}`))
    .join('')
  return `${npx} connect ${shellQuote(merchant)}${kept}`
}

/** A value as one shell word: as it is when it is safe, else in single quotes. */
export function shellQuote(value) {
  const text = String(value)
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`
}

async function ask(providerRef, merchant, flags, env, out, npx) {
  const client = flags.client
  if (!Object.hasOwn(CLIENTS, client)) {
    throw new Error(
      `--client must be one of: ${Object.keys(CLIENTS).join(', ')} (got ${client ?? 'nothing'})`,
    )
  }
  const base = flags.api ?? DEFAULT_API
  const modelUrl = flags['model-url']
  const model = flags.model
  if (Boolean(modelUrl) !== Boolean(model)) {
    throw new Error(
      "--model-url and --model go together: the merchant's Anthropic-compatible API and the model to use on it",
    )
  }
  // With neither an MCP nor a model URL, the merchant's MCP server comes from its catalog listing.
  let mcpUrl = flags['mcp-url']
  // Whether `launch` can start an agent on the merchant's model API once connected.
  let modelApi = Boolean(modelUrl)
  if (!mcpUrl && !modelUrl) {
    const listing = await api(base, `/catalog/listings/${encodeURIComponent(providerRef)}`)
    mcpUrl = listing.mcpUrl
    modelApi = Boolean(listing.anthropicBaseUrl)
  }
  const addMcp = flags['add-mcp'] === true
  if (addMcp && !mcpUrl)
    throw new Error(
      `${providerRef}'s catalog listing names no MCP server to add: pass --mcp-url <url>`,
    )
  const name = flags.name ?? CLIENTS[client].displayName
  const opened = await api(base, '/agent/connect-requests', {
    method: 'POST',
    body: JSON.stringify({ providerRef, name, client }),
  })
  await savePending(env, providerRef, {
    api: base,
    mcpUrl,
    modelUrl,
    model,
    modelApi,
    client,
    ...(addMcp ? { addMcp } : {}),
    ...opened,
    name,
  })
  out(
    [
      `Ask your user to approve this connection on their phone or in a browser:`,
      `  ${opened.verificationUrl}`,
      `  (code ${opened.userCode}, valid until ${opened.expiresAt})`,
      `They sign in to SolvaPay (an account is made if they have none), review the budget and approve with Face ID or Touch ID. Nothing is charged before they approve.`,
      `When they have approved, run the same command again:`,
      `  ${againCommand(npx, merchant, flags)}`,
    ].join('\n'),
  )
  return 0
}

/** Waits for the owner's answer to the waiting request and acts on it. */
async function collect(providerRef, state, flags, env, out, sleep, exec, npx) {
  const timeoutSeconds = Number(flags.timeout ?? 120)
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0)
    throw new Error('--timeout must be seconds')
  const deadline = Date.now() + timeoutSeconds * 1000

  const answer = await waitForApproval(state, deadline, sleep)
  if (answer.status === 'approved') {
    const keyFile = await saveKey(env, { ...answer, api: state.api })
    await dropPending(env, providerRef)
    out(
      [
        `Connected to ${answer.merchantName} as agent ${answer.agentRef}.`,
        `The agent key is saved in ${keyFile} (not shown here).`,
        ...(await CLIENTS[state.client].connected(env, state, answer, { exec, npx })),
      ].join('\n'),
    )
    return 0
  }
  if (answer.status === 'pending') {
    out(
      `Your user has not approved yet. Ask them to open ${state.verificationUrl}, then run the same command again.`,
    )
    return 2
  }
  await dropPending(env, providerRef)
  out(notApproved(answer.status))
  return 1
}

function notApproved(status) {
  return (
    {
      denied:
        'Your user turned this connection down. If they change their mind, run the same command again to ask again.',
      expired:
        'The request expired before your user answered. Run the same command again to ask again.',
      claimed: 'This request was already completed; its key was saved then.',
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
  const agent = CLIENTS[name]
  if (!agent)
    throw new Error(
      `launch needs the agent, one of: ${Object.keys(CLIENTS).join(', ')} (got ${name ?? 'nothing'})`,
    )
  if (!merchant)
    throw new Error(
      `launch needs the merchant: launch ${name} <merchant launch name or providerRef>`,
    )
  const providerRef = PROVIDER_REF.test(merchant)
    ? merchant
    : await merchantByName(flags.api ?? DEFAULT_API, merchant)
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
      body: JSON.stringify({
        providerRef,
        name: flags.name ?? agent.displayName,
        client: agent.client,
      }),
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
    const answer = await waitForApproval(
      { api: base, ...opened },
      Number.isFinite(deadline) ? deadline : Date.now() + 600_000,
      sleep,
    )
    if (answer.status !== 'approved') {
      throw new Error(
        {
          pending: 'The connection was not approved in time. Launch again for a new link.',
          denied:
            'You turned this connection down, so nothing was started. Launch again to ask once more.',
          expired: 'The connection expired before it was approved. Launch again for a new link.',
        }[answer.status] ?? `Unexpected answer: ${answer.status}`,
      )
    }
    const file = await saveKey(env, { ...answer, api: base })
    say(
      `Connected to ${answer.merchantName} as agent ${answer.agentRef}. The key is saved in ${file}.`,
    )
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
  say(
    `Starting ${agent.displayName} on ${modelUrl} with ${model}, paid by agent ${saved.agentRef} through SolvaPay…`,
  )
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
 * The listed merchant whose launch name is `name`, e.g. `acme` or `acme.com`:
 * a name the merchant claimed in the SolvaPay catalog, unique across
 * merchants, and a domain only once it proved it owns it. Matched exactly, so
 * a launch never pays a merchant the user did not mean.
 */
async function merchantByName(base, name) {
  const handle = name.trim().toLowerCase()
  try {
    return (await api(base, `/catalog/merchants/${encodeURIComponent(handle)}`)).providerRef
  } catch (error) {
    if (error.status === 404) {
      throw new Error(
        `No merchant in the SolvaPay catalog is called "${handle}". Use its launch name or its prov_… reference.`,
      )
    }
    throw error
  }
}

/** What the agent has spent since `since`, read with its key; refused when the key is unknown or revoked. */
async function spendSince(base, agentKey, since, file) {
  const response = await fetch(
    `${base.replace(/\/+$/, '')}/agent/spend?since=${encodeURIComponent(since)}`,
    {
      headers: { authorization: `Bearer ${agentKey}` },
    },
  )
  const text = await response.text()
  if (response.status === 401) {
    throw new Error(
      `SolvaPay refused this machine's agent key (401: ${text.slice(0, 300)}). ` +
        `Its owner may have revoked it in their SolvaPay account. To connect a new one, remove ${file} and launch again.`,
    )
  }
  if (!response.ok)
    throw new Error(`GET /agent/spend answered ${response.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

/** Starts the agent attached to this terminal and resolves with its exit code. */
function runAttached({ command, args, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' })
    child.on('error', error =>
      reject(
        error.code === 'ENOENT' ? new Error(`${command} is not installed or not on PATH`) : error,
      ),
    )
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

/** Runs a command to its end and resolves with its exit code and everything it printed. */
function runCaptured(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => (output += chunk))
    child.stderr.on('data', chunk => (output += chunk))
    child.on('error', error =>
      reject(
        error.code === 'ENOENT' ? new Error(`${command} is not installed or not on PATH`) : error,
      ),
    )
    child.on('close', code => resolve({ code: code ?? 1, output }))
  })
}

const USAGE = [
  'Usage:',
  '  solvapay launch <claude|hermes> <merchant launch name or providerRef> [--model-url <anthropic-compatible url>] [--model <id>] [--api <url>] [--name <name>] [-- <agent args>]',
  '  solvapay connect <merchant launch name or providerRef> --client <claude|hermes> [--name <name>] [--api <url>] [--mcp-url <url>] [--model-url <anthropic-compatible url> --model <id>] [--add-mcp] [--timeout <seconds>] [--new]',
  '      Run it again until it says connected: the first run asks the owner, a later one waits for their answer.',
  "      --add-mcp (with --client claude) adds the merchant's MCP server to Claude Code at user scope, paying with the key.",
].join('\n')

export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env
  const out = deps.out ?? (text => console.log(text))
  const say = deps.say ?? (text => console.error(text))
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const run = deps.run ?? runAttached
  const exec = deps.exec ?? runCaptured
  // How the agent runs this CLI again, in the commands it prints: the preview build says so.
  const npx = deps.npx ?? 'npx solvapay'
  const [command, ...rest] = argv
  if (command === 'launch') return launch(parseArgs(rest), env, say, sleep, run)
  if (command === 'connect') return connect(parseArgs(rest), env, out, sleep, exec, npx)
  out(USAGE)
  return 64
}
