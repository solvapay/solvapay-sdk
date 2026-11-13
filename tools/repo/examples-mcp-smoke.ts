/**
 * Boots every example MCP server for real and drives it over MCP.
 *
 * Each server runs against an in-process fake SolvaPay backend, so the suite
 * needs no keys and no network. For every example it checks, in order:
 *
 *   1. the OAuth protected-resource metadata is served
 *   2. `initialize` answers
 *   3. `tools/list` names the example's own tools and the `account` tool
 *   4. a paid tool call with no sign-in is refused with the sign-in challenge
 *   5. a signed-in paid tool call passes the limits gate and runs the tool
 *   6. the `account` tool answers for the signed-in customer
 *
 * Usage:
 *   pnpm test:examples:mcp                 # every example
 *   pnpm test:examples:mcp --only go-weather,ruby-bitcoin
 *   pnpm test:examples:mcp --verbose       # print each server's log on failure and success
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { EXAMPLES_DIR, sdkDir, tsPackageDir } from '../shared/paths.js'

const PUBLIC_BASE_URL = 'https://mcp-smoke.example'
const PRODUCT_REF = 'prd_smoke'
const CUSTOMER_REF = 'cus_smoke'
const BOOT_TIMEOUT_MS = 180_000
const TOOLS_LIST = ['tools', 'list'].join('/')
const TOOLS_CALL = ['tools', 'call'].join('/')

interface Example {
  id: string
  label: string
  /** Directory the server is started from, as segments under the examples directory. */
  cwd: string[]
  command: string
  /** `{port}` and `{backend}` are replaced with the listen port and the fake backend URL. */
  args: string[]
  /** Extra environment. `{port}` is replaced with the listen port. */
  env?: Record<string, string>
  /** Commands run in `cwd` before the server starts, as the example's own scripts do. */
  prepare?: Array<{ command: string; args: string[] }>
  /** Boot allowance for an example that compiles on start. Default `BOOT_TIMEOUT_MS`. */
  bootTimeoutMs?: number
  /** MCP endpoint path. */
  mcpPath: string
  /** A paid tool of the example, with arguments that are valid offline. */
  tool: string
  toolArgs: Record<string, unknown>
  /**
   * `true` when the tool answers from bundled fixtures. `false` when it calls
   * a live upstream: the suite then only requires that the paywall let the
   * call through, since the upstream may be out of reach.
   */
  offlineTool: boolean
  /** Text the paid tool's answer must contain, when the answer is deterministic. */
  expectText?: string
  /** `false` for the minimal examples that register no SolvaPay tools of their own. */
  accountTool: boolean
}

function say(line: string): void {
  process.stdout.write(`${line}\n`)
}

/**
 * `PATH` for the example servers: toolchains that live outside a default shell
 * `PATH` come first. Homebrew's Ruby is keg-only, and rustup's shims sit in
 * the home directory, so a plain terminal finds neither.
 */
function toolchainPath(): string {
  const extra = [
    path.join(os.homedir(), '.cargo', 'bin'),
    path.join('/opt', 'homebrew', 'opt', 'ruby', 'bin'),
    path.join('/usr', 'local', 'opt', 'ruby', 'bin'),
  ].filter(dir => existsSync(dir))
  return [...extra, process.env.PATH ?? ''].join(path.delimiter)
}

/** `wrangler dev` arguments: a local workerd on the suite's port, pointed at the fake backend. */
function wranglerDev(...extra: string[]): string[] {
  return [
    'exec',
    'wrangler',
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    '{port}',
    '--var',
    'SOLVAPAY_SECRET_KEY:sk_sandbox_smoke',
    '--var',
    `SOLVAPAY_PRODUCT_REF:${PRODUCT_REF}`,
    '--var',
    `MCP_PUBLIC_BASE_URL:${PUBLIC_BASE_URL}`,
    '--var',
    'SOLVAPAY_API_BASE_URL:{backend}',
    ...extra,
  ]
}

const WRANGLER_ENV = { WRANGLER_SEND_METRICS: 'false', CI: '1' }

const EXAMPLES: Example[] = [
  {
    id: 'ts-checkout-app',
    label: 'TypeScript mcp-checkout-app',
    cwd: ['typescript', 'mcp-checkout-app'],
    // Builds the widget HTML the server reads on start.
    prepare: [{ command: 'pnpm', args: ['build'] }],
    command: 'pnpm',
    args: ['exec', 'tsx', 'src/index.ts'],
    env: { NODE_OPTIONS: '--conditions=development' },
    mcpPath: '/mcp',
    tool: 'get_market_quote',
    toolArgs: { symbol: 'AAPL' },
    offlineTool: true,
    accountTool: true,
  },
  {
    id: 'ts-time-app',
    label: 'TypeScript mcp-time-app',
    cwd: ['typescript', 'mcp-time-app'],
    // Builds the widget HTML the server reads on start.
    prepare: [{ command: 'pnpm', args: ['build'] }],
    command: 'pnpm',
    args: ['exec', 'tsx', 'src/index.ts'],
    mcpPath: '/mcp',
    tool: 'get-current-time',
    toolArgs: {},
    offlineTool: true,
    accountTool: false,
  },
  {
    id: 'ts-oauth-bridge',
    label: 'TypeScript mcp-oauth-bridge',
    cwd: ['typescript', 'mcp-oauth-bridge'],
    command: 'pnpm',
    args: ['exec', 'tsx', 'src/index.ts'],
    mcpPath: '/mcp',
    tool: 'create_task',
    toolArgs: { title: 'Smoke task' },
    offlineTool: true,
    accountTool: false,
  },
  {
    id: 'ts-workers',
    label: 'TypeScript cloudflare-workers-mcp (wrangler dev)',
    cwd: ['typescript', 'cloudflare-workers-mcp'],
    // Builds the widget HTML the server reads on start.
    prepare: [{ command: 'pnpm', args: ['build'] }],
    command: 'pnpm',
    args: wranglerDev(),
    env: WRANGLER_ENV,
    mcpPath: '/mcp',
    tool: 'predict_direction',
    toolArgs: { symbol: 'AAPL' },
    offlineTool: true,
    // `days` is left out on purpose: the schema default must reach the handler.
    expectText: 'AAPL 10-day verdict',
    accountTool: true,
  },
  {
    id: 'ts-supabase-edge',
    label: 'TypeScript supabase-edge-mcp (deno run)',
    cwd: ['typescript', 'supabase-edge-mcp'],
    // Builds the widget HTML the server reads on start.
    prepare: [{ command: 'pnpm', args: ['build'] }],
    // Deno comes from the example's own devDependency, pinned to a release
    // that runs the WASM core; no global install is involved.
    command: 'pnpm',
    args: [
      'exec',
      'deno',
      'run',
      '--allow-all',
      '--config=deno.workspace.json',
      path.join('supabase', 'functions', 'mcp', 'index.ts'),
    ],
    env: { DENO_SERVE_ADDRESS: 'tcp:127.0.0.1:{port}', DENO_NO_UPDATE_CHECK: '1' },
    mcpPath: '/mcp',
    tool: 'predict_direction',
    toolArgs: { symbol: 'AAPL' },
    offlineTool: true,
    expectText: 'AAPL 10-day verdict',
    accountTool: true,
  },
  {
    id: 'python-stock-research',
    label: 'Python stock-research-mcp',
    cwd: ['python', 'stock-research-mcp'],
    command: 'uv',
    args: [
      'run',
      '--project',
      sdkDir('pythonMcp'),
      '--extra',
      'dev',
      '--with',
      'httpx',
      '--with',
      'uvicorn',
      'python',
      'main.py',
      '--mode',
      'http',
    ],
    mcpPath: '/mcp',
    tool: 'top_ranked_assets',
    toolArgs: {},
    offlineTool: false,
    accountTool: true,
  },
  {
    id: 'python-workers',
    label: 'Python cloudflare-workers-mcp (pywrangler dev)',
    cwd: ['python', 'cloudflare-workers-mcp'],
    prepare: [{ command: 'node', args: [path.join('scripts', 'stage-server-wasm.mjs')] }],
    command: 'uv',
    args: ['run', 'pywrangler', 'dev', ...wranglerDev().slice(3)],
    env: WRANGLER_ENV,
    mcpPath: '/mcp',
    tool: 'top_ranked_assets',
    toolArgs: {},
    offlineTool: false,
    accountTool: true,
  },
  {
    id: 'ruby-bitcoin',
    label: 'Ruby bitcoin_analytics_mcp',
    cwd: ['ruby', 'bitcoin_analytics_mcp'],
    // As `scripts/http.sh` runs it: plain ruby with the SDK load paths. Needs
    // the `sdks/ruby-mcp` bundle installed and `gem install puma`.
    command: 'ruby',
    args: [
      `-I${path.join(sdkDir('ruby'), 'lib')}`,
      `-I${path.join(sdkDir('rubyMcp'), 'lib')}`,
      'main.rb',
      '--mode',
      'http',
    ],
    env: { MCP_SOURCE: 'fixture' },
    mcpPath: '/mcp',
    tool: 'network_snapshot',
    toolArgs: {},
    offlineTool: true,
    accountTool: true,
  },
  {
    id: 'go-weather',
    label: 'Go weather-mcp',
    cwd: ['go', 'weather-mcp'],
    command: 'go',
    args: ['run', '.', '--mode', 'http'],
    env: { WEATHER_MCP_SOURCE: 'fixture' },
    mcpPath: '/mcp',
    tool: 'get_current_weather',
    toolArgs: { city: 'London' },
    offlineTool: true,
    accountTool: true,
  },
  {
    id: 'rust-guerrillamail',
    label: 'Rust guerrillamail-mcp',
    cwd: ['rust', 'guerrillamail-mcp'],
    command: 'cargo',
    args: ['run', '-q', '-p', 'solvapay-example-guerrillamail-mcp', '--', '--mode', 'http'],
    env: { MCP_SOURCE: 'fixture' },
    mcpPath: '/mcp',
    tool: 'inbox_open',
    toolArgs: {},
    offlineTool: true,
    accountTool: true,
  },
  {
    id: 'rust-workers',
    label: 'Rust cloudflare-worker-mcp (wrangler dev)',
    cwd: ['rust', 'cloudflare-worker-mcp'],
    command: 'pnpm',
    args: wranglerDev(),
    env: WRANGLER_ENV,
    // The first start installs worker-build and compiles the Worker in release mode.
    bootTimeoutMs: 900_000,
    mcpPath: '/mcp',
    tool: 'inbox_open',
    toolArgs: {},
    offlineTool: false,
    accountTool: true,
  },
]

// --- fake SolvaPay backend -------------------------------------------------

interface BackendCall {
  method: string
  path: string
}

function backendAnswer(method: string, url: string): unknown {
  const pathname = url.split('?')[0] ?? url
  if (pathname === '/v1/sdk/platform-config') return { stripePublishableKey: 'pk_test_smoke' }
  if (pathname === '/v1/sdk/merchant') {
    return { displayName: 'Smoke Merchant', legalName: 'Smoke Merchant Inc' }
  }
  if (/^\/v1\/sdk\/products\/[^/]+\/plans$/.test(pathname)) {
    return {
      plans: [
        {
          reference: 'pln_basic',
          name: 'Basic',
          type: 'recurring',
          price: 1000,
          currency: 'USD',
          requiresPayment: true,
          isActive: true,
          options: [],
        },
      ],
    }
  }
  if (/^\/v1\/sdk\/products\/[^/]+$/.test(pathname)) {
    return {
      reference: PRODUCT_REF,
      name: 'Smoke product',
      status: 'active',
      plans: [{ reference: 'pln_basic', name: 'Basic', isActive: true }],
    }
  }
  if (pathname === '/v1/sdk/limits') {
    return {
      withinLimits: true,
      remaining: 10,
      plan: 'pln_basic',
      planRef: 'pln_basic',
      meterName: 'requests',
      checkoutUrl: null,
    }
  }
  if (pathname.startsWith('/v1/sdk/usages')) return { success: true }
  if (pathname === '/v1/sdk/customers/customer-sessions') {
    return { sessionId: 'ps_smoke', customerUrl: 'https://portal.example/ps_smoke' }
  }
  if (/^\/v1\/sdk\/customers\/[^/]+\/balance$/.test(pathname)) {
    return { credits: 0, displayCurrency: 'USD', creditsPerMinorUnit: 100 }
  }
  if (pathname.startsWith('/v1/sdk/customers')) {
    return {
      reference: CUSTOMER_REF,
      customerRef: CUSTOMER_REF,
      externalRef: CUSTOMER_REF,
      email: 'smoke@example.com',
      name: 'Smoke Customer',
      purchases: [],
    }
  }
  if (pathname === '/v1/sdk/user-info') {
    return { customerRef: CUSTOMER_REF, email: 'smoke@example.com', purchases: [] }
  }
  if (pathname === '/v1/customer/auth/userinfo') {
    return { sub: CUSTOMER_REF, email: 'smoke@example.com' }
  }
  if (pathname === '/v1/sdk/checkout-sessions') {
    return { sessionId: 'cs_smoke', checkoutUrl: 'https://checkout.example/cs_smoke' }
  }
  if (pathname === '/v1/sdk/purchases') return { purchases: [] }
  void method
  return null
}

async function startBackend(): Promise<{
  url: string
  calls: BackendCall[]
  close: () => Promise<void>
}> {
  const calls: BackendCall[] = []
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      const method = req.method ?? 'GET'
      const url = req.url ?? '/'
      calls.push({ method, path: url })
      const answer = backendAnswer(method, url)
      res.writeHead(answer === null ? 404 : 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(answer ?? { error: 'not found' }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

// --- MCP probe ---------------------------------------------------------------

interface RpcAnswer {
  status: number
  challenge: string | null
  json: {
    result?: Record<string, unknown>
    error?: { code?: number; message?: string }
  }
}

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/**
 * A bearer the servers accept through their remote validator: the fake
 * backend's userinfo endpoint vouches for it, and its issuer and audience
 * match the public origin the server was started with.
 */
function bearer(audience: string): string {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: PUBLIC_BASE_URL,
    aud: audience,
    sub: CUSTOMER_REF,
    customerRef: CUSTOMER_REF,
    token_use: 'mcp_access',
    iat: now,
    exp: now + 600,
  }
  return `${base64Url({ alg: 'RS256', typ: 'JWT' })}.${base64Url(claims)}.c21va2U`
}

function makeClient(endpoint: string, token: string) {
  let session: string | null = null
  let nextId = 1
  return async function rpc(
    method: string,
    params: Record<string, unknown>,
    signedIn: boolean,
  ): Promise<RpcAnswer> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    }
    if (signedIn) headers.authorization = `Bearer ${token}`
    if (session !== null) headers['mcp-session-id'] = session
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    })
    session = response.headers.get('mcp-session-id') ?? session
    const text = await response.text()
    let json: RpcAnswer['json'] = {}
    try {
      json = JSON.parse(text) as RpcAnswer['json']
    } catch {
      // Streamable HTTP may answer one JSON-RPC message as an SSE event.
      const event = /^data: (.*)$/m.exec(text)
      if (event?.[1] !== undefined) json = JSON.parse(event[1]) as RpcAnswer['json']
    }
    return { status: response.status, challenge: response.headers.get('www-authenticate'), json }
  }
}

interface Check {
  name: string
  ok: boolean
  detail: string
}

function firstText(result: Record<string, unknown> | undefined): string {
  const content = Array.isArray(result?.content) ? result.content : []
  const first = content[0] as { text?: unknown } | undefined
  return typeof first?.text === 'string' ? first.text : ''
}

async function probe(example: Example, origin: string, calls: BackendCall[]): Promise<Check[]> {
  const checks: Check[] = []
  const record = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })
  const endpoint = `${origin}${example.mcpPath}`
  const audiences = [`${PUBLIC_BASE_URL}${example.mcpPath}`, PUBLIC_BASE_URL]

  const metadata = await fetch(`${origin}/.well-known/oauth-protected-resource`)
  record('protected-resource metadata', metadata.status === 200, `HTTP ${metadata.status}`)

  // Servers differ on whether the token audience is the origin or the MCP URL.
  let rpc = makeClient(endpoint, bearer(audiences[0] ?? PUBLIC_BASE_URL))
  let init = await rpc(
    'initialize',
    {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'solvapay-examples-smoke', version: '1.0.0' },
    },
    true,
  )
  if (init.status === 401) {
    rpc = makeClient(endpoint, bearer(audiences[1] ?? PUBLIC_BASE_URL))
    init = await rpc(
      'initialize',
      {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'solvapay-examples-smoke', version: '1.0.0' },
      },
      true,
    )
  }
  const serverInfo = init.json.result?.serverInfo as { name?: string } | undefined
  record(
    'initialize',
    init.status === 200 && serverInfo?.name !== undefined,
    init.status === 200 ? `server ${serverInfo?.name ?? '?'}` : `HTTP ${init.status}`,
  )

  const listed = await rpc(TOOLS_LIST, {}, true)
  const tools = Array.isArray(listed.json.result?.tools)
    ? (listed.json.result.tools as { name: string }[]).map(tool => tool.name)
    : []
  record(
    TOOLS_LIST,
    tools.includes(example.tool) && (!example.accountTool || tools.includes('account')),
    tools.length > 0 ? `${tools.length} tools` : `HTTP ${listed.status}, no tools`,
  )

  const anonymous = await rpc(
    TOOLS_CALL,
    { name: example.tool, arguments: example.toolArgs },
    false,
  )
  const gateText = firstText(anonymous.json.result)
  const refused =
    (anonymous.status === 401 && anonymous.challenge !== null) ||
    anonymous.json.result?.isError === true ||
    /sign in|activate|upgrade|account/i.test(gateText)
  record(
    'paid call without sign-in is refused',
    refused,
    anonymous.status === 401 ? '401 with WWW-Authenticate' : `HTTP ${anonymous.status}`,
  )

  const limitsBefore = calls.filter(call => call.path.startsWith('/v1/sdk/limits')).length
  const paid = await rpc(TOOLS_CALL, { name: example.tool, arguments: example.toolArgs }, true)
  const limitsAfter = calls.filter(call => call.path.startsWith('/v1/sdk/limits')).length
  const paidError = paid.json.result?.isError === true || paid.json.error !== undefined
  const gated = paid.status === 200 && limitsAfter > limitsBefore
  record(
    'signed-in paid call passes the limits gate',
    gated,
    gated ? 'limits checked' : `HTTP ${paid.status}, limits ${limitsBefore} to ${limitsAfter}`,
  )
  if (example.offlineTool) {
    const text = firstText(paid.json.result)
    const expected = example.expectText === undefined || text.includes(example.expectText)
    record(
      'paid tool returns its result',
      gated && !paidError && expected,
      paidError
        ? (paid.json.error?.message ?? text.slice(0, 120))
        : expected
          ? text.slice(0, 60)
          : `expected "${example.expectText}" in: ${text.slice(0, 80)}`,
    )
  }

  if (example.accountTool) {
    const account = await rpc(TOOLS_CALL, { name: 'account', arguments: { mode: 'text' } }, true)
    const accountText = firstText(account.json.result)
    record(
      'account tool answers',
      account.status === 200 && account.json.result?.isError !== true && accountText.length > 0,
      accountText.length > 0
        ? (accountText.split('\n')[0]?.slice(0, 60) ?? '')
        : `HTTP ${account.status}`,
    )
  }
  return checks
}

// --- process control -----------------------------------------------------------

async function freePort(): Promise<number> {
  const server = http.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

async function waitForServer(
  origin: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false
    try {
      await fetch(`${origin}/.well-known/oauth-protected-resource`)
      return true
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  return false
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.pid === undefined) {
      resolve()
      return
    }
    child.once('exit', () => resolve())
    // The server may be a grandchild of a package runner: stop the whole group.
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
    setTimeout(() => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
      resolve()
    }, 5000)
  })
}

async function runExample(example: Example, verbose: boolean): Promise<Check[]> {
  const backend = await startBackend()
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  let log = ''
  const args = example.args.map(arg =>
    arg.replaceAll('{port}', String(port)).replaceAll('{backend}', backend.url),
  )
  const cwd = path.join(EXAMPLES_DIR, ...example.cwd)
  for (const step of example.prepare ?? []) {
    const prepared = spawnSync(step.command, step.args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, PATH: toolchainPath() },
    })
    if (prepared.status !== 0) {
      await backend.close()
      return [
        {
          name: 'prepare',
          ok: false,
          detail: `${step.command} ${step.args.join(' ')}: ${(prepared.stderr || prepared.stdout).trim().split('\n').slice(-3).join(' | ')}`,
        },
      ]
    }
  }
  const child = spawn(example.command, args, {
    cwd,
    detached: true,
    env: {
      ...process.env,
      PATH: toolchainPath(),
      SOLVAPAY_SECRET_KEY: 'sk_sandbox_smoke',
      SOLVAPAY_PRODUCT: PRODUCT_REF,
      SOLVAPAY_PRODUCT_REF: PRODUCT_REF,
      SOLVAPAY_API_BASE_URL: backend.url,
      MCP_HOST: '127.0.0.1',
      MCP_PORT: String(port),
      MCP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
      ...Object.fromEntries(
        Object.entries(example.env ?? {}).map(([key, value]) => [
          key,
          value.replaceAll('{port}', String(port)),
        ]),
      ),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', chunk => (log += String(chunk)))
  child.stderr?.on('data', chunk => (log += String(chunk)))
  try {
    const up = await waitForServer(origin, child, example.bootTimeoutMs ?? BOOT_TIMEOUT_MS)
    if (!up) {
      say(`--- ${example.id} server log ---\n${log.trim().split('\n').slice(-40).join('\n')}`)
      return [{ name: 'server starts', ok: false, detail: 'exited or never listened; log above' }]
    }
    const checks = await probe(example, origin, backend.calls)
    if (verbose || checks.some(check => !check.ok)) {
      say(`--- ${example.id} server log ---\n${log.trim().split('\n').slice(-30).join('\n')}`)
      say(
        `--- ${example.id} backend calls ---\n${backend.calls.map(call => `${call.method} ${call.path}`).join('\n')}`,
      )
    }
    return [{ name: 'server starts', ok: true, detail: origin }, ...checks]
  } catch (error) {
    return [
      {
        name: 'probe',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      },
    ]
  } finally {
    await stop(child)
    await backend.close()
  }
}

/**
 * The examples load the SDKs from this checkout, so the SDK builds must exist.
 * Returns what is missing, in words a person can act on.
 */
function missingBuilds(): string[] {
  const missing: string[] = []
  for (const id of ['core', 'server', 'mcp-core', 'mcp', 'react'] as const) {
    if (!existsSync(path.join(tsPackageDir(id), 'dist'))) missing.push(`@solvapay/${id} build`)
  }
  const nativeDir = sdkDir('node-native')
  if (!existsSync(nativeDir) || !readdirSync(nativeDir).some(name => name.endsWith('.node'))) {
    missing.push('Node native binding')
  }
  return missing
}

async function main(argv: string[]): Promise<number> {
  const missing = missingBuilds()
  if (missing.length > 0) {
    console.error(
      `Not built yet: ${missing.join(', ')}.\nRun \`pnpm build:all --native\` first, then rerun.`,
    )
    return 2
  }
  const verbose = argv.includes('--verbose')
  const onlyIndex = argv.indexOf('--only')
  const only = onlyIndex >= 0 ? (argv[onlyIndex + 1] ?? '').split(',').filter(Boolean) : []
  const unknown = only.filter(id => !EXAMPLES.some(example => example.id === id))
  if (unknown.length > 0) {
    console.error(
      `Unknown example: ${unknown.join(', ')}. Valid: ${EXAMPLES.map(e => e.id).join(', ')}`,
    )
    return 2
  }
  const selected =
    only.length > 0 ? EXAMPLES.filter(example => only.includes(example.id)) : EXAMPLES

  let failed = 0
  for (const example of selected) {
    say(`\n▸ ${example.label}`)
    const checks = await runExample(example, verbose)
    for (const check of checks) {
      say(
        `  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name}${check.detail ? `  (${check.detail})` : ''}`,
      )
    }
    if (checks.some(check => !check.ok)) failed += 1
  }
  say(`\nexamples MCP smoke: ${selected.length - failed} ok, ${failed} failed`)
  return failed === 0 ? 0 : 1
}

main(process.argv.slice(2)).then(
  code => process.exit(code),
  error => {
    console.error(error)
    process.exit(1)
  },
)
