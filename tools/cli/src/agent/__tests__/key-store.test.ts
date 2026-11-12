import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keyPath, readKey, saveKey } from '../key-store.mjs'
import { main } from '../connect.mjs'

const PROV = 'prov_E4YWS8H8'
let env: Record<string, string>

beforeEach(async () => {
  env = { SOLVAPAY_HOME: await mkdtemp(join(tmpdir(), 'solvapay-home-')) }
})

afterEach(() => vi.unstubAllGlobals())

const answer = (agentKey: string) => ({
  providerRef: PROV,
  agentKey,
  agentRef: 'agt_A',
  merchantName: 'Opper',
  api: 'https://api.example.test/v1',
})

describe('key store', () => {
  it('saves one key per merchant at ~/.solvapay/agents/<providerRef>.json, mode 600', async () => {
    const path = await saveKey(env, answer('agk_ONE'))
    expect(path).toBe(join(env.SOLVAPAY_HOME, 'agents', `${PROV}.json`))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700)

    await saveKey(env, answer('agk_TWO'))
    expect((await readKey(env, PROV)).agentKey).toBe('agk_TWO')
    expect(await readFile(path, 'utf8')).not.toContain('agk_ONE')
  })

  it('tightens a key file someone loosened', async () => {
    const path = keyPath(env, PROV)
    await saveKey(env, answer('agk_ONE'))
    await writeFile(path, '{}', { mode: 0o644 })
    await chmod(path, 0o644)
    await saveKey(env, answer('agk_TWO'))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('has no key for a merchant never connected, and refuses a path-like reference', async () => {
    expect(await readKey(env, PROV)).toBeNull()
    expect(() => keyPath(env, '../etc')).toThrow('Not a merchant reference')
  })

  it('never prints the key on connect', async () => {
    const printed: string[] = []
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/claims')
        ? Response.json({ status: 'approved', ...answer('agk_SECRET') })
        : url.endsWith('/agent/connect-requests')
          ? Response.json(
              {
                userCode: 'KQ7M-RX4D',
                verificationUrl: 'https://x.test/c/KQ7M-RX4D',
                pollSecret: 'poll-secret-0123456789',
                expiresAt: 'soon',
              },
              { status: 201 },
            )
          : new Response('not found', { status: 404 }),
    )
    const deps = {
      env: { ...env, HERMES_HOME: env.SOLVAPAY_HOME },
      out: (t: string) => printed.push(t),
      sleep: async () => undefined,
    }
    await main(
      [
        'connect',
        PROV,
        '--client',
        'hermes',
        '--api',
        'https://api.example.test/v1',
        '--mcp-url',
        'https://m.test/mcp',
      ],
      deps,
    )
    expect(await main(['connect', PROV], deps)).toBe(0)
    expect(printed.join('\n')).not.toContain('agk_SECRET')
    expect((await readKey(env, PROV)).agentKey).toBe('agk_SECRET')
  })
})
