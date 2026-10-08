// Plays the SolvaPay console for this clone until the console exists: signs in
// to a SolvaPay account by email code, connects an agent to this merchant,
// saves a card at the merchant and opens the first credit lot.
//
//   pnpm agent:connect login <email>
//   pnpm agent:connect verify <email> <code> [agent name]
//   pnpm agent:connect card [amount in cents, default 250]
//   pnpm agent:connect merchant
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
  } else {
    fail(
      'Usage: pnpm agent:connect login <email>\n' +
        '       pnpm agent:connect verify <email> <code> [agent name]\n' +
        '       pnpm agent:connect card [amount in cents, default 250]\n' +
        '       pnpm agent:connect merchant',
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
  if (result.status !== 'succeeded') fail(`SetupIntent ended as ${result.status}`)
  process.stdout.write('Card confirmed. Waiting for Stripe to tell SolvaPay…\n')

  const deadline = Date.now() + CARD_WAIT_MS
  for (;;) {
    const view = await request('GET', `/v1/account/merchants/${providerRef}`, undefined, token)
    if (view.ok && view.body.card) break
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
