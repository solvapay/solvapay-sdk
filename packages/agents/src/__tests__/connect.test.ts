import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain ESM without types: the helper runs with no build step
import { keyEnvName, main, serverName } from '../connect.mjs'

const API = 'https://api.example.test/v1'
const PROV = 'prov_E4YWS8H8'

let home: string
let lines: string[]
let claims: unknown[]

function run(argv: string[]) {
  return main(argv, {
    env: { HERMES_HOME: home },
    out: (text: string) => lines.push(text),
    sleep: async () => undefined,
  }) as Promise<number>
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hermes-home-'))
  lines = []
  claims = [{ status: 'pending', retryAfterSeconds: 3 }]
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.slice(API.length)
    if (path === `/catalog/listings/${PROV}`) {
      return Response.json({ providerRef: PROV, mcpUrl: 'https://mcp.opper.test/mcp' })
    }
    if (path === '/agent/connect-requests' && init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toEqual({ providerRef: PROV, name: 'Hermes', client: 'hermes' })
      return Response.json(
        {
          requestRef: 'acr_TEST0001',
          userCode: 'KQ7M-RX4D',
          verificationUrl: 'https://account.example.test/c/KQ7M-RX4D',
          pollSecret: 'poll-secret-0123456789',
          interval: 3,
          expiresAt: '2026-10-31T10:00:00.000Z',
        },
        { status: 201 },
      )
    }
    if (path === '/agent/connect-requests/claims') {
      expect(JSON.parse(String(init?.body))).toEqual({ pollSecret: 'poll-secret-0123456789' })
      return Response.json(claims.shift() ?? { status: 'claimed' })
    }
    return new Response('not found', { status: 404 })
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('connect', () => {
  it('starts a request and tells the agent where its owner approves', async () => {
    expect(await run(['connect', 'start', PROV, '--client', 'hermes', '--api', API])).toBe(0)
    expect(lines.join('\n')).toContain('https://account.example.test/c/KQ7M-RX4D')
    expect(lines.join('\n')).toContain(`npx @solvapay/agents connect finish ${PROV}`)
    expect(lines.join('\n')).not.toContain('poll-secret')
  })

  it('waits for the approval, then saves the key for Hermes without printing it', async () => {
    await writeFile(join(home, 'config.yaml'), 'model:\n  default: claude-haiku-4-5\n')
    await writeFile(join(home, '.env'), 'OPPER_KEY=op_1\n')
    claims.push({
      status: 'approved',
      agentKey: 'agk_SECRET',
      agentRef: 'agt_HERMES01',
      providerRef: PROV,
      merchantName: 'Opper',
    })
    await run(['connect', 'start', PROV, '--client', 'hermes', '--api', API])

    expect(await run(['connect', 'finish', PROV])).toBe(0)

    expect(lines.join('\n')).not.toContain('agk_SECRET')
    expect(lines.at(-1)).toContain('Connected to Opper as agent agt_HERMES01')
    expect(await readFile(join(home, '.env'), 'utf8')).toBe(
      `OPPER_KEY=op_1\n${keyEnvName(PROV)}=agk_SECRET\n`,
    )
    const config = await readFile(join(home, 'config.yaml'), 'utf8')
    expect(config).toContain('default: claude-haiku-4-5')
    expect(config).toContain('mcp_servers:\n  opper:\n    url: https://mcp.opper.test/mcp')
    expect(config).toContain(`Authorization: Bearer \${${keyEnvName(PROV)}}`)
  })

  it('uses the MCP URL a site gives instead of the catalog listing', async () => {
    claims.push({ status: 'approved', agentKey: 'agk_X', agentRef: 'agt_A', providerRef: PROV, merchantName: 'Opper' })
    await run(['connect', 'start', PROV, '--client', 'hermes', '--api', API, '--mcp-url', 'https://site.test/mcp'])
    await run(['connect', 'finish', PROV])
    expect(await readFile(join(home, 'config.yaml'), 'utf8')).toContain('url: https://site.test/mcp')
  })

  it('adds the merchant as a model provider paid with the key, without its MCP server', async () => {
    claims.push({ status: 'approved', agentKey: 'agk_X', agentRef: 'agt_A', providerRef: PROV, merchantName: 'Opper' })
    await run([
      'connect', 'start', PROV, '--client', 'hermes', '--api', API,
      '--model-url', 'https://opper.test/v3/compat', '--model', 'aws/claude-sonnet-4-6-eu',
    ])
    expect(await run(['connect', 'finish', PROV])).toBe(0)

    const config = await readFile(join(home, 'config.yaml'), 'utf8')
    expect(config).toContain(
      'providers:\n  opper:\n    api: https://opper.test/v3/compat\n    transport: anthropic_messages\n' +
        `    key_env: ${keyEnvName(PROV)}\n    default_model: aws/claude-sonnet-4-6-eu`,
    )
    expect(config).not.toContain('mcp_servers')
    expect(lines.at(-1)).toContain('hermes chat --model custom:opper:aws/claude-sonnet-4-6-eu')
    expect(lines.at(-1)).not.toContain('/reload-mcp')
  })

  it('needs the model with the model URL', async () => {
    await expect(
      run(['connect', 'start', PROV, '--client', 'hermes', '--api', API, '--model-url', 'https://opper.test/v3/compat']),
    ).rejects.toThrow('--model-url and --model go together')
  })

  it('says so when the owner turned it down, or has not answered in time', async () => {
    await run(['connect', 'start', PROV, '--client', 'hermes', '--api', API])
    claims.splice(0, claims.length, { status: 'denied' })
    expect(await run(['connect', 'finish', PROV])).toBe(1)
    expect(lines.at(-1)).toBe('Your user turned this connection down.')

    claims.splice(0, claims.length, { status: 'pending', retryAfterSeconds: 3 })
    expect(await run(['connect', 'finish', PROV, '--timeout', '0'])).toBe(2)
    expect(lines.at(-1)).toContain('has not approved yet')
  })

  it('refuses a host it cannot set up, and a finish with nothing started', async () => {
    await expect(run(['connect', 'start', PROV, '--client', 'cursor', '--api', API])).rejects.toThrow(
      '--client must be one of: hermes',
    )
    await expect(run(['connect', 'finish', PROV])).rejects.toThrow('run connect start')
  })

  it('names the env var and the server from the merchant', () => {
    expect(keyEnvName('prov_E4YWS8H8')).toBe('SOLVAPAY_KEY_PROV_E4YWS8H8')
    expect(serverName('Opper AI!')).toBe('opper-ai')
  })
})
