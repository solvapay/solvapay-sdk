import { createLocalJWKSet, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAgentLayer, createPolicy } from '../agent-layer'
import { createMetering } from '../agent-layer/metering'
import { createAgentTokenVerifier } from '../agent-layer/identity/verify-agent-token'
import { createApp } from '../app'
import { importEncryptionKey } from '../lib/crypto'
import { MemoryKvStore } from '../lib/kv-store'
import type { Logger } from '../log'
import { merchantKeysFrom } from '../merchant/merchant-keys'
import { OpperAccounts } from '../merchant/opper-accounts'
import { createOpperUpstream, formatTags, readCost } from '../upstream/opper'
import {
  agentKeys,
  chunkedResponse,
  FakeAgentApi,
  FakeOpperManagement,
  FakeSolvaPayApi,
  ISSUER,
  PROVIDER,
  signAgentToken,
  TEST_ENCRYPTION_KEY,
} from './fakes'

const MERCHANT_KEY = 'op-clone-test-alice'
const PRINCIPAL = 'ppl_ABCDEFGHIJKLMNOP'

let agentKey: CryptoKey
let agentJwk: JWK

beforeAll(async () => {
  const keys = await agentKeys()
  agentKey = keys.privateKey
  agentJwk = keys.publicJwk
})
const SSE = [
  'event: message_start\ndata: {"type":"message_start"}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n',
  // Opper's final usage event, as observed live on 8 Oct 2026, split across two chunks.
  'event: message_delta\ndata: {"cost":0.000043,"delta":{"stop_reason":"end_turn"},"type":"message_delta",',
  '"usage":{"cost":0.000043,"input_tokens":13,"output_tokens":6}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
]

interface Seen {
  url: string
  method: string
  headers: Headers
  body: string
}

async function setup(
  reply: (seen: Seen) => Response,
  api = new FakeSolvaPayApi(),
  agentApi = new FakeAgentApi(api),
) {
  const seen: Seen[] = []
  const events: { event: string; fields?: Record<string, unknown> }[] = []
  const log: Logger = {
    info: (event, fields) => events.push({ event, fields }),
    error: (event, fields) => events.push({ event, fields }),
  }
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? new TextDecoder().decode(init.body as ArrayBuffer) : ''
    const entry = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body,
    }
    seen.push(entry)
    return reply(entry)
  }) as typeof fetch
  const opper = new FakeOpperManagement()
  const app = createApp({
    agentLayer: createAgentLayer({
      verifyAgentToken: createAgentTokenVerifier({
        issuer: ISSUER,
        providerRef: PROVIDER,
        keys: createLocalJWKSet({ keys: [agentJwk] }),
      }),
    }),
    merchantKeys: merchantKeysFrom([{ key: MERCHANT_KEY, userRef: 'alice', label: 'test' }]),
    accounts: new OpperAccounts(
      opper,
      new MemoryKvStore(),
      await importEncryptionKey(TEST_ENCRYPTION_KEY),
    ),
    metering: createMetering({ solvaPay: api.solvaPay(), productRef: 'prd_TEST' }),
    policy: createPolicy({ client: agentApi }),
    upstream: createOpperUpstream({ baseUrl: 'https://opper.test', fetchImpl }),
    log,
  })
  return { app, seen, events, opper, api, agentApi }
}

function messages(headers: Record<string, string>) {
  return new Request('http://clone.test/v3/compat/v1/messages?beta=true', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', stream: true, messages: [] }),
  })
}

async function completed(events: { event: string; fields?: Record<string, unknown> }[]) {
  for (let i = 0; i < 50; i++) {
    const hit = events.find(e => e.event === 'call.completed')
    if (hit) return hit.fields ?? {}
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('call.completed was not logged')
}

describe('compat route', () => {
  it("rejects an unknown key with Opper's 401 shape and never calls Opper", async () => {
    const { app, seen } = await setup(() => new Response('{}'))
    const response = await app.request(messages({ 'x-api-key': 'op-clone-nope' }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'invalid bearer token. The key was not recognised; check it, or mint a new one.',
    })
    expect(seen).toHaveLength(0)
  })

  it('forwards a call with no key to Opper without credentials, so Opper answers', async () => {
    const opperBody = '{"error":"No API key was sent."}'
    const { app, seen, events, opper } = await setup(() => new Response(opperBody, { status: 401 }))
    const response = await app.request(messages({}))
    expect(response.status).toBe(401)
    expect(await response.text()).toBe(opperBody)
    expect(seen[0].headers.get('authorization')).toBeNull()
    expect(seen[0].headers.get('x-opper-tags')).toMatch(/^request_id:[0-9a-f-]+$/)
    expect(opper.calls).toEqual([])
    expect(events.some(e => e.event === 'call.anonymous')).toBe(true)
  })

  it('forwards with the user key in place of the caller key, with tags', async () => {
    const { app, seen } = await setup(() => new Response('{"ok":true}', { status: 200 }))
    const response = await app.request(
      messages({ 'x-api-key': MERCHANT_KEY, 'anthropic-version': '2023-06-01' }),
    )
    expect(response.status).toBe(200)

    const [call] = seen
    expect(call.url).toBe('https://opper.test/v3/compat/v1/messages?beta=true')
    expect(call.headers.get('authorization')).toBe('Bearer op-secret-1')
    expect(call.headers.get('x-api-key')).toBeNull()
    expect(call.headers.get('anthropic-version')).toBe('2023-06-01')
    expect(call.headers.get('x-opper-tags')).toMatch(/^request_id:[0-9a-f-]+,clone_user:alice$/)
    expect(JSON.parse(call.body).model).toBe('claude-sonnet-4-6')
  })

  it('accepts the key as a bearer token (ANTHROPIC_AUTH_TOKEN)', async () => {
    const { app } = await setup(() => new Response('{}'))
    const response = await app.request(messages({ authorization: `Bearer ${MERCHANT_KEY}` }))
    expect(response.status).toBe(200)
  })

  it('streams the body through and reads the cost from the final message_delta', async () => {
    const { app, events } = await setup(() =>
      chunkedResponse(SSE, {
        headers: {
          'content-type': 'text/event-stream',
          'content-encoding': 'gzip',
          'x-opper-trace-id': 'trace-1',
        },
      }),
    )
    const response = await app.request(messages({ 'x-api-key': MERCHANT_KEY }))
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(await response.text()).toBe(SSE.join(''))

    const fields = await completed(events)
    expect(fields).toMatchObject({
      paid: true,
      streamed: true,
      costUsd: 0.000043,
      costSource: 'stream-message-delta',
      project: 'sp-alice',
      traceId: 'trace-1',
    })
  })

  it('reads X-Opper-Cost on a plain call', async () => {
    const { app, events } = await setup(
      () =>
        new Response('{"usage":{"cost":0.000043}}', {
          headers: { 'content-type': 'application/json', 'x-opper-cost': '0.000043' },
        }),
    )
    const response = await app.request(messages({ 'x-api-key': MERCHANT_KEY }))
    await response.text()
    expect(await completed(events)).toMatchObject({
      streamed: false,
      costUsd: 0.000043,
      costSource: 'x-opper-cost',
    })
  })

  it('reports a stream without a cost event as missing', async () => {
    const { app, events } = await setup(() =>
      chunkedResponse([SSE[0], SSE[4]], { headers: { 'content-type': 'text/event-stream' } }),
    )
    const response = await app.request(messages({ 'x-api-key': MERCHANT_KEY }))
    await response.text()
    expect(await completed(events)).toMatchObject({ costUsd: null, costSource: 'missing' })
  })

  it("passes Opper's error status and body through unchanged", async () => {
    const body = '{"type":"error","error":{"type":"not_found_error","message":"model"}}'
    const { app } = await setup(
      () => new Response(body, { status: 404, headers: { 'content-type': 'application/json' } }),
    )
    const response = await app.request(messages({ 'x-api-key': MERCHANT_KEY }))
    expect(response.status).toBe(404)
    expect(await response.text()).toBe(body)
  })

  it('forwards unpaid paths too, marked as not paid', async () => {
    const { app, seen, events } = await setup(() => new Response('{"data":[]}'))
    const response = await app.request(
      new Request('http://clone.test/v3/compat/v1/models', {
        headers: { 'x-api-key': MERCHANT_KEY },
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"data":[]}')
    expect(seen[0].method).toBe('GET')
    expect((await completed(events)).paid).toBe(false)
  })
})

describe('agent tokens', () => {
  it('serves an agent as its pairwise principal, with the agent in the tags and the log', async () => {
    const { app, seen, events, opper } = await setup(() => new Response('{"ok":true}'))
    const token = await signAgentToken(agentKey, { principal: PRINCIPAL })
    const response = await app.request(messages({ authorization: `Bearer ${token}` }))
    expect(response.status).toBe(200)
    await response.text()

    expect(opper.projects.has(`sp-${PRINCIPAL}`)).toBe(true)
    expect(seen[0].headers.get('authorization')).toBe('Bearer op-secret-1')
    expect(seen[0].headers.get('x-opper-tags')).toMatch(
      new RegExp(`clone_user:${PRINCIPAL},agent_id:agt_TESTAGNT,decision_id:dec_TEST0001$`),
    )
    expect(await completed(events)).toMatchObject({
      auth: 'agent',
      agentRef: 'agt_TESTAGNT',
      userRef: PRINCIPAL,
    })
  })

  it('accepts the token as x-api-key too', async () => {
    const { app } = await setup(() => new Response('{}'))
    const token = await signAgentToken(agentKey)
    expect((await app.request(messages({ 'x-api-key': token }))).status).toBe(200)
  })

  it("refuses a token for another provider with Opper's 401 shape, without calling Opper", async () => {
    const { app, seen, events } = await setup(() => new Response('{}'))
    const token = await signAgentToken(agentKey, { aud: 'prov_OTHER001' })
    const response = await app.request(messages({ authorization: `Bearer ${token}` }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'invalid bearer token. The agent token was not accepted (invalid).',
    })
    expect(seen).toHaveLength(0)
    expect(events.find(e => e.event === 'call.rejected')?.fields).toMatchObject({
      reason: 'agent_token_invalid',
    })
  })

  it('keeps the merchant key path for non-agent callers, unbilled', async () => {
    const { app, events, api } = await setup(() => new Response('{}'))
    const response = await app.request(messages({ 'x-api-key': MERCHANT_KEY }))
    await response.text()
    expect(await completed(events)).toMatchObject({ auth: 'merchant_key', agentRef: null })
    expect(api.usages).toHaveLength(0)
  })
})

describe('agent billing', () => {
  const streamed = () => chunkedResponse(SSE, { headers: { 'content-type': 'text/event-stream' } })

  async function agentCall(app: Awaited<ReturnType<typeof setup>>['app'], principal = PRINCIPAL) {
    const token = await signAgentToken(agentKey, { principal })
    return app.request(messages({ authorization: `Bearer ${token}` }))
  }

  it("debits an agent's streamed call at the cost in message_delta", async () => {
    const { app, events, api } = await setup(streamed)
    api.balanceUsd = '2.999957'
    const response = await agentCall(app)
    expect(await response.text()).toBe(SSE.join(''))

    expect(await completed(events)).toMatchObject({
      auth: 'agent',
      costUsd: 0.000043,
      settled: true,
      settleSource: 'reported',
      amountUsd: '0.000043',
      balanceUsd: '2.999957',
    })
    expect(api.usages).toHaveLength(1)
    expect(api.usages[0]).toMatchObject({
      customerRef: 'cus_TESTCUST',
      cost: { amount: '0.000043', currency: 'USD', source: 'reported' },
    })
  })

  it('refuses an agent whose principal has no customer here with an Anthropic 402, before SolvaPay decides', async () => {
    const { app, seen, events, api, agentApi } = await setup(streamed)
    const response = await agentCall(app, 'ppl_UNLINKEDUNLINKED')
    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: expect.stringMatching(/Connect it in SolvaPay/),
      },
    })
    expect(seen).toHaveLength(0)
    expect(agentApi.decides).toHaveLength(0)
    expect(api.usages).toHaveLength(0)
    expect(events.find(e => e.event === 'call.refused')?.fields).toMatchObject({
      reason: 'customer_not_linked',
    })
  })

  it('refuses an agent below the estimate with an Anthropic 402 and releases the reservation', async () => {
    const api = new FakeSolvaPayApi()
    api.credits = 100
    const { app, seen, events, agentApi } = await setup(streamed, api)
    const response = await agentCall(app)
    expect(response.status).toBe(402)
    const body = await response.json()
    expect(body.type).toBe('error')
    expect(body.error.message).toMatch(/^The balance of 0\.01 USD is below the 0\.03\d* USD/)
    expect(seen).toHaveLength(0)
    expect(agentApi.settles).toEqual([
      { decisionRef: 'dec_TEST0001', source: 'none', usagesBefore: 0 },
    ])
    expect(events.find(e => e.event === 'call.refused')?.fields).toMatchObject({
      reason: 'topup_required',
      decisionRef: 'dec_TEST0001',
    })
  })

  it('does not bill unpaid paths', async () => {
    const { app, events, api } = await setup(() => new Response('{"data":[]}'))
    const token = await signAgentToken(agentKey)
    const response = await app.request(
      new Request('http://clone.test/v3/compat/v1/models', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    await response.text()
    expect((await completed(events)).paid).toBe(false)
    expect(api.usages).toHaveLength(0)
  })

  it('does not settle a call Opper refused', async () => {
    const { app, events, api } = await setup(
      () => new Response('{"type":"error"}', { status: 529 }),
    )
    const response = await agentCall(app)
    await response.text()
    expect(await completed(events)).toMatchObject({ status: 529, settled: false })
    expect(api.usages).toHaveLength(0)
  })

  it('settles a stream the caller dropped after the cost arrived at that cost', async () => {
    const { app, events, api } = await setup(streamed)
    const response = await agentCall(app)
    if (!response.body) throw new Error('expected a streamed body')
    const reader = response.body.getReader()
    let text = ''
    while (!text.includes('message_delta') || !text.includes('"usage"')) {
      const { value } = await reader.read()
      text += new TextDecoder().decode(value)
    }
    await reader.cancel('client went away')

    expect(await completed(events)).toMatchObject({
      interrupted: expect.any(String),
      costUsd: 0.000043,
      settleSource: 'reported',
    })
    expect(api.usages[0]).toMatchObject({ outcome: 'fail', cost: { amount: '0.000043' } })
  })
})

describe('spend policy', () => {
  const streamed = () => chunkedResponse(SSE, { headers: { 'content-type': 'text/event-stream' } })

  function agentMessages(token: string, body: string) {
    return new Request('http://clone.test/v3/compat/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body,
    })
  }

  it('decides with the agent token, the model, its tier and the estimate from the body', async () => {
    const { app, agentApi } = await setup(streamed)
    const token = await signAgentToken(agentKey, { principal: PRINCIPAL })
    const body = JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [] })
    const response = await app.request(agentMessages(token, body))
    await response.text()

    expect(agentApi.decides).toHaveLength(1)
    const [decide] = agentApi.decides
    expect(decide).toMatchObject({
      agentToken: token,
      kind: 'inference',
      model: 'claude-sonnet-4-6',
      tier: 'M',
    })
    // ceil(bytes ÷ 4) × 3 USD/MTok + 1,000 × 15 USD/MTok
    const expected = (Math.ceil(body.length / 4) * 300 + 1_000 * 1_500) / 1e8
    expect(Number(decide.estimatedCost)).toBeCloseTo(expected, 8)
  })

  it('denies with an Anthropic 422 carrying the reason text, and never calls Opper', async () => {
    const { app, seen, events, api, agentApi } = await setup(streamed)
    agentApi.action = 'deny'
    agentApi.reasonCode = 'tier_not_allowed'
    agentApi.reasonText =
      "claude-sonnet-4-6 is a tier M model, which this spend policy doesn't cover. Use a model in tier S."
    const token = await signAgentToken(agentKey, { principal: PRINCIPAL })
    const response = await app.request(messages({ authorization: `Bearer ${token}` }))

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: agentApi.reasonText },
      request_id: expect.any(String),
    })
    expect(seen).toHaveLength(0)
    expect(api.usages).toHaveLength(0)
    expect(agentApi.settles).toHaveLength(0)
    expect(events.find(e => e.event === 'call.refused')?.fields).toMatchObject({
      reason: 'tier_not_allowed',
      action: 'deny',
      decisionRef: 'dec_TEST0001',
      requestId: body.request_id,
      tier: 'M',
    })
  })

  it('asks with an Anthropic 402, and never calls Opper', async () => {
    const { app, seen, agentApi } = await setup(streamed)
    agentApi.action = 'ask'
    agentApi.reasonCode = 'budget_exhausted_ask'
    agentApi.reasonText = "Stopped: this call would pass this month's $0.05 budget ($0.04 used)."
    const token = await signAgentToken(agentKey, { principal: PRINCIPAL })
    const response = await app.request(messages({ authorization: `Bearer ${token}` }))

    expect(response.status).toBe(402)
    expect((await response.json()).error.message).toBe(agentApi.reasonText)
    expect(seen).toHaveLength(0)
  })

  it('a deny wins over a short balance: permission before money', async () => {
    const api = new FakeSolvaPayApi()
    api.credits = 0
    const { app, agentApi } = await setup(streamed, api)
    agentApi.action = 'deny'
    const token = await signAgentToken(agentKey, { principal: PRINCIPAL })
    expect((await app.request(messages({ authorization: `Bearer ${token}` }))).status).toBe(422)
  })

  it('settles the policy first, then the credit debit with decision_ref, and tags the call', async () => {
    const { app, seen, events, api, agentApi } = await setup(streamed)
    const token = await signAgentToken(agentKey, { principal: PRINCIPAL })
    const response = await app.request(messages({ authorization: `Bearer ${token}` }))
    await response.text()

    const fields = await completed(events)
    expect(agentApi.settles).toEqual([
      { decisionRef: 'dec_TEST0001', source: 'reported', amountUsd: '0.000043', usagesBefore: 0 },
    ])
    expect(api.usages).toHaveLength(1)
    expect(api.usages[0].metadata).toMatchObject({ decision_ref: 'dec_TEST0001' })
    expect(seen[0].headers.get('x-opper-tags')).toMatch(/,decision_id:dec_TEST0001$/)
    expect(fields).toMatchObject({
      decisionRef: 'dec_TEST0001',
      policyRef: 'pol_TESTPOL1',
      policyVersion: 2,
      tier: 'M',
      policySettled: true,
      policySource: 'reported',
      settled: true,
      amountUsd: '0.000043',
    })
  })

  it('releases the reservation when Opper refuses the call, and debits nothing', async () => {
    const { app, api, agentApi, events } = await setup(
      () => new Response('{"type":"error"}', { status: 529 }),
    )
    const token = await signAgentToken(agentKey, { principal: PRINCIPAL })
    await (await app.request(messages({ authorization: `Bearer ${token}` }))).text()
    expect(await completed(events)).toMatchObject({ policySource: 'none', settled: false })
    expect(agentApi.settles[0]).toMatchObject({ source: 'none' })
    expect(api.usages).toHaveLength(0)
  })

  it('answers a body that is not JSON with an Anthropic 400, reaching neither SolvaPay nor Opper', async () => {
    const { app, seen, api, agentApi } = await setup(streamed)
    const token = await signAgentToken(agentKey, { principal: PRINCIPAL })
    const response = await app.request(agentMessages(token, '{"model": "claude-sonnet-4-6",'))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'The request body is not valid JSON.' },
    })
    expect(seen).toHaveLength(0)
    expect(agentApi.decides).toHaveLength(0)
    expect(api.lookups).toHaveLength(0)
  })

  it('answers a body without a model with an Anthropic 400', async () => {
    const { app, seen } = await setup(streamed)
    const token = await signAgentToken(agentKey, { principal: PRINCIPAL })
    const response = await app.request(agentMessages(token, '{"messages":[]}'))
    expect(response.status).toBe(400)
    expect(seen).toHaveLength(0)
  })

  it('still forwards a merchant-key call with a bad body for Opper to answer', async () => {
    const { app, seen } = await setup(() => new Response('{}', { status: 400 }))
    const response = await app.request(
      new Request('http://clone.test/v3/compat/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': MERCHANT_KEY },
        body: 'not json',
      }),
    )
    expect(response.status).toBe(400)
    expect(seen[0].body).toBe('not json')
  })

  it('fails closed with a 502 when the spend policy check is unavailable', async () => {
    const { app, seen, agentApi } = await setup(streamed)
    agentApi.failDecide = 503
    const token = await signAgentToken(agentKey, { principal: PRINCIPAL })
    expect((await app.request(messages({ authorization: `Bearer ${token}` }))).status).toBe(502)
    expect(seen).toHaveLength(0)
  })

  it("answers Opper's 401 when SolvaPay refuses the agent on decide (revoked)", async () => {
    const { app, seen, agentApi } = await setup(streamed)
    agentApi.failDecide = 401
    const token = await signAgentToken(agentKey, { principal: PRINCIPAL })
    const response = await app.request(messages({ authorization: `Bearer ${token}` }))
    expect(response.status).toBe(401)
    expect((await response.json()).error).toMatch(/^invalid bearer token\. SolvaPay did not accept/)
    expect(seen).toHaveLength(0)
  })
})

describe('tags and cost', () => {
  it('refuses more than 8 tags and tag values with separators', () => {
    const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, 'v']))
    expect(() => formatTags(nine)).toThrow(/at most 8/)
    expect(() => formatTags({ a: 'b,c' })).toThrow(/comma or colon/)
  })

  it('reads X-Opper-Cost and flags a missing or bad value', () => {
    expect(readCost(new Headers({ 'x-opper-cost': '0.5' }))).toEqual({
      usd: 0.5,
      source: 'x-opper-cost',
    })
    expect(readCost(new Headers())).toEqual({ usd: null, source: 'missing' })
    expect(readCost(new Headers({ 'x-opper-cost': 'abc' })).source).toBe('unparseable')
  })
})
