/**
 * `solvapay verify <server-url>`: read-only contract checks against a running
 * SolvaPay MCP server, in any language (TypeScript, Python, Go).
 *
 * - `/.well-known/oauth-protected-resource` and
 *   `/.well-known/oauth-authorization-server` have the expected shape.
 * - `tools/list` has the intent tools (`account`, `activate_plan`) and no
 *   UI-only tools, or the server answers 401 with a well-formed
 *   `WWW-Authenticate: Bearer resource_metadata="…"` challenge.
 * - With a bearer token: a paid tool called without a plan returns text-only
 *   narration that names `account`, with a checkout URL and no UI payload;
 *   `account` with no `mode` returns its default view; `account` in text
 *   mode is not a bootstrap error.
 *
 * The result is a JSON map of passed / failed / skipped checks. Taken from the
 * TypeScript MCP template's `scripts/verify.mjs`, which it matches.
 */
import {
  callTool,
  getJson,
  listTools,
  RpcError,
  toServerRoot,
  type RpcOptions,
  type ToolCallResult,
} from './mcp-client'

const INTENT_TOOLS = ['account', 'activate_plan']
const UI_TOOL_HINTS = ['create_payment_intent', 'create_hosted_session']

export type CheckResult =
  | { status: 'passed'; value: Record<string, unknown> }
  | { status: 'failed'; error: string; info?: unknown }
  | { status: 'skipped'; reason: string }

export type VerifySummary = {
  serverUrl: string
  checks: Record<string, CheckResult>
  paidPathVerification: {
    paywallGate: CheckResult['status']
    merchantBootstrap: CheckResult['status']
  }
  warnings: string[]
  overall: 'passed' | 'failed'
}

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const failure = (err: unknown): CheckResult => ({
  status: 'failed',
  error: err instanceof Error ? err.message : String(err),
  info: err instanceof RpcError ? err.info : undefined,
})

const run = async (fn: () => Promise<Record<string, unknown>>): Promise<CheckResult> => {
  try {
    return { status: 'passed', value: await fn() }
  } catch (err) {
    return failure(err)
  }
}

type ToolsListValue = { names?: string[]; authRequired: boolean }

const runToolsListCheck = async (base: string, rpcOptions: RpcOptions): Promise<CheckResult> => {
  try {
    const names = (await listTools(base, rpcOptions)).map(tool => tool.name)
    for (const intent of INTENT_TOOLS) {
      assert(names.includes(intent), `intent tool \`${intent}\` missing from tools/list`)
    }
    const leakedUi = names.filter(name => UI_TOOL_HINTS.includes(name))
    assert(
      leakedUi.length === 0,
      `UI-only tools leaked to text catalog: ${leakedUi.join(', ')}. Hide tools whose audience is "ui".`,
    )
    return { status: 'passed', value: { toolCount: names.length, names, authRequired: false } }
  } catch (err) {
    if (err instanceof RpcError && err.info.httpStatus === 401) {
      const challenge = err.info.wwwAuthenticate ?? ''
      if (/^Bearer\b/i.test(challenge) && /resource_metadata="/.test(challenge)) {
        return { status: 'passed', value: { authRequired: true, wwwAuthenticate: challenge } }
      }
      return {
        status: 'failed',
        error: 'server returned 401 without a well-formed `WWW-Authenticate: Bearer …` challenge',
        info: { wwwAuthenticate: challenge || null },
      }
    }
    return failure(err)
  }
}

const isPaywallGate = (structured: unknown): Record<string, unknown> | null => {
  if (!structured || typeof structured !== 'object') return null
  const kind = (structured as { kind?: unknown }).kind
  return kind === 'payment_required' || kind === 'activation_required'
    ? (structured as Record<string, unknown>)
    : null
}

const isHttpsUrl = (value: unknown): boolean =>
  typeof value === 'string' && /^https:\/\//i.test(value)

const assertPaywallGateShape = (
  name: string,
  response: ToolCallResult,
  gate: Record<string, unknown>,
): void => {
  assert(
    Array.isArray(response.content) && response.content[0]?.type === 'text',
    `gate response on \`${name}\` must put narration in content[0].text`,
  )
  const text = response.content[0].text
  assert(typeof text === 'string' && text.length > 0, `gate narration on \`${name}\` is empty`)
  assert(
    INTENT_TOOLS.some(intent => text.includes(intent)),
    `gate narration on \`${name}\` must name a recovery intent tool (${INTENT_TOOLS.join(' / ')})`,
  )
  assert(
    !/in the panel/i.test(text),
    `gate narration on \`${name}\` must not point at a panel this host cannot show`,
  )
  assert(
    /https:\/\//i.test(text),
    `gate narration on \`${name}\` must include a pasteable https URL`,
  )
  assert(
    isHttpsUrl(gate.checkoutUrl),
    `gate structuredContent.checkoutUrl on \`${name}\` must be a non-empty https URL`,
  )
  if (gate.planRef !== undefined) {
    assert(
      typeof gate.planRef === 'string' && gate.planRef.length > 0,
      `gate planRef on \`${name}\` is empty`,
    )
  }
  if (Array.isArray(gate.plans)) {
    for (const plan of gate.plans as Array<{ reference?: unknown }>) {
      assert(
        typeof plan?.reference === 'string' && plan.reference.length > 0,
        `gate plans[] on \`${name}\` must each carry a reference`,
      )
    }
  }
  const included = gate.included as Record<string, unknown> | undefined
  if (included) {
    assert(
      typeof included.total === 'number' &&
        typeof included.used === 'number' &&
        typeof included.remaining === 'number',
      `gate included counters on \`${name}\` must be { total, used, remaining }`,
    )
  }
  assert(
    !response._meta?.ui,
    `gate response on \`${name}\` must not advertise a UI resource (_meta.ui must be absent on a gate)`,
  )
}

/**
 * Calls each non-intent, non-UI tool with probe arguments until one answers
 * with a paywall gate, and checks that gate's shape. Skipped when no tool
 * gates (free tools, or a customer with balance left).
 */
const runPaywallGateCheck = async (
  base: string,
  candidates: string[],
  rpcOptions: RpcOptions,
): Promise<CheckResult> => {
  if (candidates.length === 0) return { status: 'skipped', reason: 'no paid tools registered' }
  for (const name of candidates) {
    let response: ToolCallResult
    try {
      response = await callTool(
        base,
        name,
        { query: 'probe', symbol: 'AAPL', ticker: 'AAPL' },
        rpcOptions,
      )
    } catch {
      continue
    }
    const gate = isPaywallGate(response?.structuredContent)
    if (!gate) continue
    try {
      assertPaywallGateShape(name, response, gate)
      return {
        status: 'passed',
        value: { tool: name, narrationLength: response.content?.[0]?.text?.length },
      }
    } catch (err) {
      return failure(err)
    }
  }
  return {
    status: 'skipped',
    reason:
      'no candidate tool returned a paywall gate (the tools may all be free, or the customer has unused balance)',
  }
}

const runIntentToolsTextCheck = async (
  base: string,
  rpcOptions: RpcOptions,
): Promise<CheckResult> => {
  let response: ToolCallResult
  try {
    response = await callTool(base, 'account', {}, rpcOptions)
  } catch (err) {
    return {
      status: 'failed',
      error: `account (no mode) call failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  try {
    assert(
      Array.isArray(response.content) && response.content[0]?.type === 'text',
      '`account` must put narration in content[0].text',
    )
    const text = response.content[0].text ?? ''
    assert(!/in the panel/i.test(text), '`account` default mode must not say "shown in the panel"')
    assert(
      /https:\/\//i.test(text) || /planRef:/.test(text),
      '`account` default mode must include a plan ref or https URL',
    )
    return { status: 'passed', value: { account: { narrationLength: text.length } } }
  } catch (err) {
    return failure(err)
  }
}

const runMerchantBootstrapCheck = async (
  base: string,
  rpcOptions: RpcOptions,
): Promise<CheckResult> => {
  let response: ToolCallResult
  try {
    response = await callTool(base, 'account', { mode: 'text' }, rpcOptions)
  } catch (err) {
    return failure(
      new Error(`account call failed: ${err instanceof Error ? err.message : String(err)}`),
    )
  }
  if (!response || typeof response !== 'object') {
    return { status: 'failed', error: 'account returned no response envelope' }
  }
  const text =
    Array.isArray(response.content) && response.content[0]?.type === 'text'
      ? String(response.content[0].text ?? '')
      : ''
  if (response.isError === true) {
    return { status: 'failed', error: 'account returned an error envelope', info: { text } }
  }
  if (/\bbootstrap\b/i.test(text) && /provider/i.test(text)) {
    return {
      status: 'failed',
      error: 'account narration carries a bootstrap failure',
      info: { text },
    }
  }
  return { status: 'passed', value: { textLength: text.length } }
}

const collectWarnings = (checks: Record<string, CheckResult>): string[] => {
  const warnings: string[] = []
  const gate = checks.paywallGate
  if (gate?.status === 'skipped') {
    warnings.push(
      `Paid-path check skipped: paywallGate (${gate.reason}). This verifies the MCP/OAuth contract, not a complete paid-tool purchase path.`,
    )
  }
  const bootstrap = checks.merchantBootstrap
  if (bootstrap?.status === 'skipped') {
    warnings.push(
      `Paid-path check skipped: merchantBootstrap (${bootstrap.reason}). Pass --credentials-file to exercise the SolvaPay bootstrap path.`,
    )
  }
  return warnings
}

export const verifyServer = async (
  serverUrl: string,
  { bearerToken }: { bearerToken?: string } = {},
): Promise<VerifySummary> => {
  const rpcOptions: RpcOptions = bearerToken ? { bearerToken } : {}
  const base = toServerRoot(serverUrl)
  const checks: Record<string, CheckResult> = {}

  checks.oauthProtectedResource = await run(async () => {
    const meta = await getJson(`${base}/.well-known/oauth-protected-resource`)
    assert(typeof meta.resource === 'string', 'resource must be a string')
    const servers = meta.authorization_servers
    assert(
      Array.isArray(servers) && servers.length > 0,
      'authorization_servers must be a non-empty array',
    )
    return { resource: meta.resource, authServer: servers[0] }
  })

  checks.oauthAuthorizationServer = await run(async () => {
    const meta = await getJson(`${base}/.well-known/oauth-authorization-server`)
    assert(typeof meta.issuer === 'string', 'issuer must be a string')
    assert(
      typeof meta.authorization_endpoint === 'string',
      'authorization_endpoint must be a string',
    )
    assert(typeof meta.token_endpoint === 'string', 'token_endpoint must be a string')
    return { issuer: meta.issuer }
  })

  const toolsResult = await runToolsListCheck(serverUrl, rpcOptions)
  checks.toolsList = toolsResult
  const toolsValue =
    toolsResult.status === 'passed' ? (toolsResult.value as ToolsListValue) : undefined
  const gated = Boolean(toolsValue?.authRequired) && !bearerToken
  const candidates = (toolsValue?.names ?? []).filter(
    name => !INTENT_TOOLS.includes(name) && !UI_TOOL_HINTS.includes(name),
  )

  checks.paywallGate = gated
    ? {
        status: 'skipped',
        reason:
          'server requires bearer auth; pass `--credentials-file <path>` to exercise the paywall gate',
      }
    : await runPaywallGateCheck(serverUrl, candidates, rpcOptions)

  checks.intentToolsText = gated
    ? {
        status: 'skipped',
        reason:
          'server requires bearer auth; pass `--credentials-file <path>` to exercise intent tools',
      }
    : await runIntentToolsTextCheck(serverUrl, rpcOptions)

  checks.merchantBootstrap = bearerToken
    ? await runMerchantBootstrapCheck(serverUrl, rpcOptions)
    : {
        status: 'skipped',
        reason: 'no --credentials-file passed; cannot exercise SolvaPay bootstrap',
      }

  return {
    serverUrl: base,
    checks,
    paidPathVerification: {
      paywallGate: checks.paywallGate.status,
      merchantBootstrap: checks.merchantBootstrap.status,
    },
    warnings: collectWarnings(checks),
    overall: Object.values(checks).every(check => check.status !== 'failed') ? 'passed' : 'failed',
  }
}
