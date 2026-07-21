import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import {
  resetWebhookBindingCache,
  resolveWebhookImpl,
  setWebhookBindingForTests,
} from '../src/webhook-native'
import { verifyWebhook } from '../src/index'

const mockVerifyWebhook = vi.fn()

const fakeBinding = {
  verifyWebhook: (...args: [string, string, string]) => mockVerifyWebhook(...args) as string,
}

const eventBody = JSON.stringify({
  type: 'purchase.created',
  id: 'evt_impl_123',
  created: Math.floor(Date.now() / 1000),
  api_version: '2025-10-01',
  data: {
    object: { id: 'pur_impl_123' },
    previous_attributes: null,
  },
  livemode: false,
  request: { id: null, idempotency_key: null },
})

describe('verifyWebhook impl selection', () => {
  const originalImpl = process.env.SOLVAPAY_IMPL

  beforeEach(() => {
    mockVerifyWebhook.mockReset()
    delete process.env.SOLVAPAY_IMPL
    resetWebhookBindingCache()
  })

  afterEach(() => {
    if (originalImpl === undefined) {
      delete process.env.SOLVAPAY_IMPL
    } else {
      process.env.SOLVAPAY_IMPL = originalImpl
    }
    resetWebhookBindingCache()
  })

  it('resolveWebhookImpl returns ts when SOLVAPAY_IMPL=ts', () => {
    process.env.SOLVAPAY_IMPL = 'ts'
    expect(resolveWebhookImpl()).toBe('ts')
  })

  it('resolveWebhookImpl returns rust when SOLVAPAY_IMPL=rust', () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    expect(resolveWebhookImpl()).toBe('rust')
  })

  it('resolveWebhookImpl prefers rust by default when the binding loads', () => {
    setWebhookBindingForTests(fakeBinding)
    expect(resolveWebhookImpl()).toBe('rust')
  })

  it('dispatches to the native binding under SOLVAPAY_IMPL=rust', () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    setWebhookBindingForTests(fakeBinding)
    mockVerifyWebhook.mockReturnValue(eventBody)

    const event = verifyWebhook({
      body: eventBody,
      signature: 't=1,v1=deadbeef',
      secret: 'whsec_test',
    })

    expect(mockVerifyWebhook).toHaveBeenCalledTimes(1)
    expect(mockVerifyWebhook).toHaveBeenCalledWith(eventBody, 't=1,v1=deadbeef', 'whsec_test')
    expect(event.type).toBe('purchase.created')
  })

  it('rewraps native Error as SolvaPayError under SOLVAPAY_IMPL=rust', () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    setWebhookBindingForTests(fakeBinding)
    const message = 'Invalid webhook signature'
    const nativeErr = new Error(message)
    ;(nativeErr as Error & { code?: string }).code = 'invalid_signature'
    mockVerifyWebhook.mockImplementation(() => {
      throw nativeErr
    })

    expect(() =>
      verifyWebhook({
        body: eventBody,
        signature: 't=1,v1=deadbeef',
        secret: 'whsec_test',
      }),
    ).toThrowError(SolvaPayError)

    try {
      verifyWebhook({
        body: eventBody,
        signature: 't=1,v1=deadbeef',
        secret: 'whsec_test',
      })
      expect.unreachable('expected verifyWebhook to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(SolvaPayError)
      expect((err as SolvaPayError).message).toBe(message)
    }
  })

  it('does not call the native binding under SOLVAPAY_IMPL=ts', async () => {
    process.env.SOLVAPAY_IMPL = 'ts'
    setWebhookBindingForTests(fakeBinding)

    const crypto = await import('node:crypto')
    const secret = 'whsec_test_secret'
    const timestamp = Math.floor(Date.now() / 1000)
    const hmac = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${eventBody}`)
      .digest('hex')
    const signature = `t=${timestamp},v1=${hmac}`

    const event = verifyWebhook({
      body: eventBody,
      signature,
      secret,
    })

    expect(mockVerifyWebhook).not.toHaveBeenCalled()
    expect(event.type).toBe('purchase.created')
  })
})
