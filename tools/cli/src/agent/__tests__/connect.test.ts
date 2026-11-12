import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keyEnvName, main, serverName } from '../connect.mjs'

const API = 'https://api.example.test/v1'
const PROV = 'prov_E4YWS8H8'

let home: string
let lines: string[]
let claims: unknown[]
let opens: number
/** The agent name the connect request should carry. */
let requestedName: string

function run(argv: string[], npx?: string) {
  return main(argv, {
    env: { HERMES_HOME: home, SOLVAPAY_HOME: join(home, '.solvapay') },
    ...(npx ? { npx } : {}),
    out: (text: string) => lines.push(text),
    sleep: async () => undefined,
  }) as Promise<number>
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hermes-home-'))
  lines = []
  claims = [{ status: 'pending', retryAfterSeconds: 3 }]
  opens = 0
  requestedName = 'Hermes'
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.slice(API.length)
    if (path === '/catalog/merchants/opp') {
      return Response.json({ message: 'No merchant in the catalog is called opp' }, { status: 404 })
    }
    if (path === '/catalog/merchants/opper') {
      return Response.json({ providerRef: PROV, mcpUrl: 'https://mcp.opper.test/mcp' })
    }
    if (path === `/catalog/listings/${PROV}`) {
      return Response.json({ providerRef: PROV, mcpUrl: 'https://mcp.opper.test/mcp' })
    }
    if (path === '/agent/connect-requests' && init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toEqual({
        providerRef: PROV,
        name: requestedName,
        client: 'hermes',
      })
      opens++
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
  it('prints the command to run again as one the shell reads back: the preview CLI, a quoted name', async () => {
    requestedName = "Erik's agent"
    await run(
      ['connect', 'opper', '--client', 'hermes', '--name', "Erik's agent", '--api', API],
      'npx solvapay@preview',
    )
    expect(lines.join('\n')).toContain(
      `run the same command again:\n  npx solvapay@preview connect opper --client hermes --name 'Erik'\\''s agent' --api ${API}`,
    )
  })

  it('asks the owner and tells the agent to run the same command again', async () => {
    expect(await run(['connect', PROV, '--client', 'hermes', '--api', API])).toBe(0)
    expect(lines.join('\n')).toContain('https://account.example.test/c/KQ7M-RX4D')
    expect(lines.join('\n')).toContain(
      `run the same command again:\n  npx solvapay connect ${PROV} --client hermes --api ${API}`,
    )
    expect(lines.join('\n')).not.toContain('poll-secret')
  })

  it("takes the merchant's launch name, and keeps it in the command to run again", async () => {
    expect(await run(['connect', 'opper', '--client', 'hermes', '--api', API])).toBe(0)
    expect(lines.join('\n')).toContain(
      `run the same command again:\n  npx solvapay connect opper --client hermes --api ${API}`,
    )
    expect(opens).toBe(1)

    // The re-run finds the waiting request under the merchant the name resolved to.
    claims.splice(0, claims.length, { status: 'pending', retryAfterSeconds: 3 })
    expect(
      await run(['connect', 'opper', '--client', 'hermes', '--api', API, '--timeout', '0']),
    ).toBe(2)
    expect(lines.at(-1)).toContain('has not approved yet')
    expect(opens).toBe(1)
  })

  it('refuses a launch name no merchant in the catalog has', async () => {
    await expect(run(['connect', 'opp', '--client', 'hermes', '--api', API])).rejects.toThrow(
      'No merchant in the SolvaPay catalog is called "opp". Use its launch name or its prov_… reference.',
    )
    expect(opens).toBe(0)
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
    await run(['connect', PROV, '--client', 'hermes', '--api', API])

    expect(await run(['connect', PROV, '--client', 'hermes', '--api', API])).toBe(0)

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
    claims.push({
      status: 'approved',
      agentKey: 'agk_X',
      agentRef: 'agt_A',
      providerRef: PROV,
      merchantName: 'Opper',
    })
    await run([
      'connect',
      PROV,
      '--client',
      'hermes',
      '--api',
      API,
      '--mcp-url',
      'https://site.test/mcp',
    ])
    await run(['connect', PROV])
    expect(await readFile(join(home, 'config.yaml'), 'utf8')).toContain(
      'url: https://site.test/mcp',
    )
  })

  it('adds the merchant as a model provider paid with the key, without its MCP server', async () => {
    claims.push({
      status: 'approved',
      agentKey: 'agk_X',
      agentRef: 'agt_A',
      providerRef: PROV,
      merchantName: 'Opper',
    })
    await run([
      'connect',
      PROV,
      '--client',
      'hermes',
      '--api',
      API,
      '--model-url',
      'https://opper.test/v3/compat',
      '--model',
      'aws/claude-sonnet-4-6-eu',
    ])
    expect(await run(['connect', PROV, '--client', 'hermes', '--api', API])).toBe(0)

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
      run([
        'connect',
        PROV,
        '--client',
        'hermes',
        '--api',
        API,
        '--model-url',
        'https://opper.test/v3/compat',
      ]),
    ).rejects.toThrow('--model-url and --model go together')
  })

  it('says so when the owner turned it down, and asks again on the same command', async () => {
    const connect = ['connect', PROV, '--client', 'hermes', '--api', API]
    await run(connect)
    claims.splice(0, claims.length, { status: 'denied' })
    expect(await run(connect)).toBe(1)
    expect(lines.at(-1)).toContain('Your user turned this connection down.')

    // The declined request is gone, so the same command opens a new one.
    expect(await run(connect)).toBe(0)
    expect(opens).toBe(2)
    expect(lines.at(-1)).toContain('https://account.example.test/c/KQ7M-RX4D')
  })

  it('waits while the owner has not answered, and drops an expired request', async () => {
    const connect = ['connect', PROV, '--client', 'hermes', '--api', API]
    await run(connect)
    claims.splice(0, claims.length, { status: 'pending', retryAfterSeconds: 3 })
    expect(await run([...connect, '--timeout', '0'])).toBe(2)
    expect(lines.at(-1)).toContain('has not approved yet')
    expect(opens).toBe(1)

    claims.splice(0, claims.length, { status: 'expired' })
    expect(await run(connect)).toBe(1)
    expect(lines.at(-1)).toContain('The request expired')
    expect(await run(connect)).toBe(0)
    expect(opens).toBe(2)
  })

  it('says it is already connected instead of asking again, unless --new', async () => {
    claims.push({
      status: 'approved',
      agentKey: 'agk_X',
      agentRef: 'agt_A',
      providerRef: PROV,
      merchantName: 'Opper',
    })
    const connect = ['connect', PROV, '--client', 'hermes', '--api', API]
    await run(connect)
    expect(await run(connect)).toBe(0)

    expect(await run(connect)).toBe(0)
    expect(lines.at(-1)).toContain('Already connected to Opper as agent agt_A')
    expect(opens).toBe(1)

    expect(await run([...connect, '--new'])).toBe(0)
    expect(opens).toBe(2)
  })

  it('refuses a re-run that would set up something else, until --new', async () => {
    await run(['connect', PROV, '--client', 'hermes', '--api', API])
    await expect(run(['connect', PROV, '--client', 'claude'])).rejects.toThrow(
      '--client was hermes, now claude',
    )
    await expect(run(['connect', PROV, '--mcp-url', 'https://elsewhere.test/mcp'])).rejects.toThrow(
      '--mcp-url was https://mcp.opper.test/mcp, now https://elsewhere.test/mcp',
    )
    expect(await run(['connect', PROV, '--client', 'hermes', '--api', API, '--new'])).toBe(0)
    expect(opens).toBe(2)
  })

  it('refuses a host it cannot set up, a missing merchant, and the old sub-commands', async () => {
    await expect(run(['connect', PROV, '--client', 'cursor', '--api', API])).rejects.toThrow(
      '--client must be one of: claude, hermes',
    )
    await expect(run(['connect'])).rejects.toThrow('connect needs the merchant')
    for (const old of ['start', 'complete', 'finish']) {
      await expect(run(['connect', old, PROV, '--client', 'hermes'])).rejects.toThrow(
        `connect takes the merchant now and is run again until it is done`,
      )
    }
  })

  it('names the env var and the server from the merchant', () => {
    expect(keyEnvName('prov_E4YWS8H8')).toBe('SOLVAPAY_KEY_PROV_E4YWS8H8')
    expect(serverName('Opper AI!')).toBe('opper-ai')
  })
})
