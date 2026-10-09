// Plays the SolvaPay console for this clone until the console exists: signs in
// to a SolvaPay account by email code, connects an agent to this merchant,
// saves a card at the merchant, opens the first credit lot and sets the
// agent's spend policy.
//
//   pnpm agent:connect login <email>
//   pnpm agent:connect verify <email> <code> [agent name]
//   pnpm agent:connect card [amount in cents, default 250]
//   pnpm agent:connect merchant
//   pnpm agent:connect policy create [monthly budget USD, default 5] [--tiers S,M,L]
//                                    [--per-call x] [--ceiling x] [--daily x] [--timezone tz]
//                                    [--max-topup x] [--low-water x]
//   pnpm agent:connect policy update <field=value…>   budget, ceiling, per-call, daily,
//                                    max-topup, low-water, tiers, rate, timezone, status
//   pnpm agent:connect policy show
//
// Local state in data/ (git-ignored, mode 600): agent-credential (never
// printed), agent.json (agent and principal references), account-session (the
// 12-hour account session).
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startCardPageServer } from './card-page-server'

const base = required('SOLVAPAY_API_BASE_URL').replace(/\/+$/, '')
const providerRef = required('SOLVAPAY_PROVIDER_REF')
const dataDir = fileURLToPath(new URL('../data/', import.meta.url))
const files = {
  credential: join(dataDir, 'agent-credential'),
  agent: join(dataDir, 'agent.json'),
  session: join(dataDir, 'account-session'),
}
/** How long `card` waits for the SetupIntent webhook to save the card. */
const CARD_WAIT_MS = 90_000

interface Session {
  token: string
  expiresAt: string
  accountRef: string
}

interface SavedAgent {
  reference: string
  principalRef: string
}

/** The command-line names of a spend policy's limits, and the API field each sets. */
const POLICY_FIELDS: Record<string, (value: string) => Record<string, unknown>> = {
  budget: value => ({ periodBudgetUsd: value }),
  ceiling: value => ({ hardCeilingUsd: value }),
  'per-call': value => ({ perCallCapUsd: value }),
  daily: value => ({ dailyCapUsd: value }),
  'max-topup': value => ({ maxTopupAmountUsd: value }),
  /** A balance below this after an agent's debit decides a top-up of one `max-topup` lot. */
  'low-water': value => ({ lowWaterUsd: value }),
  tiers: value => ({ allowedTiers: value.split(',').map(tier => tier.trim().toUpperCase()) }),
  rate: value => ({ maxCallsPerMinute: Number(value) }),
  timezone: value => ({ timezone: value }),
}

const [command, ...args] = process.argv.slice(2)

try {
  if (command === 'login' && args[0]) {
    await login(args[0])
  } else if (command === 'verify' && args[0] && args[1]) {
    await verify(args[0], args[1], args.slice(2).join(' ') || 'Claude Code')
  } else if (command === 'card') {
    await card(args[0] ? Number(args[0]) : 250)
  } else if (command === 'merchant') {
    print(await call('GET', `/v1/account/merchants/${providerRef}`, undefined, await session()))
  } else if (command === 'policy' && args[0] === 'create') {
    await policyCreate(args.slice(1))
  } else if (command === 'policy' && args[0] === 'update' && args.length > 1) {
    await policyUpdate(args.slice(1))
  } else if (command === 'policy' && args[0] === 'show') {
    await policyShow()
  } else {
    fail(
      'Usage: pnpm agent:connect login <email>\n' +
        '       pnpm agent:connect verify <email> <code> [agent name]\n' +
        '       pnpm agent:connect card [amount in cents, default 250]\n' +
        '       pnpm agent:connect merchant\n' +
        '       pnpm agent:connect policy create [budget, default 5] [--tiers S,M,L] [--per-call x]\n' +
        '                                        [--ceiling x] [--daily x] [--timezone tz]\n' +
        '                                        [--max-topup x] [--low-water x]\n' +
        '       pnpm agent:connect policy update <field=value…>  (' +
        Object.keys(POLICY_FIELDS).join(', ') +
        ', status)\n' +
        '       pnpm agent:connect policy show',
    )
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

async function login(email: string) {
  await call('POST', '/v1/account/auth/logins', { email })
  process.stdout.write(`Code sent to ${email}. Then: pnpm agent:connect verify ${email} <code>\n`)
}

/** Signs in and saves the session. Keeps a working saved agent; creates one otherwise. */
async function verify(email: string, code: string, agentName: string) {
  const signedIn = await call('POST', '/v1/account/auth/logins/verifications', { email, code })
  const token = signedIn.token as string
  const accountRef = (signedIn.account as { reference: string }).reference
  const expiresAt = new Date(Date.now() + (signedIn.expiresIn as number) * 1000).toISOString()
  await save(files.session, JSON.stringify({ token, expiresAt, accountRef } satisfies Session))

  let agent = await savedAgentOf(token)
  if (agent) {
    process.stdout.write(`Keeping agent ${agent.reference} (data/agent-credential).\n`)
  } else {
    const created = await call(
      'POST',
      '/v1/account/agents',
      { providerRef, name: agentName },
      token,
    )
    await save(files.credential, created.credential as string)
    const view = created.agent as SavedAgent
    agent = { reference: view.reference, principalRef: view.principalRef }
    process.stdout.write(
      `Created agent ${agent.reference}; credential saved to data/agent-credential.\n`,
    )
  }
  await save(files.agent, JSON.stringify(agent))
  process.stdout.write(
    `Account ${accountRef}, principal ${agent.principalRef} at ${providerRef}. ` +
      `Session saved until ${expiresAt}.\n`,
  )
}

/**
 * The agent behind data/agent-credential, if it still mints tokens and belongs
 * to the signed-in account at this merchant. The token's claims say which
 * agent it is.
 */
async function savedAgentOf(token: string): Promise<SavedAgent | null> {
  const credential = await readFile(files.credential, 'utf8').catch(() => null)
  if (!credential) return null
  const minted = await request('POST', '/v1/agent/tokens', undefined, credential.trim())
  if (!minted.ok) return null
  const claims = decodeJwtPayload(minted.body.token as string)
  const agents = (await call('GET', '/v1/account/agents', undefined, token)) as unknown as Array<{
    reference: string
    providerRef: string
    status: string
  }>
  const mine = agents.find(
    a => a.reference === claims.sub && a.providerRef === providerRef && a.status === 'active',
  )
  if (!mine) return null
  return { reference: mine.reference, principalRef: claims.principal as string }
}

/**
 * Saves a card at the merchant through a local Stripe.js page (one 3DS), waits
 * for the webhook to store it, then opens a credit lot of `amountMinor` cents.
 */
async function card(amountMinor: number) {
  if (!Number.isInteger(amountMinor)) fail('The amount is in cents, for example 250')
  const token = await session()
  const agent = await readSavedAgent()

  const setup = await call('POST', `/v1/account/merchants/${providerRef}/card`, {}, token)
  const port = Number(process.env.CARD_PAGE_PORT ?? 3041)
  const page = await startCardPageServer(
    {
      publishableKey: setup.publishableKey as string,
      stripeAccountId: setup.stripeAccountId as string,
      clientSecret: setup.clientSecret as string,
      merchant: providerRef,
    },
    port,
  )
  process.stdout.write(
    `Customer ${setup.customerRef as string}, SetupIntent ${setup.setupIntentId as string}.\n` +
      `Open ${page.url} to save the card (3DS test card: 4000 0025 0000 3155).\n`,
  )
  if (process.platform === 'darwin') spawn('open', [page.url], { stdio: 'ignore' }).unref()

  const result = await page.done
  await page.close()
  if (result.status !== 'succeeded' || !result.paymentMethodId) {
    fail(`SetupIntent ended as ${result.status}`)
  }
  process.stdout.write(
    `Card ${result.paymentMethodId} confirmed. Waiting for Stripe to tell SolvaPay…\n`,
  )

  // Wait for this card, not just any: a card saved earlier is already there, and
  // the newest saved card becomes the default the lot is charged to.
  const deadline = Date.now() + CARD_WAIT_MS
  for (;;) {
    const view = await request('GET', `/v1/account/merchants/${providerRef}`, undefined, token)
    const saved = view.body.card as { paymentMethodId?: string } | null | undefined
    if (view.ok && saved?.paymentMethodId === result.paymentMethodId) break
    if (Date.now() > deadline) {
      fail('No saved card after 90 s. Is the Stripe webhook reaching the local stack?')
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  const lot = await call(
    'POST',
    `/v1/account/merchants/${providerRef}/lots`,
    { amountMinor, ...(agent ? { agentRef: agent.reference } : {}) },
    token,
  )
  print(lot)
}

interface PolicyView {
  reference: string
  agentRef: string
  providerRef: string
  status: string
  version: number
  limits: {
    periodBudgetUsd: string
    hardCeilingUsd: string
    perCallCapUsd: string
    dailyCapUsd: string
    maxTopupAmountUsd: string
    lowWaterUsd: string
    allowedTiers: string[]
    maxCallsPerMinute: number
    timezone: string
  }
  extensionUsd: string
  counters: {
    periodKey: string
    dayKey: string
    spentPeriodUsd: string
    spentDayUsd: string
    reservedUsd: string
    reservations: number
  }
  topup: {
    inFlight: { lotRef: string; decisionRef: string; startedAt: string; failedAt?: string } | null
    lastRefusal: {
      decisionRef: string
      action: 'ask' | 'deny'
      version: number
      periodKey: string
      at: string
    } | null
  }
}

/** Compiles the agent's spend policy from a monthly budget; flags override single limits. */
async function policyCreate(args: string[]) {
  const token = await session()
  const agent = await requireSavedAgent()
  let budget = '5'
  const limits: Record<string, unknown> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) {
      budget = arg
      continue
    }
    const name = arg.slice(2)
    const value = args[++i]
    if (!POLICY_FIELDS[name] || name === 'budget' || value === undefined) {
      fail(
        `Unknown or empty option ${arg}. Options: ${Object.keys(POLICY_FIELDS)
          .filter(field => field !== 'budget')
          .map(field => `--${field}`)
          .join(', ')}`,
      )
    }
    Object.assign(limits, POLICY_FIELDS[name](value))
  }
  const created = await call(
    'POST',
    '/v1/account/spend-policies',
    {
      agentRef: agent.reference,
      monthlyBudgetUsd: budget,
      ...(Object.keys(limits).length > 0 ? { limits } : {}),
    },
    token,
  )
  printPolicy(created as unknown as PolicyView)
}

/** Changes the policy in force: limits make a new version; status pauses, resumes or revokes. */
async function policyUpdate(args: string[]) {
  const token = await session()
  const current = await policyInForce(token)
  const limits: Record<string, unknown> = {}
  let status: string | undefined
  for (const arg of args) {
    const at = arg.indexOf('=')
    const name = at > 0 ? arg.slice(0, at) : ''
    const value = arg.slice(at + 1)
    if (name === 'status') status = value
    else if (POLICY_FIELDS[name] && value) Object.assign(limits, POLICY_FIELDS[name](value))
    else
      fail(
        `Expected field=value, one of ${Object.keys(POLICY_FIELDS).join(', ')}, status; got "${arg}"`,
      )
  }
  const updated = await call(
    'PATCH',
    `/v1/account/spend-policies/${current.reference}`,
    { ...(Object.keys(limits).length > 0 ? { limits } : {}), ...(status ? { status } : {}) },
    token,
  )
  printPolicy(updated as unknown as PolicyView)
}

async function policyShow() {
  printPolicy(await policyInForce(await session()))
}

/** The saved agent's active or paused policy: at most one, by a unique index on the platform. */
async function policyInForce(token: string): Promise<PolicyView> {
  const agent = await requireSavedAgent()
  const policies = (await call(
    'GET',
    `/v1/account/spend-policies?agentRef=${agent.reference}`,
    undefined,
    token,
  )) as unknown as PolicyView[]
  const current = policies.find(p => p.status === 'active' || p.status === 'paused')
  if (!current)
    fail(`Agent ${agent.reference} has no spend policy. Run: pnpm agent:connect policy create`)
  return current
}

function printPolicy(policy: PolicyView) {
  const { limits, counters } = policy
  const lines = [
    `Spend policy ${policy.reference} v${policy.version} (${policy.status}) for ${policy.agentRef} at ${policy.providerRef}`,
    `  budget      ${usd(limits.periodBudgetUsd)} a month` +
      (Number(policy.extensionUsd) > 0 ? ` + ${usd(policy.extensionUsd)} extension` : ''),
    `  ceiling     ${usd(limits.hardCeilingUsd)}`,
    `  per call    ${usd(limits.perCallCapUsd)}`,
    `  daily cap   ${usd(limits.dailyCapUsd)}`,
    `  max top-up  ${usd(limits.maxTopupAmountUsd)}, decided when the balance falls below ${usd(limits.lowWaterUsd)}`,
    `  tiers       ${limits.allowedTiers.join(', ')}`,
    `  rate        ${limits.maxCallsPerMinute} calls a minute (stored, not enforced yet)`,
    `  time zone   ${limits.timezone}`,
    `  spent       ${usd(counters.spentPeriodUsd)} in ${counters.periodKey}, ${usd(counters.spentDayUsd)} on ${counters.dayKey}; ` +
      `${usd(counters.reservedUsd)} reserved by ${counters.reservations} call(s) in flight`,
  ]
  const { inFlight, lastRefusal } = policy.topup
  if (inFlight) {
    lines.push(
      `  top-up      ${inFlight.lotRef} (${inFlight.decisionRef}) ` +
        (inFlight.failedAt
          ? `failed at ${inFlight.failedAt}; no retry until 10 minutes after ${inFlight.startedAt}`
          : `charging since ${inFlight.startedAt}`),
    )
  }
  if (lastRefusal) {
    lines.push(
      `  refused     ${lastRefusal.action} ${lastRefusal.decisionRef} under v${lastRefusal.version} in ${lastRefusal.periodKey}, at ${lastRefusal.at}` +
        (lastRefusal.version === policy.version
          ? ''
          : ' (an older version: the next top-up decides again)'),
    )
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

/** `$5.00`, `$0.25`, `$0.0912`: two places at least, more when the amount has them. */
function usd(amount: string) {
  const [whole, fraction = ''] = amount.split('.')
  return `$${whole}.${fraction.padEnd(2, '0')}`
}

async function requireSavedAgent(): Promise<SavedAgent> {
  const agent = await readSavedAgent()
  if (!agent) fail('No agent saved. Run: pnpm agent:connect verify <email> <code>')
  return agent
}

async function session(): Promise<string> {
  const saved = await readFile(files.session, 'utf8').catch(() => null)
  if (!saved) fail('Not signed in. Run: pnpm agent:connect login <email>')
  const value = JSON.parse(saved) as Session
  if (Date.parse(value.expiresAt) <= Date.now()) {
    fail('The account session has expired. Run: pnpm agent:connect login <email>')
  }
  return value.token
}

async function readSavedAgent(): Promise<SavedAgent | null> {
  const saved = await readFile(files.agent, 'utf8').catch(() => null)
  return saved ? (JSON.parse(saved) as SavedAgent) : null
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

async function save(path: string, content: string) {
  await mkdir(dataDir, { recursive: true })
  await writeFile(path, content, { mode: 0o600 })
}

async function request(
  method: string,
  path: string,
  body: unknown,
  bearer?: string,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown>; text: string }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    // Not JSON; the text is reported on failure.
  }
  return { ok: response.ok, status: response.status, body: parsed, text }
}

async function call(
  method: string,
  path: string,
  body: unknown,
  bearer?: string,
): Promise<Record<string, unknown>> {
  const result = await request(method, path, body, bearer)
  if (!result.ok) fail(`${method} ${path} failed with HTTP ${result.status}: ${result.text}`)
  return result.body
}

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set in .env`)
  return value
}
