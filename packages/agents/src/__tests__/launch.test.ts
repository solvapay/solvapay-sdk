import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain ESM without types: the helper runs with no build step
import { main } from '../connect.mjs'
// @ts-expect-error plain ESM without types
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
  claims = [
    { status: 'pending', retryAfterSeconds: 3 },
    { status: 'approved', agentKey: 'agk_SECRET', agentRef: 'agt_CLAUDE01', providerRef: PROV, merchantName: 'Opper' },
  ]
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === `${MODEL_URL}/v1/models`) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer agk_SECRET')
      return revoked
        ? Response.json({ error: 'invalid bearer token' }, { status: 401 })
        : Response.json({ data: [] })
    }
    const path = url.slice(API.length)
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
    expect(claude.args).toEqual(['--setting-sources', 'project,local', '-p', 'say hi'])
    expect(claude.env).toMatchObject({
      PATH: '/usr/bin',
      ANTHROPIC_BASE_URL: MODEL_URL,
      ANTHROPIC_AUTH_TOKEN: 'agk_SECRET',
      ANTHROPIC_MODEL: 'aws/claude-sonnet-4-6-eu',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CONFIG_DIR: join(env.SOLVAPAY_HOME, 'agents', 'claude', PROV),
    })
    expect(claude.env).not.toHaveProperty('ANTHROPIC_API_KEY')
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
    await expect(launch(['claude', PROV, ...MODEL_FLAGS])).rejects.toThrow(/refused this machine's agent key \(401/)
    expect(started).toEqual([])
    expect((await readKey(env, PROV)).agentKey).toBe('agk_SECRET')
  })

  it('stops when the owner turns the connection down', async () => {
    claims = [{ status: 'denied' }]
    await expect(launch(['claude', PROV, '--api', API, ...MODEL_FLAGS])).rejects.toThrow('turned this connection down')
    expect(started).toEqual([])
    expect(await readKey(env, PROV)).toBeNull()
  })

  it('needs a model URL and model, and an agent it can start', async () => {
    await expect(launch(['claude', PROV, '--api', API])).rejects.toThrow('No model URL for prov_E4YWS8H8')
    await expect(launch(['claude', PROV, '--model-url', MODEL_URL])).rejects.toThrow('No model URL')
    await expect(launch(['cursor', PROV, ...MODEL_FLAGS])).rejects.toThrow('launch needs the agent, one of: claude')
    expect(opened).toEqual([])
  })
})

describe('connect --client claude-code', () => {
  it('saves the key and says how to launch', async () => {
    const out: string[] = []
    const deps = { env, out: (t: string) => out.push(t), sleep: async () => undefined }
    await main(['connect', 'start', PROV, '--client', 'claude-code', '--api', API, ...MODEL_FLAGS], deps)
    expect(await main(['connect', 'finish', PROV], deps)).toBe(0)
    expect((await readKey(env, PROV)).agentKey).toBe('agk_SECRET')
    expect(out.at(-1)).toContain(`npx @solvapay/agents launch claude ${PROV} --model-url ${MODEL_URL}`)
    expect(out.join('\n')).not.toContain('agk_SECRET')
  })
})
