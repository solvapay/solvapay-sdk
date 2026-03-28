import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { verifyWebhook as verifyWebhookNode } from '../src/index'
import { verifyWebhook as verifyWebhookEdge } from '../src/edge'

const secret = 'whsec_test_secret'
const body = JSON.stringify({
  type: 'purchase.created',
  data: {
    id: 'pur_123',
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
    const signature = createSignature(body, secret)

    const payload = verifyWebhookNode({
      body,
      signature,
      secret,
    })

    expect(payload.type).toBe('purchase.created')
  })

  it('rejects malformed node signatures without crashing', () => {
    expect(() =>
      verifyWebhookNode({
        body,
        signature: '1234',
        secret,
      }),
    ).toThrowError(SolvaPayError)
  })

  it('rejects non-hex node signatures', () => {
    expect(() =>
      verifyWebhookNode({
        body,
        signature: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
        secret,
      }),
    ).toThrowError(SolvaPayError)
  })

  it('verifies valid signatures in edge runtime', async () => {
    const signature = createSignature(body, secret)

    const payload = await verifyWebhookEdge({
      body,
      signature,
      secret,
    })

    expect(payload.type).toBe('purchase.created')
  })

  it('rejects malformed edge signatures', async () => {
    await expect(
      verifyWebhookEdge({
        body,
        signature: '1234',
        secret,
      }),
    ).rejects.toThrowError(SolvaPayError)
  })
})
