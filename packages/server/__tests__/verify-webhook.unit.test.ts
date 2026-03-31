import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { verifyWebhook as verifyWebhookNode } from '../src/index'
import { verifyWebhook as verifyWebhookEdge } from '../src/edge'
import type { CustomerWebhookObject, WebhookEvent, WebhookEventForType } from '../src/types'

const secret = 'whsec_test_secret'
const purchaseCreatedBody = JSON.stringify({
  type: 'purchase.created',
  id: 'evt_purchase_123',
  created: Math.floor(Date.now() / 1000),
  api_version: '2025-10-01',
  data: {
    object: {
      id: 'pur_123',
    },
    previous_attributes: null,
  },
  livemode: false,
  request: {
    id: null,
    idempotency_key: null,
  },
})

const customerCreatedBody = JSON.stringify({
  type: 'customer.created',
  id: 'evt_customer_123',
  created: Math.floor(Date.now() / 1000),
  api_version: '2025-10-01',
  data: {
    object: {
      id: '69cbd1cea27ee92fbe90413f',
      reference: 'cus_0VXPU8NE',
      name: 'Test User',
      email: 'test.user@example.com',
      status: 'active',
      created: 1774965198,
      product: {
        reference: 'mcp_AJDHR12U',
      },
    },
    previous_attributes: null,
  },
  livemode: false,
  request: {
    id: null,
    idempotency_key: null,
  },
})

const createSignature = (payloadBody: string, payloadSecret: string): string => {
  const timestamp = Math.floor(Date.now() / 1000)
  const hmac = crypto
    .createHmac('sha256', payloadSecret)
    .update(`${timestamp}.${payloadBody}`)
    .digest('hex')
  return `t=${timestamp},v1=${hmac}`
}

describe('verifyWebhook', () => {
  it('verifies valid signatures in node runtime', () => {
    const signature = createSignature(purchaseCreatedBody, secret)

    const payload = verifyWebhookNode({
      body: purchaseCreatedBody,
      signature,
      secret,
    })

    expect(payload.type).toBe('purchase.created')
  })

  it('rejects malformed node signatures without crashing', () => {
    expect(() =>
      verifyWebhookNode({
        body: purchaseCreatedBody,
        signature: '1234',
        secret,
      }),
    ).toThrowError(SolvaPayError)
  })

  it('rejects non-hex node signatures', () => {
    expect(() =>
      verifyWebhookNode({
        body: purchaseCreatedBody,
        signature: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
        secret,
      }),
    ).toThrowError(SolvaPayError)
  })

  it('verifies valid signatures in edge runtime', async () => {
    const signature = createSignature(purchaseCreatedBody, secret)

    const payload = await verifyWebhookEdge({
      body: purchaseCreatedBody,
      signature,
      secret,
    })

    expect(payload.type).toBe('purchase.created')
  })

  it('rejects malformed edge signatures', async () => {
    await expect(
      verifyWebhookEdge({
        body: purchaseCreatedBody,
        signature: '1234',
        secret,
      }),
    ).rejects.toThrowError(SolvaPayError)
  })

  it('parses customer.created payload with product reference in node runtime', () => {
    const signature = createSignature(customerCreatedBody, secret)

    const event = verifyWebhookNode({
      body: customerCreatedBody,
      signature,
      secret,
    })

    expect(event.type).toBe('customer.created')
    if (event.type === 'customer.created') {
      expect(event.data.object.product).toEqual({ reference: 'mcp_AJDHR12U' })
      expect(event.data.object.product?.reference).toBe('mcp_AJDHR12U')
      expect(event.data.object.reference).toBe('cus_0VXPU8NE')
    }
  })

  it('parses customer.created payload with product reference in edge runtime', async () => {
    const signature = createSignature(customerCreatedBody, secret)

    const event = await verifyWebhookEdge({
      body: customerCreatedBody,
      signature,
      secret,
    })

    expect(event.type).toBe('customer.created')
    if (event.type === 'customer.created') {
      expect(event.data.object.product?.reference).toBe('mcp_AJDHR12U')
      expect(event.data.object.reference).toBe('cus_0VXPU8NE')
    }
  })
})

// Type-level checks for webhook typing and usage examples.
type IsEqual<T, U> =
  (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2 ? true : false
type Assert<T extends true> = T

type _CustomerObjectShape = Assert<
  IsEqual<WebhookEventForType<'customer.created'>['data']['object'], CustomerWebhookObject>
>
type _CustomerProductShape = Assert<
  IsEqual<
    WebhookEventForType<'customer.created'>['data']['object']['product'],
    { reference: string } | null
  >
>

function extractCustomerProductReference(event: WebhookEvent): string | null {
  if (event.type === 'customer.created') {
    return event.data.object.product?.reference ?? null
  }
  return null
}

void extractCustomerProductReference
