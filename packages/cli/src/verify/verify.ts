/**
 * `solvapay verify <server-url>`: read-only contract checks against a running
 * SolvaPay MCP server, in any language (TypeScript, Python, Go).
 *
 * - `/.well-known/oauth-protected-resource` and
 *   `/.well-known/oauth-authorization-server` have the expected shape.
 * - An MCP session opens (`initialize`, as hosts do) and `tools/list` has the
 *   intent tools (`account`, `activate_plan`) and no UI-only tools, or the
 *   server answers 401 with a well-formed
 *   `WWW-Authenticate: Bearer resource_metadata="…"` challenge.
 * - With a bearer token: `account` is read first, and when it reports that the
 *   customer can already pay (`customer.canCall: true`) no paid tool is called,
 *   so verify never charges. Otherwise a paid tool called without a plan returns text-only
 *   narration that names `account`, with a checkout URL and no UI payload;
 *   `account` with no `mode` returns its default view; `account` in text
 *   mode is not a bootstrap error.
 *
 * The result is a JSON map of passed / failed / skipped checks. Taken from the
 * TypeScript MCP template's `scripts/verify.mjs`.
 */
import {
  getJson,
  openSession,
  RpcError,
  toServerRoot,
  type McpSession,
  type RpcOptions,
  type ToolCallResult,
  type ToolDescriptor,
} from './mcp-client'
import { probeArguments } from './probe-args'

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

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const failure = (err: unknown): CheckResult => ({
  status: 'failed',
  error: errorText(err),
  info: err instanceof RpcError ? err.info : undefined,
})

const run = async (fn: () => Promise<Record<string, unknown>>): Promise<CheckResult> => {
  try {
    return { status: 'passed', value: await fn() }
  } catch (err) {
    return failure(err)
  }
}

/** A tool only the SolvaPay widget calls: tagged `audience: "ui"` by every SDK. */
const isUiTool = (tool: ToolDescriptor): boolean =>
  tool._meta?.audience === 'ui' || UI_TOOL_HINTS.includes(tool.name)

type ToolsListOutcome = {
  check: CheckResult
  /** The open session, when `initialize` succeeded. */
  session?: McpSession
  /** The listed tools, when `tools/list` answered. */
  tools?: ToolDescriptor[]
  /** The server answered 401 with a well-formed challenge. */
  authRequired: boolean
}

const runToolsListCheck = async (
  serverUrl: string,
  rpcOptions: RpcOptions,
): Promise<ToolsListOutcome> => {
  let session: McpSession
  try {
    session = await openSession(serverUrl, rpcOptions)
  } catch (err) {
    if (err instanceof RpcError && err.info.httpStatus === 401) {
      const challenge = err.info.wwwAuthenticate ?? ''
      if (rpcOptions.bearerToken) {
        return {
          check: {
            status: 'failed',
            error: 'server rejected the bearer token from --credentials-file (HTTP 401)',
            info: { wwwAuthenticate: challenge || null },
          },
          authRequired: true,
        }
      }
      if (/^Bearer\b/i.test(challenge) && /resource_metadata="/.test(challenge)) {
        return {
          check: { status: 'passed', value: { authRequired: true, wwwAuthenticate: challenge } },
          authRequired: true,
        }
      }
      return {
        check: {
          status: 'failed',
          error: 'server returned 401 without a well-formed `WWW-Authenticate: Bearer …` challenge',
          info: { wwwAuthenticate: challenge || null },
        },
        authRequired: false,
      }
    }
    return {
      check: failure(new Error(`MCP initialize failed: ${errorText(err)}`)),
      authRequired: false,
    }
  }

  let tools: ToolDescriptor[]
  try {
    tools = await session.listTools()
  } catch (err) {
    return { check: failure(err), session, authRequired: false }
  }

  const names = tools.map(tool => tool.name)
  try {
    for (const intent of INTENT_TOOLS) {
      assert(names.includes(intent), `intent tool \`${intent}\` missing from tools/list`)
    }
    const leakedUi = tools.filter(isUiTool).map(tool => tool.name)
    assert(
      leakedUi.length === 0,
      `UI-only tools leaked to text catalog: ${leakedUi.join(', ')}. Hide tools whose audience is "ui".`,
    )
    return {
      check: {
        status: 'passed',
        value: {
          toolCount: names.length,
          names,
          authRequired: false,
          sessionPinned: Boolean(session.sessionId),
          protocolVersion: session.protocolVersion,
        },
      },
      session,
      tools,
      authRequired: false,
    }
  } catch (err) {
    return { check: failure(err), session, tools, authRequired: false }
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

const firstLine = (text: string): string => text.split(/\r?\n/)[0].slice(0, 200)

/**
 * Calls each listed tool that is neither an intent tool nor a widget-only tool,
 * with arguments built from its `inputSchema`, until one answers with a paywall
 * gate, and checks that gate's shape. Skipped when no tool gates (free tools,
 * or a customer with balance left); the reason names the calls that errored.
 */
const runPaywallGateCheck = async (
  session: McpSession,
  tools: ToolDescriptor[],
): Promise<CheckResult> => {
  const candidates = tools.filter(tool => !INTENT_TOOLS.includes(tool.name) && !isUiTool(tool))
  if (candidates.length === 0) {
    return { status: 'skipped', reason: 'no tools listed besides the intent and widget tools' }
  }
  const errors: string[] = []
  for (const tool of candidates) {
    const args = probeArguments(tool)
    let response: ToolCallResult
    try {
      response = await session.callTool(tool.name, args)
    } catch (err) {
      errors.push(`${tool.name}: ${firstLine(errorText(err))}`)
      continue
    }
    const gate = isPaywallGate(response?.structuredContent)
    if (!gate) {
      if (response?.isError) {
        errors.push(
          `${tool.name}: ${firstLine(response.content?.[0]?.text ?? 'isError with no text')}`,
        )
      }
      continue
    }
    try {
      assertPaywallGateShape(tool.name, response, gate)
      return {
        status: 'passed',
        value: {
          tool: tool.name,
          arguments: args,
          kind: gate.kind,
          narrationLength: response.content?.[0]?.text?.length,
        },
      }
    } catch (err) {
      return failure(err)
    }
  }
  if (errors.length > 0) {
    return {
      status: 'skipped',
      reason:
        `no candidate tool returned a paywall gate; ${errors.length} of ${candidates.length} ` +
        `call(s) errored instead, so the gate may never have been reached: ${errors.join('; ')}`,
    }
  }
  return {
    status: 'skipped',
    reason:
      'no candidate tool returned a paywall gate (the tools may all be free, or the customer has unused balance)',
  }
}

type IntentToolsOutcome = {
  check: CheckResult
  /** The `account` response, when the call answered. */
  account?: ToolCallResult
}

const runIntentToolsTextCheck = async (session: McpSession): Promise<IntentToolsOutcome> => {
  let response: ToolCallResult
  try {
    response = await session.callTool('account', {})
  } catch (err) {
    return {
      check: { status: 'failed', error: `account (no mode) call failed: ${errorText(err)}` },
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
    return {
      check: { status: 'passed', value: { account: { narrationLength: text.length } } },
      account: response,
    }
  } catch (err) {
    return { check: failure(err), account: response }
  }
}

/**
 * Whether a paid call would be charged: every SDK's `account` response reports
 * `customer.canCall: true` when the customer's plan or balance covers a call.
 */
const customerCanAlreadyPay = (account: ToolCallResult): boolean => {
  const customer = account.structuredContent?.customer as { canCall?: unknown } | undefined
  return customer?.canCall === true
}

const CUSTOMER_CAN_PAY: CheckResult = {
  status: 'skipped',
  reason:
    'this customer can already pay (account reports canCall: true), so a paid call would be ' +
    'charged. Sign in as a customer with no plan on this product to check the paywall',
}

const ACCOUNT_UNANSWERED: CheckResult = {
  status: 'skipped',
  reason:
    "not run: the account call failed, so verify can't tell whether a paid call would be charged " +
    '(see the intentToolsText check)',
}

const runMerchantBootstrapCheck = async (session: McpSession): Promise<CheckResult> => {
  let response: ToolCallResult
  try {
    response = await session.callTool('account', { mode: 'text' })
  } catch (err) {
    return failure(new Error(`account call failed: ${errorText(err)}`))
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

const NEEDS_TOKEN = (what: string): CheckResult => ({
  status: 'skipped',
  reason: `server requires bearer auth; pass \`--credentials-file <path>\` to exercise ${what}`,
})

const NO_SESSION: CheckResult = {
  status: 'skipped',
  reason: 'not run: no MCP session could be opened (see the toolsList check)',
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

  const { check, session, tools, authRequired } = await runToolsListCheck(serverUrl, rpcOptions)
  checks.toolsList = check
  const gated = authRequired && !bearerToken

  // `account` runs first: its answer decides whether probing paid tools would charge.
  const intent: IntentToolsOutcome = gated
    ? { check: NEEDS_TOKEN('intent tools') }
    : !session
      ? { check: NO_SESSION }
      : await runIntentToolsTextCheck(session)

  checks.paywallGate = gated
    ? NEEDS_TOKEN('the paywall gate')
    : !session
      ? NO_SESSION
      : !tools
        ? {
            status: 'skipped',
            reason: 'not run: tools/list did not answer (see the toolsList check)',
          }
        : !intent.account
          ? ACCOUNT_UNANSWERED
          : customerCanAlreadyPay(intent.account)
            ? CUSTOMER_CAN_PAY
            : await runPaywallGateCheck(session, tools)

  checks.intentToolsText = intent.check

  checks.merchantBootstrap = !bearerToken
    ? {
        status: 'skipped',
        reason: 'no --credentials-file passed; cannot exercise SolvaPay bootstrap',
      }
    : !session
      ? NO_SESSION
      : await runMerchantBootstrapCheck(session)

  return {
    serverUrl: base,
    checks,
    paidPathVerification: {
      paywallGate: checks.paywallGate.status,
      merchantBootstrap: checks.merchantBootstrap.status,
    },
    warnings: collectWarnings(checks),
    overall: Object.values(checks).every(entry => entry.status !== 'failed') ? 'passed' : 'failed',
  }
}
