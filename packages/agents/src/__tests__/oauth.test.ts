import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createLocalJWKSet, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createAgentCalls, type Logger } from '../calls'
import { createAgentLayer, createAgentTokenVerifier } from '../identity'
import { createAgentHttpGate, refusalResponse } from '../http'
import { createAgentMcpRoute, type PaidToolRun } from '../mcp'
import {
  authChallenge,
  canonicalResource,
  protectedResourceHandler,
  protectedResourceMetadata,
} from '../oauth'
import { agentKeys, FakeAgentApi, ISSUER, PROVIDER, signAgentToken } from '../testing'

const MCP_URL = 'https://merchant.test/mcp'
const RESOURCE = { resource: MCP_URL, authorizationServer: ISSUER }
const CHALLENGE =
  `Bearer error="invalid_token", error_description="Sign in to pay for this tool", ` +
  `resource_metadata="https://merchant.test/.well-known/oauth-protected-resource/mcp", scope="usage"`

let agentKey: CryptoKey
let agentJwk: JWK

beforeAll(async () => {
  const keys = await agentKeys()
  agentKey = keys.privateKey
  agentJwk = keys.publicJwk
})

const verifier = (resource?: string) =>
  createAgentTokenVerifier({
    issuer: ISSUER,
    providerRef: PROVIDER,
    keys: createLocalJWKSet({ keys: [agentJwk] }),
    ...(resource ? { resource } : {}),
  })

describe('protected resource metadata and the challenge', () => {
  it('names the resource with its path and SolvaPay as the authorization server', () => {
    expect(
      protectedResourceMetadata({
        ...RESOURCE,
        serverName: 'Opper',
        documentation: 'https://docs.test',
      }),
    ).toEqual({
      resource: MCP_URL,
      authorization_servers: [ISSUER],
      scopes_supported: ['usage'],
      bearer_methods_supported: ['header'],
      resource_name: 'Opper',
      resource_documentation: 'https://docs.test',
    })
  })

  it('canonicalises as SolvaPay compares resources, and refuses a fragment', () => {
    expect(canonicalResource('HTTPS://Merchant.Test:443/mcp/')).toBe(MCP_URL)
    expect(() => canonicalResource(`${MCP_URL}#x`)).toThrow('no fragment')
  })

  it('challenges with error, description, resource_metadata and the one scope', async () => {
    const response = authChallenge({
      protectedResource: RESOURCE,
      description: 'Sign in to pay for this tool',
      jsonRpcId: 7,
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe(CHALLENGE)
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('WWW-Authenticate')
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32001, message: 'Sign in to pay for this tool' },
    })
  })

  it('serves the document at the path-suffixed form for an API, and nothing else', async () => {
    const handler = protectedResourceHandler({
      resource: 'https://api.merchant.test/v3',
      authorizationServer: ISSUER,
    })
    const served = handler(
      new Request('https://api.merchant.test/.well-known/oauth-protected-resource/v3'),
    )
    expect(served?.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await served?.json()).toMatchObject({ resource: 'https://api.merchant.test/v3' })
    expect(handler(new Request('https://api.merchant.test/v3'))).toBeNull()
  })
})

describe('tokens a host got by OAuth', () => {
  it('accepts the resource as aud beside the provider reference, and surfaces cid', async () => {
    const oauth = await signAgentToken(agentKey, {
      aud: MCP_URL,
      cid: 'https://claude.ai/oauth/claude-code-client-metadata',
      expiresIn: '60m',
    })
    expect(await verifier(`${MCP_URL}/`)(oauth)).toMatchObject({
      ok: true,
      agent: {
        agentRef: 'agt_TESTAGNT',
        clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
      },
    })
    expect(await verifier(MCP_URL)(await signAgentToken(agentKey))).toMatchObject({ ok: true })
  })

  it("refuses another server's resource, and a resource token where no resource is set", async () => {
    const other = await signAgentToken(agentKey, { aud: 'https://other.test/mcp' })
    expect(await verifier(MCP_URL)(other)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await verifier()(await signAgentToken(agentKey, { aud: MCP_URL }))).toMatchObject({
      ok: false,
      reason: 'invalid',
    })
  })
})

describe('the HTTP gate with OAuth on', () => {
  it('puts the challenge on a rejected token and on an agent_not_accepted refusal', async () => {
    const log = { info: () => undefined, error: () => undefined }
    const agentApi = new FakeAgentApi()
    const gate = createAgentHttpGate({
      agentLayer: createAgentLayer({ verifyAgentToken: verifier(MCP_URL) }),
      calls: createAgentCalls({ client: agentApi, maxWaitSeconds: 0, log }),
      log,
      protectedResource: RESOURCE,
    })
    const result = await gate({
      presentedKey: await signAgentToken(agentKey, { expiresIn: '-5m' }),
      requestId: 'r',
      item: 'x',
      estimate: { amount: '0.01', currency: 'USD' },
      prompt: null,
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ kind: 'rejected', status: 401 })
    expect((result as { challenge?: Headers }).challenge?.get('WWW-Authenticate')).toContain(
      'resource_metadata=',
    )

    const refused = refusalResponse(
      { kind: 'refused', reason: 'agent_not_accepted', message: 'Sign in again' } as never,
      (result as { challenge: Headers }).challenge,
    )
    expect(refused.status).toBe(401)
    expect(refused.headers.get('WWW-Authenticate')).toContain('error="invalid_token"')
  })
})

function oauthRoute(options: { lazyAuth?: boolean } = {}) {
  const agentApi = new FakeAgentApi()
  const log: Logger = { info: () => undefined, error: () => undefined }
  const listedFor: (string | undefined)[] = []
  const route = createAgentMcpRoute({
    issuer: ISSUER,
    agentLayer: createAgentLayer({ verifyAgentToken: verifier(MCP_URL) }),
    calls: createAgentCalls({
      client: agentApi,
      maxWaitSeconds: 0,
      log,
      sleep: async () => undefined,
    }),
    log,
    mcpPath: '/mcp',
    serverName: 'merchant-test',
    protectedResource: { resource: MCP_URL },
    ...(options.lazyAuth !== undefined ? { lazyAuth: options.lazyAuth } : {}),
    freeTools: server =>
      server.registerTool('ping_merchant', { description: 'Free.' }, async () => ({
        content: [{ type: 'text', text: 'pong' }],
      })),
    tools: (_server, paid, call) => {
      listedFor.push(call?.agent.agentRef)
      paid<{ question: string }>({
        name: 'answer',
        description: 'Answers a question.',
        inputSchema: { question: z.string() },
        item: () => 'answer-v1',
        estimate: () => ({ amount: '0.01', currency: 'USD' }),
        run: async (): Promise<PaidToolRun> => ({
          status: 200,
          cost: { amount: 0.004, currency: 'USD' },
          result: { content: [{ type: 'text', text: '42' }] },
        }),
      })
    },
  })
  return { agentApi, route, listedFor }
}

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  })

async function client(route: ReturnType<typeof oauthRoute>['route'], token?: string) {
  const mcp = new Client({ name: 'host', version: '1.0.0' })
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : {},
      fetch: async (url, init) => {
        const response = await route(new Request(url, init))
        if (!response) throw new Error('not routed')
        return response
      },
    }),
  )
  return mcp
}

describe('createAgentMcpRoute with OAuth on', () => {
  it('serves the metadata at the path-suffixed form and under the MCP path', async () => {
    const { route } = oauthRoute()
    for (const path of [
      '/.well-known/oauth-protected-resource/mcp',
      '/mcp/.well-known/oauth-protected-resource',
    ]) {
      const response = await route(new Request(`https://merchant.test${path}`))
      expect(response?.status).toBe(200)
      expect(response?.headers.get('Cache-Control')).toBe('public, max-age=300')
      expect(await response?.json()).toMatchObject({
        resource: MCP_URL,
        authorization_servers: [ISSUER],
        resource_name: 'merchant-test',
      })
    }
  })

  it('lists every tool and runs a free one before sign-in, with default annotations on the paid one', async () => {
    const { route, listedFor } = oauthRoute()
    const mcp = await client(route)
    const { tools } = await mcp.listTools()
    expect(tools.map(tool => tool.name).sort()).toEqual(['answer', 'ping_merchant'])
    expect(tools.find(tool => tool.name === 'answer')).toMatchObject({
      title: 'answer',
      annotations: { readOnlyHint: false, destructiveHint: false },
    })
    expect(listedFor).toContain(undefined)
    expect(await mcp.callTool({ name: 'ping_merchant', arguments: {} })).toMatchObject({
      content: [{ type: 'text', text: 'pong' }],
    })
  })

  it('answers a paid call without a token with the challenge, decided before the handler runs', async () => {
    const { route, agentApi } = oauthRoute()
    const response = await route(
      rpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'answer', arguments: { question: 'Why?' } },
      }),
    )
    expect(response?.status).toBe(401)
    expect(response?.headers.get('WWW-Authenticate')).toBe(CHALLENGE)
    expect(await response?.json()).toMatchObject({ id: 3, error: { code: -32001 } })
    expect(agentApi.authorizes).toHaveLength(0)
  })

  it('challenges a free call too with lazyAuth off, while tools/list still answers', async () => {
    const { route } = oauthRoute({ lazyAuth: false })
    const free = await route(
      rpc({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'ping_merchant', arguments: {} },
      }),
    )
    expect(free?.status).toBe(401)
    const mcp = await client(route)
    expect((await mcp.listTools()).tools).toHaveLength(2)
  })

  it("leaves the merchant's own bearer to its handler unless it calls a paid tool", async () => {
    const { route } = oauthRoute()
    const own = { authorization: 'Bearer sk_merchant_own' }
    expect(await route(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, own))).toBeNull()
    expect(
      (
        await route(
          rpc(
            {
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: { name: 'answer', arguments: { question: 'x' } },
            },
            own,
          ),
        )
      )?.status,
    ).toBe(401)
  })

  it('challenges an expired token so the host refreshes', async () => {
    const { route } = oauthRoute()
    const response = await route(
      rpc(
        { jsonrpc: '2.0', id: 5, method: 'tools/list' },
        {
          authorization: `Bearer ${await signAgentToken(agentKey, { aud: MCP_URL, expiresIn: '-5m' })}`,
        },
      ),
    )
    expect(response?.status).toBe(401)
    expect(response?.headers.get('WWW-Authenticate')).toContain(
      'error_description="The sign-in has expired: sign in again"',
    )
  })

  it('serves a signed-in host with its OAuth token and pays the call', async () => {
    const { route, agentApi, listedFor } = oauthRoute()
    const mcp = await client(
      route,
      await signAgentToken(agentKey, { aud: MCP_URL, cid: 'oac_HOST', expiresIn: '60m' }),
    )
    const result = (await mcp.callTool({ name: 'answer', arguments: { question: 'Why?' } })) as {
      content: unknown[]
    }
    expect(result.content).toEqual([{ type: 'text', text: '42' }])
    expect(agentApi.authorizes).toHaveLength(1)
    expect(listedFor).toContain('agt_TESTAGNT')
  })

  it('keeps the free tools for a signed-in agent, and charges nothing for them', async () => {
    const { route, agentApi } = oauthRoute()
    const mcp = await client(route, await signAgentToken(agentKey, { aud: MCP_URL }))
    const { tools } = await mcp.listTools()
    expect(tools.map(tool => tool.name).sort()).toEqual(['answer', 'ping_merchant'])
    expect(await mcp.callTool({ name: 'ping_merchant', arguments: {} })).toMatchObject({
      content: [{ type: 'text', text: 'pong' }],
    })
    expect(agentApi.authorizes).toEqual([])
  })
})
