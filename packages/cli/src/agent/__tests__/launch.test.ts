import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../connect.mjs'
import { keyPath, readKey, saveKey } from '../key-store.mjs'

const API = 'https://api.example.test/v1'
const MODEL_URL = 'https://models.example.test/v3/compat'
const PROV = 'prov_E4YWS8H8'

interface Started {
  command: string
  args: string[]
  env: Record<string, string>
}

let env: Record<string, string>
let said: string[]
let started: Started[]
let opened: unknown[]
let claims: unknown[]
let revoked: boolean
let spendReads: number
let listing: Record<string, unknown>
let lookups: string[]
let handles: Record<string, string>

const MODEL_FLAGS = ['--model-url', MODEL_URL, '--model', 'aws/claude-sonnet-4-6-eu']

function launch(argv: string[]) {
  return main(['launch', ...argv], {
    env,
    out: () => undefined,
    say: (text: string) => said.push(text),
    sleep: async () => undefined,
    run: async (s: Started) => {
      started.push(s)
      return 0
    },
  }) as Promise<number>
}

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'launch-home-'))
  env = {
    SOLVAPAY_HOME: join(home, '.solvapay'),
    PATH: '/usr/bin',
    ANTHROPIC_API_KEY: 'sk-ant-users-own',
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
  }
  said = []
  started = []
  opened = []
  revoked = false
  spendReads = 0
  lookups = []
  handles = { opper: PROV, 'opper.ai': PROV }
  listing = { providerRef: PROV, anthropicBaseUrl: MODEL_URL, defaultModel: 'claude-haiku-4-5' }
  claims = [
    { status: 'pending', retryAfterSeconds: 3 },
    { status: 'approved', agentKey: 'agk_SECRET', agentRef: 'agt_CLAUDE01', providerRef: PROV, merchantName: 'Opper' },
  ]
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.slice(API.length)
    if (path.startsWith('/agent/spend?since=')) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer agk_SECRET')
      spendReads++
      return revoked
        ? Response.json({ message: 'Unknown or revoked agent key' }, { status: 401 })
        : Response.json({
            agentRef: 'agt_CLAUDE01',
            providerRef: PROV,
            since: 'x',
            // The check before launch, then one read while the last call is still settling.
            calls: spendReads === 2 ? 1 : 2,
            inFlight: spendReads === 2 ? 1 : 0,
            spent: { amount: spendReads === 2 ? '0.0012' : '0.0042', currency: 'USD' },
          })
    }
    if (path.startsWith('/catalog/merchants/')) {
      const handle = decodeURIComponent(path.slice('/catalog/merchants/'.length))
      lookups.push(handle)
      return handles[handle]
        ? Response.json({ ...listing, providerRef: handles[handle], handle })
        : Response.json({ message: `No merchant in the catalog is called ${handle}` }, { status: 404 })
    }
    if (path === `/catalog/listings/${PROV}`) {
      return Response.json(listing)
    }
    if (path === '/agent/connect-requests' && init?.method === 'POST') {
      opened.push(JSON.parse(String(init.body)))
      return Response.json(
        {
          userCode: 'KQ7M-RX4D',
          verificationUrl: 'https://account.example.test/c/KQ7M-RX4D',
          pollSecret: 'poll-secret-0123456789',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
        { status: 201 },
      )
    }
    if (path === '/agent/connect-requests/claims') return Response.json(claims.shift() ?? { status: 'claimed' })
    return new Response('not found', { status: 404 })
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('launch claude', () => {
  it('connects when no key is saved, then starts Claude Code paying with the key', async () => {
    expect(await launch(['claude', PROV, '--api', API, ...MODEL_FLAGS, '--', '-p', 'say hi'])).toBe(0)

    expect(opened).toEqual([{ providerRef: PROV, name: 'Claude Code', client: 'claude-code' }])
    expect(said.join('\n')).toContain('https://account.example.test/c/KQ7M-RX4D')
    expect(said.join('\n')).not.toContain('agk_SECRET')
    expect((await stat(keyPath(env, PROV))).mode & 0o777).toBe(0o600)

    const [claude] = started
    expect(claude.command).toBe('claude')
    expect(claude.args).toEqual([
      '--setting-sources',
      'project,local',
      '--settings',
      '{"env":{"ANTHROPIC_API_KEY":""}}',
      '-p',
      'say hi',
    ])
    expect(claude.env).toMatchObject({
      PATH: '/usr/bin',
      ANTHROPIC_BASE_URL: MODEL_URL,
      ANTHROPIC_AUTH_TOKEN: 'agk_SECRET',
      ANTHROPIC_MODEL: 'aws/claude-sonnet-4-6-eu',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CONFIG_DIR: join(env.SOLVAPAY_HOME, 'agents', 'claude', PROV),
    })
    expect(claude.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(said.join('\n')).toContain('Approve this connection on your phone or in a browser:')
    expect(spendReads).toBe(3)
    expect(said.at(-1)).toBe('This session: 2 paid calls, 0.0042 USD, paid by agent agt_CLAUDE01 through SolvaPay.')
  })

  it("takes the model API and model from the merchant's catalog listing", async () => {
    expect(await launch(['claude', PROV, '--api', API])).toBe(0)
    expect(started[0].env).toMatchObject({ ANTHROPIC_BASE_URL: MODEL_URL, ANTHROPIC_MODEL: 'claude-haiku-4-5' })
    expect(await launch(['claude', PROV, '--api', API, '--model', 'claude-sonnet-4-6'])).toBe(0)
    expect(started[1].env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
  })

  it("marks Claude Code's first-run setup done in its own config, keeping what Claude Code saved", async () => {
    const configDir = join(env.SOLVAPAY_HOME, 'agents', 'claude', PROV)
    await launch(['claude', PROV, '--api', API, ...MODEL_FLAGS])
    const file = join(configDir, '.claude.json')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ hasCompletedOnboarding: true })
    expect((await stat(file)).mode & 0o777).toBe(0o600)

    await writeFile(file, JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', projects: { '/x': {} } }))
    await launch(['claude', PROV, '--api', API, ...MODEL_FLAGS])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ hasCompletedOnboarding: true, theme: 'dark', projects: { '/x': {} } })
  })

  it('launches straight away with a saved key, without connecting again', async () => {
    await saveKey(env, { providerRef: PROV, agentKey: 'agk_SECRET', agentRef: 'agt_A', merchantName: 'Opper', api: API })
    expect(await launch(['claude', PROV, ...MODEL_FLAGS])).toBe(0)
    expect(opened).toEqual([])
    expect(started).toHaveLength(1)
  })

  it('fails before Claude Code starts when the key was revoked', async () => {
    await saveKey(env, { providerRef: PROV, agentKey: 'agk_SECRET', agentRef: 'agt_A', merchantName: 'Opper', api: API })
    revoked = true
    await expect(launch(['claude', PROV, ...MODEL_FLAGS])).rejects.toThrow(/SolvaPay refused this machine's agent key \(401/)
    expect(started).toEqual([])
    expect((await readKey(env, PROV)).agentKey).toBe('agk_SECRET')
  })

  it('says to launch again when the connection expires', async () => {
    claims = [{ status: 'expired' }]
    await expect(launch(['claude', PROV, '--api', API, ...MODEL_FLAGS])).rejects.toThrow(
      'The connection expired before it was approved. Launch again for a new link.',
    )
    expect(started).toEqual([])
  })

  it('stops when the owner turns the connection down', async () => {
    claims = [{ status: 'denied' }]
    await expect(launch(['claude', PROV, '--api', API, ...MODEL_FLAGS])).rejects.toThrow(
      'You turned this connection down, so nothing was started. Launch again to ask once more.',
    )
    expect(started).toEqual([])
    expect(await readKey(env, PROV)).toBeNull()
  })

  it('fails when neither the flags nor the listing name a model API and model, or the agent is unknown', async () => {
    listing = { providerRef: PROV }
    await expect(launch(['claude', PROV, '--api', API])).rejects.toThrow("listing names no model API: pass --model-url")
    await expect(launch(['claude', PROV, '--api', API, '--model-url', MODEL_URL])).rejects.toThrow('listing names no default model')
    await expect(launch(['cursor', PROV, ...MODEL_FLAGS])).rejects.toThrow('launch needs the agent, one of: claude, hermes')
    expect(opened).toEqual([])
  })
})

describe('the merchant by its launch name', () => {
  it('finds the merchant whose launch name it is, exactly', async () => {
    expect(await launch(['claude', 'opper', '--api', API])).toBe(0)
    expect(lookups).toEqual(['opper'])
    expect(opened).toEqual([{ providerRef: PROV, name: 'Claude Code', client: 'claude-code' }])
    expect(await readKey(env, PROV)).not.toBeNull()

    expect(await launch(['claude', 'Opper.AI', '--api', API])).toBe(0)
    expect(lookups).toEqual(['opper', 'opper.ai'])
    expect(opened).toHaveLength(1)
  })

  it('takes a providerRef as it is, without a lookup', async () => {
    expect(await launch(['claude', PROV, '--api', API])).toBe(0)
    expect(lookups).toEqual([])
  })

  it('refuses a name no merchant claimed, even one that starts like it', async () => {
    await expect(launch(['claude', 'opp', '--api', API])).rejects.toThrow(
      'No merchant in the SolvaPay catalog is called "opp". Launch with its launch name or its prov_… reference.',
    )
    expect(opened).toEqual([])
  })
})

describe('the spend on exit', () => {
  it('says how many calls had not settled when it stopped waiting', async () => {
    await saveKey(env, { providerRef: PROV, agentKey: 'agk_SECRET', agentRef: 'agt_A', merchantName: 'Opper', api: API })
    vi.stubGlobal('fetch', async (url: string) =>
      Response.json({ agentRef: 'agt_A', providerRef: PROV, since: url, calls: 1, inFlight: 2, spent: { amount: '0.001', currency: 'USD' } }),
    )
    const now = vi.spyOn(Date, 'now')
    let clock = 0
    now.mockImplementation(() => (clock += 1_000))
    expect(await launch(['claude', PROV, ...MODEL_FLAGS])).toBe(0)
    now.mockRestore()
    expect(said.at(-1)).toBe(
      'This session: 1 paid call, 0.001 USD, paid by agent agt_A through SolvaPay. 2 more not settled yet, so not in this total.',
    )
  })
})

describe('launch hermes', () => {
  it("puts the key and the merchant's model provider in Hermes's home, then starts a chat on it", async () => {
    env.HERMES_HOME = join(env.SOLVAPAY_HOME, '..', '.hermes')
    expect(await launch(['hermes', PROV, '--api', API, '--', '-q', 'say hi'])).toBe(0)

    expect(opened).toEqual([{ providerRef: PROV, name: 'Hermes', client: 'hermes' }])
    const [hermes] = started
    expect(hermes.command).toBe('hermes')
    expect(hermes.args).toEqual(['chat', '--model', 'custom:opper:claude-haiku-4-5', '-q', 'say hi'])
    expect(await readFile(join(env.HERMES_HOME, '.env'), 'utf8')).toBe('SOLVAPAY_KEY_PROV_E4YWS8H8=agk_SECRET\n')
    expect(await readFile(join(env.HERMES_HOME, 'config.yaml'), 'utf8')).toContain(
      `providers:\n  opper:\n    api: ${MODEL_URL}\n    transport: anthropic_messages\n    key_env: SOLVAPAY_KEY_PROV_E4YWS8H8`,
    )
    expect(said.join('\n')).not.toContain('agk_SECRET')
  })

  it('runs another command in place of the agent when SOLVAPAY_AGENT_BIN is set', async () => {
    env.HERMES_HOME = join(env.SOLVAPAY_HOME, '..', '.hermes')
    env.SOLVAPAY_AGENT_BIN = '/lab/hermes-sandbox.sh'
    await launch(['hermes', PROV, '--api', API])
    expect(started[0].command).toBe('/lab/hermes-sandbox.sh')
    expect(started[0].args[0]).toBe('chat')
  })
})

describe('connect --client claude-code', () => {
  it('saves the key and says how to launch', async () => {
    const out: string[] = []
    const deps = { env, out: (t: string) => out.push(t), sleep: async () => undefined }
    await main(['connect', PROV, '--client', 'claude-code', '--api', API, ...MODEL_FLAGS], deps)
    expect(await main(['connect', PROV], deps)).toBe(0)
    expect((await readKey(env, PROV)).agentKey).toBe('agk_SECRET')
    expect(out.at(-1)).toContain(`npx solvapay launch claude ${PROV} --model-url ${MODEL_URL}`)
    expect(out.join('\n')).not.toContain('agk_SECRET')
  })
})
