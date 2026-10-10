// Plays the SolvaPay console for this clone until the console exists: signs in
// to a SolvaPay account by email code, connects an agent to this merchant,
// saves a card at the merchant, opens the first credit lot and sets the
// agent's spend policy. Signing in opens the personal account; a business
// account is created and switched to here too, and every other command acts
// in the active account.
//
//   pnpm agent:connect login <email>
//   pnpm agent:connect verify <email> <code> [agent name]
//   pnpm agent:connect accounts
//   pnpm agent:connect business <legal name> <country>
//   pnpm agent:connect switch <acc_…>
//   pnpm agent:connect agent new <name>
//   pnpm agent:connect card [amount in cents, default 250] [--agent agt_…]
//   pnpm agent:connect merchant
//   pnpm agent:connect policy create [monthly budget USD, default 5] [--tiers S,M,L]
//                                    [--per-call x] [--ceiling x] [--daily x] [--timezone tz]
//                                    [--max-topup x] [--low-water x] [--purpose "…"]
//                                    [--excerpt] [--agent agt_…]
//   pnpm agent:connect policy update <field=value…> [--agent agt_…]   budget, ceiling,
//                                    per-call, daily, max-topup, low-water, tiers, rate,
//                                    timezone, status, purpose (empty clears it),
//                                    excerpt=on|off
//   pnpm agent:connect policy show [--agent agt_…]
//   pnpm agent:connect approvals                    the active account's, newest first
//   pnpm agent:connect approve <apr_…>             one lot more this month, and a top-up at once
//   pnpm agent:connect decline <apr_…>
//
// card and policy act on --agent, else the saved agent if it belongs to the
// active account, else the active account's only agent at this merchant.
//
// Local state in data/ (git-ignored, mode 600): agent-credential (never
// printed; the agent apiKeyHelper uses), agent.json (its agent and principal
// references), agents/<agt_…> (credentials of agents made with `agent new`),
// account-session (the one-hour account session, renewed while in use until
// 12 hours after sign-in).
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
  agents: join(dataDir, 'agents'),
}
/** How long `card` waits for the SetupIntent webhook to save the card. */
const CARD_WAIT_MS = 90_000
/**
 * A session is renewed once it is this old, so a script in use keeps one for
 * the 12 hours a sign-in allows. Renewing needs a session that has not
 * expired: after an hour without a command, sign in again.
 */
const RENEW_AFTER_MS = 15 * 60_000
const SIGN_IN_MAX_AGE_MS = 12 * 60 * 60_000

interface Session {
  token: string
  issuedAt: string
  expiresAt: string
  /** The active account. */
  accountRef: string
  accountUserRef: string
  /** When the code was verified; renewals keep it. */
  authTime: string
}

interface SavedAgent {
  reference: string
  principalRef: string
}

interface AccountView {
  reference: string
  type: 'personal' | 'business'
  displayName: string
  status: string
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

const [command, ...rawArgs] = process.argv.slice(2)
const agentFlag = rawArgs.indexOf('--agent')
const explicitAgent = agentFlag >= 0 ? rawArgs[agentFlag + 1] : undefined
if (agentFlag >= 0 && !explicitAgent?.startsWith('agt_')) fail('--agent takes an agt_ reference')
const args =
  agentFlag >= 0 ? rawArgs.filter((_, i) => i !== agentFlag && i !== agentFlag + 1) : rawArgs

try {
  if (command === 'login' && args[0]) {
    await login(args[0])
  } else if (command === 'verify' && args[0] && args[1]) {
    await verify(args[0], args[1], args.slice(2).join(' ') || 'Claude Code')
  } else if (command === 'accounts') {
    await accounts()
  } else if (command === 'business' && args.length >= 2) {
    await business(args.slice(0, -1).join(' '), args[args.length - 1])
  } else if (command === 'switch' && args[0]) {
    await switchTo(args[0])
  } else if (command === 'agent' && args[0] === 'new' && args.length > 1) {
    await agentNew(args.slice(1).join(' '))
  } else if (command === 'approvals') {
    await approvals()
  } else if ((command === 'approve' || command === 'decline') && args[0]?.startsWith('apr_')) {
    await decideApproval(command, args[0])
  } else if (command === 'card') {
    await card(args[0] ? Number(args[0]) : 250)
  } else if (command === 'merchant') {
    print(await call('GET', `/v1/account/merchants/${providerRef}`, undefined, await session()))
  } else if (command === 'statement') {
    const period = args[0] ?? new Date().toISOString().slice(0, 7)
    print(
      await call(
        'GET',
        `/v1/account/statement?period=${period}&limit=200`,
        undefined,
        await session(),
      ),
    )
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
        '       pnpm agent:connect accounts\n' +
        '       pnpm agent:connect business <legal name> <country>\n' +
        '       pnpm agent:connect switch <acc_…>\n' +
        '       pnpm agent:connect agent new <name>\n' +
        '       pnpm agent:connect card [amount in cents, default 250]\n' +
        '       pnpm agent:connect merchant\n' +
        '       pnpm agent:connect statement [YYYY-MM, default this month]\n' +
        '       pnpm agent:connect policy create [budget, default 5] [--tiers S,M,L] [--per-call x]\n' +
        '                                        [--ceiling x] [--daily x] [--timezone tz]\n' +
        '                                        [--max-topup x] [--low-water x]\n' +
        '                                        [--purpose "…"] [--excerpt]\n' +
        '       pnpm agent:connect policy update <field=value…>  (' +
        Object.keys(POLICY_FIELDS).join(', ') +
        ', status, purpose, excerpt=on|off)\n' +
        '       pnpm agent:connect policy show\n' +
        '       pnpm agent:connect approvals\n' +
        '       pnpm agent:connect approve <apr_…>\n' +
        '       pnpm agent:connect decline <apr_…>\n' +
        'card and policy take --agent agt_… when the active account has several agents here.',
    )
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

async function login(email: string) {
  await call('POST', '/v1/account/auth/logins', { email })
  process.stdout.write(`Code sent to ${email}. Then: pnpm agent:connect verify ${email} <code>\n`)
}

/**
 * Signs in, which opens the personal account, and saves the session. Keeps a
 * working saved agent of that account; creates one otherwise.
 */
async function verify(email: string, code: string, agentName: string) {
  const signedIn = await call('POST', '/v1/account/auth/logins/verifications', { email, code })
  const { token, accountRef, expiresAt } = await saveSession(signedIn, new Date())

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

/** The signed-in account user's accounts, the active one marked. */
async function accounts() {
  const me = (await call('GET', '/v1/account/auth/me', undefined, await session())) as unknown as {
    accountUser: { reference: string; email: string }
    active: { accountRef: string; role: string }
    memberships: Array<{ account: AccountView; role: string }>
  }
  const lines = [`${me.accountUser.email} (${me.accountUser.reference})`]
  for (const { account, role } of me.memberships) {
    const active = account.reference === me.active.accountRef ? '*' : ' '
    lines.push(
      `${active} ${account.reference}  ${account.type.padEnd(8)}  ${role.padEnd(6)}  ${account.displayName}`,
    )
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

/** Creates a business account owned by the signed-in account user; does not switch to it. */
async function business(legalName: string, country: string) {
  const created = (await call(
    'POST',
    '/v1/account/accounts',
    { legalName, country },
    await session(),
  )) as unknown as AccountView
  process.stdout.write(
    `Created business account ${created.reference} (${created.displayName}). ` +
      `Act in it: pnpm agent:connect switch ${created.reference}\n`,
  )
}

/** A new session in another account, after a live membership check. */
async function switchTo(accountRef: string) {
  const switched = await call('POST', '/v1/account/auth/sessions', { accountRef }, await session())
  const saved = await readSession()
  const next = await saveSession(switched, new Date(saved.authTime))
  const account = switched.account as AccountView
  process.stdout.write(
    `Acting in ${account.reference} (${account.type}, ${account.displayName}) until ${next.expiresAt}.\n`,
  )
}

/**
 * Creates an agent in the active account. Its credential goes to
 * data/agents/<agt_…>, never over data/agent-credential, which is the one
 * apiKeyHelper uses.
 */
async function agentNew(name: string) {
  const created = await call('POST', '/v1/account/agents', { providerRef, name }, await session())
  const agent = created.agent as SavedAgent
  await mkdir(files.agents, { recursive: true })
  await writeFile(join(files.agents, agent.reference), created.credential as string, {
    mode: 0o600,
  })
  process.stdout.write(
    `Created agent ${agent.reference}, principal ${agent.principalRef} at ${providerRef}; ` +
      `credential saved to data/agents/${agent.reference}.\n`,
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
  const agent = await activeAgent(token, { required: false })

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

interface ApprovalView {
  reference: string
  status: 'pending' | 'approved' | 'declined' | 'expired'
  amountUsd: string
  expiresAt: string
  agentRef: string
  policyRef: string
  reasonCode: string
  decidedAt?: string
  grant?: { amountUsd: string; capped: boolean }
  topup?: { decisionRef: string; lotRef?: string }
  notification?: { recipients: number; sentAt?: string; failedAt?: string; error?: string }
}

/** The active account's approvals, newest first, with how the email went. */
async function approvals() {
  const list = (await call(
    'GET',
    '/v1/account/approvals',
    undefined,
    await session(),
  )) as unknown as ApprovalView[]
  if (list.length === 0) {
    process.stdout.write('No approvals in the active account.\n')
    return
  }
  for (const approval of list) process.stdout.write(`${approvalLine(approval)}\n`)
}

/**
 * Approves or declines as the signed-in owner, as the console's approve page
 * does: a POST with the session, checked live. Approving grants one lot more
 * this month and decides a top-up at once.
 */
async function decideApproval(action: 'approve' | 'decline', reference: string) {
  const result = await call(
    'POST',
    `/v1/account/approvals/${reference}/${action}`,
    {},
    await session(),
  )
  process.stdout.write(`${approvalLine(result.approval as ApprovalView)}\n`)
  const topup = result.topup as
    | { action: string; reason?: string; decisionRef?: string; lotRef?: string }
    | undefined
  if (topup) {
    process.stdout.write(
      topup.action === 'allow'
        ? `  top-up    ${topup.lotRef} opened (${topup.decisionRef})\n`
        : `  top-up    ${topup.action}${topup.reason ? ` (${topup.reason})` : ''}\n`,
    )
  }
}

function approvalLine(approval: ApprovalView): string {
  const parts = [
    `${approval.reference} ${approval.status.padEnd(8)} ${usd(approval.amountUsd)} for ${approval.agentRef}`,
    `(${approval.reasonCode}, ${approval.policyRef})`,
    approval.status === 'pending' ? `expires ${approval.expiresAt}` : '',
    approval.grant
      ? `granted ${usd(approval.grant.amountUsd)}${approval.grant.capped ? ' (cut at the ceiling)' : ''}`
      : '',
    approval.topup?.lotRef ? `lot ${approval.topup.lotRef}` : '',
    approval.notification?.sentAt
      ? `emailed ${approval.notification.recipients}`
      : approval.notification?.failedAt
        ? `email failed: ${approval.notification.error}`
        : '',
  ]
  return parts.filter(Boolean).join('  ')
}

interface PolicyView {
  reference: string
  agentRef: string
  providerRef: string
  status: string
  version: number
  purpose: string | null
  promptExcerpt: boolean
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
  const agent = await activeAgent(token)
  let budget = '5'
  let purpose: string | undefined
  let promptExcerpt = false
  const limits: Record<string, unknown> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) {
      budget = arg
      continue
    }
    if (arg === '--excerpt') {
      promptExcerpt = true
      continue
    }
    if (arg === '--purpose') {
      purpose = args[++i]
      if (!purpose) fail('--purpose takes the text, in quotes')
      continue
    }
    const name = arg.slice(2)
    const value = args[++i]
    if (!POLICY_FIELDS[name] || name === 'budget' || value === undefined) {
      fail(
        `Unknown or empty option ${arg}. Options: ${Object.keys(POLICY_FIELDS)
          .filter(field => field !== 'budget')
          .map(field => `--${field}`)
          .join(', ')}, --purpose, --excerpt`,
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
      ...(purpose !== undefined ? { purpose } : {}),
      ...(promptExcerpt ? { promptExcerpt } : {}),
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
  const terms: { status?: string; purpose?: string | null; promptExcerpt?: boolean } = {}
  for (const arg of args) {
    const at = arg.indexOf('=')
    const name = at > 0 ? arg.slice(0, at) : ''
    const value = arg.slice(at + 1)
    if (name === 'status') terms.status = value
    else if (name === 'purpose') terms.purpose = value.trim() === '' ? null : value
    else if (name === 'excerpt' && (value === 'on' || value === 'off'))
      terms.promptExcerpt = value === 'on'
    else if (POLICY_FIELDS[name] && value) Object.assign(limits, POLICY_FIELDS[name](value))
    else
      fail(
        `Expected field=value, one of ${Object.keys(POLICY_FIELDS).join(', ')}, status, purpose, excerpt=on|off; got "${arg}"`,
      )
  }
  const updated = await call(
    'PATCH',
    `/v1/account/spend-policies/${current.reference}`,
    { ...(Object.keys(limits).length > 0 ? { limits } : {}), ...terms },
    token,
  )
  printPolicy(updated as unknown as PolicyView)
}

async function policyShow() {
  printPolicy(await policyInForce(await session()))
}

/** The agent's active or paused policy: at most one, by a unique index on the platform. */
async function policyInForce(token: string): Promise<PolicyView> {
  const agent = await activeAgent(token)
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
    `  purpose     ${policy.purpose ?? '(none: the classifier asks no purpose question)'}`,
    policy.promptExcerpt
      ? "  excerpt     on: checked calls send the end of the prompt to SolvaPay's classifier, which runs outside the EU"
      : '  excerpt     off: the classifier sees the prompt hash and the numbers only',
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

/**
 * The agent a command acts on, in the active account at this merchant:
 * --agent, else the saved agent if it belongs here, else the only one.
 */
async function activeAgent(token: string): Promise<SavedAgent>
async function activeAgent(token: string, options: { required: false }): Promise<SavedAgent | null>
async function activeAgent(
  token: string,
  { required = true }: { required?: boolean } = {},
): Promise<SavedAgent | null> {
  const agents = (
    (await call('GET', '/v1/account/agents', undefined, token)) as unknown as Array<
      SavedAgent & { providerRef: string; status: string; name: string }
    >
  ).filter(agent => agent.providerRef === providerRef && agent.status === 'active')
  const pick = (agent: SavedAgent) => ({
    reference: agent.reference,
    principalRef: agent.principalRef,
  })
  if (explicitAgent) {
    const chosen = agents.find(agent => agent.reference === explicitAgent)
    if (!chosen) fail(`${explicitAgent} is not an active agent of the active account here`)
    return pick(chosen)
  }
  const saved = await readSavedAgent()
  const savedHere = saved && agents.find(agent => agent.reference === saved.reference)
  if (savedHere) return pick(savedHere)
  if (agents.length === 1) return pick(agents[0])
  if (!required) return null
  if (agents.length === 0) {
    fail(
      'The active account has no agent at this merchant. Run: pnpm agent:connect agent new <name>',
    )
  }
  fail(
    `The active account has ${agents.length} agents here; pass --agent with one of: ` +
      agents.map(agent => `${agent.reference} (${agent.name})`).join(', '),
  )
}

/**
 * The saved session's token, renewed first once it is 15 minutes old while
 * the sign-in is under 12 hours old.
 */
async function session(): Promise<string> {
  const saved = await readSession()
  const now = Date.now()
  if (Date.parse(saved.expiresAt) <= now) {
    fail('The account session has expired. Run: pnpm agent:connect login <email>')
  }
  const signInAge = now - Date.parse(saved.authTime)
  if (now - Date.parse(saved.issuedAt) < RENEW_AFTER_MS || signInAge >= SIGN_IN_MAX_AGE_MS)
    return saved.token
  const renewed = await request(
    'POST',
    '/v1/account/auth/sessions',
    { accountRef: saved.accountRef },
    saved.token,
  )
  if (!renewed.ok) return saved.token // still valid; the call itself reports a real problem
  return (await saveSession(renewed.body, new Date(saved.authTime))).token
}

async function readSession(): Promise<Session> {
  const saved = await readFile(files.session, 'utf8').catch(() => null)
  if (!saved) fail('Not signed in. Run: pnpm agent:connect login <email>')
  const value = JSON.parse(saved) as Partial<Session>
  if (!value.accountUserRef || !value.authTime || !value.issuedAt) {
    fail('The saved session is from before account users. Run: pnpm agent:connect login <email>')
  }
  return value as Session
}

/** Saves a session response (sign-in, switch or renewal) with the sign-in time. */
async function saveSession(response: Record<string, unknown>, authTime: Date): Promise<Session> {
  const now = Date.now()
  const value: Session = {
    token: response.token as string,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (response.expiresIn as number) * 1000).toISOString(),
    accountRef: (response.account as AccountView).reference,
    accountUserRef: (response.accountUser as { reference: string }).reference,
    authTime: authTime.toISOString(),
  }
  await save(files.session, JSON.stringify(value))
  return value
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
