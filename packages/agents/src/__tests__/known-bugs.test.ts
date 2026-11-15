import { createLocalJWKSet, SignJWT, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { amountString, createAgentCalls } from '../calls'
import { refusalStatus } from '../http'
import { createAgentLayer, createAgentTokenVerifier } from '../identity'
import { createAgentMcpRoute } from '../mcp'
import { protectedResourceMetadataPath } from '../oauth'
import { promptFacts } from '../prompt'
import { agentKeys, FakeAgentApi, ISSUER, PROVIDER } from '../testing'

let privateKey: CryptoKey
let publicJwk: JWK

beforeAll(async () => {
  ;({ privateKey, publicJwk } = await agentKeys())
})

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

describe('prompt excerpt', () => {
  it('never starts with half of a character cut at the limit', () => {
    const text = `😀${'a'.repeat(1499)}`
    const { excerpt } = promptFacts(text)
    expect(loneSurrogate.test(excerpt)).toBe(false)
    expect(excerpt).toBe('a'.repeat(1499))
  })
})

describe('amounts', () => {
  it('writes amounts of 1e21 and above as plain digits', () => {
    expect(amountString(1e21)).toBe('1000000000000000000000')
    expect(amountString(1.5e21)).toBe('1500000000000000000000')
  })
})

describe('protected resource metadata', () => {
  it('has no trailing slash for a resource at the origin', () => {
    expect(
      protectedResourceMetadataPath({ resource: 'https://x.example', authorizationServer: ISSUER }),
    ).toBe('/.well-known/oauth-protected-resource')
    expect(
      protectedResourceMetadataPath({
        resource: 'https://x.example/mcp',
        authorizationServer: ISSUER,
      }),
    ).toBe('/.well-known/oauth-protected-resource/mcp')
  })
})

describe('token id', () => {
  it('returns a numeric jti as a string', async () => {
    const token = await new SignJWT({
      scope: 'usage',
      env: 'sandbox',
      principal: 'ppl_ABCDEFGHIJKLMNOP',
      jti: 12345,
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience(PROVIDER)
      .setSubject('agt_TESTAGNT')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey)
    const result = await createAgentTokenVerifier({
      issuer: ISSUER,
      providerRef: PROVIDER,
      keys: createLocalJWKSet({ keys: [publicJwk] }),
    })(token)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.agent.tokenId).toBe('12345')
  })
})

describe('sign-in challenge in a batch', () => {
  it('carries the id of the paid call that needs sign-in, not the first call', async () => {
    const api = new FakeAgentApi()
    const route = createAgentMcpRoute({
      issuer: ISSUER,
      agentLayer: createAgentLayer({}),
      calls: createAgentCalls({ client: api, maxWaitSeconds: 0, sleep: async () => undefined }),
      mcpPath: '/mcp',
      serverName: 'merchant-test',
      protectedResource: { resource: 'http://merchant.test/mcp' },
      freeTools: server =>
        server.registerTool('ping', { description: 'Free.', inputSchema: {} }, async () => ({
          content: [{ type: 'text', text: 'pong' }],
        })),
      tools: (_server, paid) =>
        paid<{ question: string }>({
          name: 'answer',
          description: 'Paid.',
          inputSchema: { question: z.string() },
          item: () => 'answer-v1',
          estimate: () => ({ amount: '0.01', currency: 'USD' }),
          run: async () => ({ result: { content: [{ type: 'text', text: 'x' }] }, cost: null }),
        }),
    })
    const response = await route(
      new Request('http://merchant.test/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify([
          {
            jsonrpc: '2.0',
            id: 'free-1',
            method: 'tools/call',
            params: { name: 'ping', arguments: {} },
          },
          {
            jsonrpc: '2.0',
            id: 'paid-2',
            method: 'tools/call',
            params: { name: 'answer', arguments: { question: 'q' } },
          },
        ]),
      }),
    )
    expect(response?.status).toBe(401)
    const body = (await response!.json()) as { id: unknown }
    expect(body.id).toBe('paid-2')
  })
})

describe('refusal status', () => {
  it('throws with a stable code for a reason it does not know', () => {
    let caught: unknown
    try {
      refusalStatus('bogus' as never)
    } catch (error) {
      caught = error
    }
    expect((caught as { code?: string } | undefined)?.code).toBe('unknown_refusal_reason')
  })
})
