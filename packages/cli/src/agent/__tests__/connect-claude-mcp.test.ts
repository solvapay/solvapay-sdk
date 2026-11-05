import { execSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { headersHelper } from '../agents/claude-code.mjs'
import { main } from '../connect.mjs'

const API = 'https://api.example.test/v1'
const PROV = 'prov_E4YWS8H8'
const MCP = 'https://mcp.opper.test/mcp'

let home: string
let env: Record<string, string>
let lines: string[]
let claims: unknown[]
let opens: number
let calls: { command: string; args: string[] }[]
let answers: { code: number; output: string }[]

function run(argv: string[]) {
  return main(argv, {
    env,
    out: (text: string) => lines.push(text),
    sleep: async () => undefined,
    exec: async (command: string, args: string[]) => {
      calls.push({ command, args })
      return answers.shift() ?? { code: 0, output: '' }
    },
  }) as Promise<number>
}

const approved = { status: 'approved', agentKey: 'agk_SECRET', agentRef: 'agt_CLAUDE01', providerRef: PROV, merchantName: 'Opper' }

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'claude-mcp-'))
  env = { SOLVAPAY_HOME: join(home, '.solvapay'), CLAUDE_CONFIG_DIR: join(home, 'claude') }
  lines = []
  claims = [{ status: 'pending', retryAfterSeconds: 3 }]
  opens = 0
  calls = []
  answers = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.slice(API.length)
    if (path === `/catalog/listings/${PROV}`) return Response.json({ providerRef: PROV, mcpUrl: MCP })
    if (path === '/agent/connect-requests' && init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toEqual({ providerRef: PROV, name: 'Claude Code', client: 'claude' })
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
    if (path === '/agent/connect-requests/claims') return Response.json(claims.shift() ?? { status: 'claimed' })
    return new Response('not found', { status: 404 })
  })
})

afterEach(() => vi.unstubAllGlobals())

const connect = ['connect', PROV, '--client', 'claude', '--api', API, '--add-mcp']

describe('connect --add-mcp', () => {
  it("adds the merchant's MCP server to Claude Code at user scope once approved, with the key read by a helper", async () => {
    claims.push(approved)
    expect(await run(connect)).toBe(0)
    expect(lines.join('\n')).toContain(`run the same command again:\n  npx solvapay connect ${PROV} --client claude --api ${API} --add-mcp`)
    expect(calls).toEqual([])

    expect(await run(connect)).toBe(0)
    expect(calls).toHaveLength(1)
    const [name, json, ...scope] = calls[0].args.slice(2)
    expect(calls[0].command).toBe('claude')
    expect(calls[0].args.slice(0, 2)).toEqual(['mcp', 'add-json'])
    expect(name).toBe('opper')
    expect(scope).toEqual(['--scope', 'user'])
    const config = JSON.parse(json)
    expect(config).toEqual({ type: 'http', url: MCP, headersHelper: headersHelper(env, PROV) })
    expect(json).not.toContain('agk_SECRET')
    expect(lines.join('\n')).not.toContain('agk_SECRET')
    expect(lines.at(-1)).toContain(`Claude Code has a new MCP server "opper" at ${MCP} (user scope)`)
    expect(lines.at(-1)).toContain('Start a new Claude Code session to use it; one already open will not see it.')
    expect(lines.at(-1)).not.toContain('Run /mcp')
  })

  it('writes a helper that prints the Authorization header from the saved key, and fails without one', async () => {
    claims.push(approved)
    await run(connect)
    await run(connect)
    const helper = headersHelper(env, PROV)
    expect(JSON.parse(execSync(helper, { encoding: 'utf8' }))).toEqual({ Authorization: 'Bearer agk_SECRET' })

    const other = { ...env, SOLVAPAY_HOME: join(home, 'empty') }
    expect(() => execSync(headersHelper(other, PROV), { stdio: 'pipe' })).toThrow()
  })

  it('keeps a server it added before, updates one whose helper changed, and refuses one it did not add', async () => {
    claims.push(approved)
    await run(connect)
    const exists = { code: 1, output: 'MCP server opper already exists in user config' }
    const claudeJson = (server: object) =>
      writeFile(join(home, 'claude', '.claude.json'), JSON.stringify({ mcpServers: { opper: server } }))
    await mkdir(join(home, 'claude'), { recursive: true })

    await claudeJson({ type: 'http', url: MCP, headersHelper: headersHelper(env, PROV) })
    answers.push(exists)
    expect(await run(connect)).toBe(0)
    expect(lines.at(-1)).toContain('already has the MCP server "opper"')
    expect(calls.map(c => c.args[1])).toEqual(['add-json'])

    calls = []
    await claudeJson({ type: 'http', url: MCP, headersHelper: `'/old/node' -e 'read ${join(env.SOLVAPAY_HOME, 'agents', `${PROV}.json`)}'` })
    answers.push(exists)
    expect(await run(connect)).toBe(0)
    expect(lines.at(-1)).toContain(`"opper" is updated: it is at ${MCP}`)
    expect(calls.map(c => c.args[1])).toEqual(['add-json', 'remove', 'add-json'])

    // Its own server at another URL, e.g. --mcp-url on a merchant connected before: moved, not refused.
    calls = []
    await claudeJson({ type: 'http', url: 'https://old.opper.test/mcp', headersHelper: headersHelper(env, PROV) })
    answers.push(exists)
    expect(await run(connect)).toBe(0)
    expect(calls.map(c => c.args[1])).toEqual(['add-json', 'remove', 'add-json'])

    calls = []
    await claudeJson({ type: 'http', url: 'https://someone-else.test/mcp' })
    answers.push(exists)
    await expect(run(connect)).rejects.toThrow(
      'Claude Code already has an MCP server called "opper" that solvapay connect did not add. Remove it with `claude mcp remove opper -s user`',
    )
    expect(calls.map(c => c.args[1])).toEqual(['add-json'])
  })

  it('says what claude printed when adding fails for another reason', async () => {
    claims.push(approved)
    await run(connect)
    answers.push({ code: 1, output: 'Invalid configuration\n' })
    await expect(run(connect)).rejects.toThrow('claude mcp add-json opper failed (exit 1): Invalid configuration')
  })

  it('adds the server for a merchant connected earlier without --add-mcp, without asking the owner again', async () => {
    claims.push(approved)
    const plain = ['connect', PROV, '--client', 'claude', '--api', API]
    await run(plain)
    expect(await run(plain)).toBe(0)
    expect(lines.at(-1)).toContain('npx solvapay launch claude')
    expect(lines.at(-1)).toContain('run the same command with --add-mcp')
    expect(calls).toEqual([])

    expect(await run(connect)).toBe(0)
    expect(opens).toBe(1)
    expect(calls).toHaveLength(1)
    expect(lines.at(-1)).toContain('Already connected to Opper as agent agt_CLAUDE01')
    expect(lines.at(-1)).toContain(`Claude Code has a new MCP server "opper" at ${MCP}`)
  })

  it('refuses --add-mcp for another host, with a model API, or changed on a waiting request', async () => {
    await expect(run(['connect', PROV, '--client', 'hermes', '--api', API, '--add-mcp'])).rejects.toThrow(
      '--add-mcp adds the merchant\'s MCP server to Claude Code, so it goes with --client claude (got --client hermes)',
    )
    await expect(
      run([...connect, '--model-url', 'https://opper.test/v3/compat', '--model', 'aws/claude-sonnet-4-6-eu']),
    ).rejects.toThrow('--add-mcp adds the merchant\'s MCP server, and --model-url connects its model API')
    expect(opens).toBe(0)

    await run(['connect', PROV, '--client', 'claude', '--api', API])
    await expect(run(connect)).rejects.toThrow('--add-mcp was not given, now true')
  })
})
