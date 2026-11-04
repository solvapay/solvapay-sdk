import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createLocalJWKSet, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createAgentCalls, type Logger } from '../calls'
import { createAgentKeyVerifier, createAgentLayer, createAgentTokenVerifier } from '../identity'
import { createAgentMcpRoute, type PaidToolRun } from '../mcp'
import {
  agentKeys,
  FakeAgentApi,
  ISSUER,
  PROVIDER,
  signAgentToken,
  TEST_AGENT_KEY,
} from '../testing'

const MCP_URL = 'http://merchant.test/mcp'
let agentKey: CryptoKey
let agentJwk: JWK

beforeAll(async () => {
  const keys = await agentKeys()
  agentKey = keys.privateKey
  agentJwk = keys.publicJwk
})

function setup(upstream: () => Promise<PaidToolRun>, waitSeconds = 0) {
  const agentApi = new FakeAgentApi()
  const events: { event: string; fields?: Record<string, unknown> }[] = []
  const log: Logger = {
    info: (event, fields) => events.push({ event, fields }),
    error: (event, fields) => events.push({ event, fields }),
  }
  const route = createAgentMcpRoute({
    issuer: ISSUER,
    agentLayer: createAgentLayer({
      verifyAgentToken: createAgentTokenVerifier({
        issuer: ISSUER,
        providerRef: PROVIDER,
        keys: createLocalJWKSet({ keys: [agentJwk] }),
      }),
      verifyAgentKey: createAgentKeyVerifier({ client: agentApi }),
    }),
    calls: createAgentCalls({
      client: agentApi,
      maxWaitSeconds: waitSeconds,
      log,
      sleep: async () => undefined,
    }),
    log,
    mcpPath: '/mcp',
    serverName: 'merchant-test',
    tools: (_server, paid) =>
      paid<{ question: string }>({
        name: 'answer',
        description: 'Answers a question.',
        inputSchema: { question: z.string() },
        item: () => 'answer-v1',
        estimate: () => ({ amount: '0.01', currency: 'USD' }),
        prompt: args => args.question,
        run: upstream,
      }),
  })
  return { agentApi, events, route }
}

async function connect(route: ReturnType<typeof setup>['route'], token: string) {
  const client = new Client({ name: 'agent-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: async (url, init) => {
      const response = await route(new Request(url, init))
      if (!response) throw new Error('The request was not routed to the agent server')
      return response
    },
  })
  await client.connect(transport)
  return client
}

const ok = async (): Promise<PaidToolRun> => ({
  status: 200,
  cost: { amount: 0.004, currency: 'USD' },
  result: { content: [{ type: 'text', text: '42' }] },
})

describe('createAgentMcpRoute', () => {
  it('authorizes a paid tool call, runs it and completes it at the reported cost', async () => {
    const { agentApi, route } = setup(ok)
    const client = await connect(route, await signAgentToken(agentKey))
    const result = (await client.callTool({ name: 'answer', arguments: { question: 'Why?' } })) as {
      content: { text: string }[]
    }

    expect(result.content[0].text).toBe('42')
    expect(agentApi.authorizes[0]).toMatchObject({
      item: 'answer-v1',
      estimate: { amount: '0.01', currency: 'USD' },
      promptHash: expect.stringMatching(/^sha256:/),
    })
    expect(agentApi.completes).toEqual([
      { callRef: 'call_TEST0001', status: 200, cost: { amount: '0.004', currency: 'USD' } },
    ])
  })

  it("returns SolvaPay's refusal as a tool error and never runs the tool", async () => {
    let ran = false
    const { agentApi, route } = setup(async () => {
      ran = true
      return ok()
    })
    agentApi.outcome = 'refused'
    const client = await connect(route, await signAgentToken(agentKey))
    const result = (await client.callTool({ name: 'answer', arguments: { question: 'Why?' } })) as {
      isError?: boolean
      structuredContent?: unknown
    }

    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({
      refusal: { reason: 'deny', message: agentApi.refusal.message },
    })
    expect(ran).toBe(false)
  })

  it('releases the call when the upstream cannot be reached', async () => {
    const { agentApi, route } = setup(async () => {
      throw new Error('ECONNREFUSED')
    })
    const client = await connect(route, await signAgentToken(agentKey))
    const result = (await client.callTool({ name: 'answer', arguments: { question: 'Why?' } })) as {
      isError?: boolean
    }
    expect(result.isError).toBe(true)
    expect(agentApi.completes).toEqual([
      { callRef: 'call_TEST0001', status: 502, cost: null, interrupted: 'upstream_unreachable' },
    ])
  })

  it('answers 401 for an agent token that does not verify, and leaves other requests alone', async () => {
    const { route } = setup(ok)
    const post = (token: string) =>
      new Request(MCP_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
    const expired = await route(post(await signAgentToken(agentKey, { expiresIn: '-5m' })))
    expect(expired?.status).toBe(401)
    expect(await route(post('sk_not_a_jwt'))).toBeNull()
    expect(
      await route(post(await signAgentToken(agentKey, { iss: 'https://auth.example.test' }))),
    ).toBeNull()
    expect(await route(new Request('http://merchant.test/other'))).toBeNull()
  })

  it('serves an agent that sends its agent key, and passes the key to SolvaPay on each call', async () => {
    const { agentApi, route } = setup(ok)
    const client = await connect(route, TEST_AGENT_KEY)
    const result = (await client.callTool({ name: 'answer', arguments: { question: 'Why?' } })) as {
      isError?: boolean
      content: { text: string }[]
    }
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toBe('42')
    expect(agentApi.authorizes[0].agentToken).toBe(TEST_AGENT_KEY)
  })

  it('answers 401 for an agent key SolvaPay does not know', async () => {
    const { route } = setup(ok)
    const response = await route(
      new Request(MCP_URL, {
        method: 'POST',
        headers: {
          authorization: 'Bearer agk_UNKNOWN000000000000000000000000000000000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    )
    expect(response?.status).toBe(401)
  })
})
