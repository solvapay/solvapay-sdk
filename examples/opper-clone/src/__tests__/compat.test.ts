import { describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { importEncryptionKey } from '../lib/crypto'
import { MemoryKvStore } from '../lib/kv-store'
import type { Logger } from '../log'
import { merchantKeysFrom } from '../merchant/merchant-keys'
import { OpperAccounts } from '../merchant/opper-accounts'
import { createOpperUpstream, formatTags, readCost } from '../upstream/opper'
import { chunkedResponse, FakeOpperManagement, TEST_ENCRYPTION_KEY } from './fakes'

const MERCHANT_KEY = 'op-clone-test-alice'
const SSE = [
  'event: message_start\ndata: {"type":"message_start"}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
]

interface Seen {
  url: string
  method: string
  headers: Headers
  body: string
}

async function setup(reply: (seen: Seen) => Response) {
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
    merchantKeys: merchantKeysFrom([{ key: MERCHANT_KEY, userRef: 'alice', label: 'test' }]),
    accounts: new OpperAccounts(
      opper,
      new MemoryKvStore(),
      await importEncryptionKey(TEST_ENCRYPTION_KEY),
    ),
    upstream: createOpperUpstream({ baseUrl: 'https://opper.test', fetchImpl }),
    log,
  })
  return { app, seen, events, opper }
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
  it('rejects an unknown key with an Anthropic-shaped 401 and never calls Opper', async () => {
    const { app, seen } = await setup(() => new Response('{}'))
    const response = await app.request(messages({ 'x-api-key': 'op-clone-nope' }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    })
    expect(seen).toHaveLength(0)
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

  it('streams the body through and logs cost once the stream ends', async () => {
    const { app, events } = await setup(() =>
      chunkedResponse(SSE, {
        headers: {
          'content-type': 'text/event-stream',
          'content-encoding': 'gzip',
          'x-opper-cost': '0.0213',
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
      costUsd: 0.0213,
      costSource: 'x-opper-cost',
      project: 'sp-alice',
      opperHeaders: ['x-opper-cost'],
    })
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
